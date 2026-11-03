import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { automaticMarketingFields, isMarketingOnly, marketingRedirect } from "./lib/marketingInventory";
import { listingImages } from "./lib/catalogImages";
import { bumpCatalogRevision } from "./lib/catalogRevision";

const changeValidator = v.object({ listingId: v.id("listings"), marketingOnly: v.union(v.boolean(), v.null()), expectedUpdatedAt: v.optional(v.number()) });
const managerResultValidator = v.object({ productId: v.number(), marketingOnly: v.boolean(), mode: v.union(v.literal("automatic"), v.literal("manual")), updatedAt: v.number() });
const MANAGER_MARKETING_BATCH_SIZE = 50;

function managerChunkRequestId(requestId: string, chunkIndex: number) {
  return `${requestId.slice(0, 24)}${chunkIndex.toString(16).padStart(12, "0")}`;
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) return { authorized: false, items: [] };
    const rows = await ctx.db.query("listings").collect();
    return { authorized: true, items: rows.map(l => ({
      _id: l._id, title: l.title, category: l.category, active: l.active,
      heroImage: listingImages(l)[0] ?? null,
      marketingOnly: isMarketingOnly(l), source: l.marketingOnlySource ?? "auto",
      automaticMatch: !!marketingRedirect(l), updatedAt: l.marketingOnlyUpdatedAt,
    })).sort((a,b) => a.title.localeCompare(b.title)) };
  },
});

export const save = mutation({
  args: { token: v.string(), changes: v.array(v.object({
    listingId: v.id("listings"), marketingOnly: v.union(v.boolean(), v.null()),
    expectedUpdatedAt: v.optional(v.number()),
  })) },
  handler: async (ctx, { token, changes }) => {
    await assertAdmin(ctx, token, "marketingAdmin.save");
    if (changes.length > 500 || new Set(changes.map(c => c.listingId)).size !== changes.length)
      throw Error("Choose up to 500 distinct listings per save.");
    const rows = await Promise.all(changes.map(async c => {
      const listing = await ctx.db.get(c.listingId);
      if (!listing) throw Error("A listing was removed. Discard changes and review the list again.");
      if ((listing.marketingOnlyUpdatedAt ?? 0) !== (c.expectedUpdatedAt ?? 0))
        throw Error("A tag changed in another session. Discard changes and review the latest list.");
      return { listing, change: c };
    }));
    if (rows.some(row => row.listing.marketingOnlySource === "rental_manager")) {
      await ctx.db.insert("marketing_saved_drafts", { changes, createdAt: Date.now() });
      return { saved: 0, draftSaved: true };
    }
    const at = rows.reduce((value, row) => Math.max(value, (row.listing.marketingOnlyUpdatedAt ?? 0) + 1), Date.now());
    for (const { listing, change } of rows) await ctx.db.patch(listing._id, {
      marketingOnly: change.marketingOnly ?? !!marketingRedirect(listing),
      marketingOnlySource: change.marketingOnly === null ? "auto" : "admin",
      marketingOnlyUpdatedAt: at,
    });
    if (rows.length) await bumpCatalogRevision(ctx);
    return { saved: rows.length };
  },
});

export const savedDrafts = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, drafts: [] };
    const drafts = await ctx.db.query("marketing_saved_drafts").withIndex("by_created", q => q).order("desc").take(10);
    return { authorized: true as const, drafts };
  },
});

export const removeSavedDraft = mutation({
  args: { token: v.string(), draftId: v.id("marketing_saved_drafts") },
  handler: async (ctx, { token, draftId }) => {
    await assertAdmin(ctx, token, "marketingAdmin.removeSavedDraft");
    if (await ctx.db.get(draftId)) await ctx.db.delete(draftId);
  },
});

export const prepareSave = internalMutation({
  args: { requestId: v.string(), changes: v.array(changeValidator) },
  handler: async (ctx, { requestId, changes }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw Error("Invalid save identifier.");
    if (!changes.length || changes.length > 500 || new Set(changes.map(change => change.listingId)).size !== changes.length) throw Error("Choose between 1 and 500 distinct listings.");
    const requestBody = JSON.stringify(changes);
    const existing = await ctx.db.query("marketing_save_operations").withIndex("by_request", q => q.eq("requestId", requestId)).unique();
    if (existing) {
      if (existing.requestBody !== requestBody) throw Error("This save identifier was already used for different choices.");
      return existing;
    }
    const entries = await Promise.all(changes.map(async change => {
      const listing = await ctx.db.get(change.listingId);
      if (!listing) throw Error("A listing was removed. Review the latest list before saving.");
      if ((listing.marketingOnlyUpdatedAt ?? 0) !== (change.expectedUpdatedAt ?? 0)) throw Error("A tag changed in another session. Review the latest list before saving.");
      if (listing.marketingOnlySource !== "rental_manager") return change;
      if (!Number.isSafeInteger(listing.hyggloProductId) || (listing.hyggloProductId ?? 0) <= 0) throw Error("A manager listing is missing its source identity.");
      return { ...change, productId: listing.hyggloProductId };
    }));
    const productIds = entries.flatMap(entry => "productId" in entry && entry.productId ? [entry.productId] : []);
    if (new Set(productIds).size !== productIds.length) throw Error("The same manager listing occurs more than once. Review the list before saving.");
    const id = await ctx.db.insert("marketing_save_operations", { requestId, requestBody, changes: entries, state: "pending", createdAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const finishSave = internalMutation({
  args: { requestId: v.string(), results: v.array(managerResultValidator) },
  handler: async (ctx, { requestId, results }) => {
    const operation = await ctx.db.query("marketing_save_operations").withIndex("by_request", q => q.eq("requestId", requestId)).unique();
    if (!operation) throw Error("The saved request was not found.");
    if (operation.state === "complete") return { saved: operation.saved ?? 0 };
    const manager = operation.changes.filter(change => change.productId !== undefined);
    if (results.length !== manager.length || new Set(results.map(result => result.productId)).size !== results.length) throw Error("The manager receipt is incomplete.");
    const resultById = new Map(results.map(result => [result.productId, result]));
    const listings = await Promise.all(operation.changes.map(async change => {
      const listing = await ctx.db.get(change.listingId);
      if (!listing) throw Error("A listing was removed while the save was in progress.");
      const result = change.productId === undefined ? undefined : resultById.get(change.productId);
      if (change.productId !== undefined && (!result || !Number.isSafeInteger(result.updatedAt) || result.updatedAt <= (change.expectedUpdatedAt ?? 0) || result.mode !== (change.marketingOnly === null ? "automatic" : "manual") || (change.marketingOnly !== null && result.marketingOnly !== change.marketingOnly))) throw Error("The manager receipt does not match the requested changes.");
      const alreadyApplied = result && listing.marketingOnlySource === "rental_manager" && listing.hyggloProductId === change.productId && listing.marketingOnlyUpdatedAt === result.updatedAt && listing.marketingOnly === result.marketingOnly && listing.marketingOnlyMode === result.mode;
      if (!alreadyApplied && ((listing.marketingOnlyUpdatedAt ?? 0) !== (change.expectedUpdatedAt ?? 0) || (change.productId === undefined ? listing.marketingOnlySource === "rental_manager" : listing.marketingOnlySource !== "rental_manager" || listing.hyggloProductId !== change.productId))) throw Error("A listing changed while the save was in progress. Review it before retrying.");
      return { listing, change, result };
    }));
    for (const { listing, change, result } of listings) {
      if (result) {
        const matches = await ctx.db.query("listings").withIndex("by_hyggloProductId", q => q.eq("hyggloProductId", result.productId)).take(21);
        if (matches.length > 20 || matches.some(item => item.marketingOnlySource === "rental_manager" && ((item.marketingOnlyUpdatedAt ?? 0) > result.updatedAt || item.marketingOnlyUpdatedAt === result.updatedAt && (item.marketingOnly !== result.marketingOnly || item.marketingOnlyMode !== result.mode)))) throw Error("A newer or conflicting manager tag needs review before the website can confirm this save.");
        for (const item of matches) await ctx.db.patch(item._id, { marketingOnly: result.marketingOnly, marketingOnlyMode: result.mode, marketingOnlySource: "rental_manager", marketingOnlyUpdatedAt: result.updatedAt });
      } else {
        await ctx.db.patch(listing._id, { marketingOnly: change.marketingOnly ?? !!marketingRedirect(listing), marketingOnlySource: change.marketingOnly === null ? "auto" : "admin", marketingOnlyUpdatedAt: Math.max(Date.now(), (listing.marketingOnlyUpdatedAt ?? 0) + 1) });
      }
    }
    if (listings.length) await bumpCatalogRevision(ctx);
    await ctx.db.patch(operation._id, { state: "complete", saved: listings.length });
    return { saved: listings.length };
  },
});

export const saveThroughManager = action({
  args: { token: v.string(), requestId: v.string(), changes: v.array(changeValidator) },
  handler: async (ctx, { token, requestId, changes }): Promise<{ saved: number }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "marketingAdmin.saveThroughManager" });
    const operation = await ctx.runMutation(internal.marketingAdmin.prepareSave, { requestId, changes });
    if (!operation) throw Error("The save could not be prepared.");
    if (operation.state === "complete") return { saved: operation.saved ?? 0 };
    const managerChanges = operation.changes.filter(change => change.productId !== undefined).map(change => ({ productId: change.productId!, marketingOnly: change.marketingOnly, ...(change.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: change.expectedUpdatedAt }) }));
    let results: Array<{productId:number;marketingOnly:boolean;mode:"automatic"|"manual";updatedAt:number}> = [];
    if (managerChanges.length) {
      const configured = process.env.RMV2_WEBHOOK_URL, secret = process.env.RMV2_MARKETING_WRITE_SECRET;
      if (!configured || !secret) throw Error("The manager connection is not configured. Your choices are preserved; retry later.");
      let base: URL;
      try { base = new URL(configured); } catch { throw Error("The manager connection is invalid."); }
      if (base.protocol !== "https:" || !/^[a-z0-9-]+\.convex\.site$/.test(base.hostname) || base.username || base.password || base.port || base.search || base.hash || base.pathname !== "/dbcinema/booking-sync") throw Error("The manager connection is invalid.");
      for (let offset = 0; offset < managerChanges.length; offset += MANAGER_MARKETING_BATCH_SIZE) {
        const chunkIndex = offset / MANAGER_MARKETING_BATCH_SIZE;
        const changes = managerChanges.slice(offset, offset + MANAGER_MARKETING_BATCH_SIZE);
        const chunkRequestId = managerChunkRequestId(requestId, chunkIndex);
        const response = await fetch(new URL("/dbcinema/storefront-marketing-write", base), { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json", "x-dbcinema-sync-token": secret }, body: JSON.stringify({ protocolVersion: 1, requestId: chunkRequestId, changes }) });
        if (!response.ok) throw Error("Rental Manager did not confirm the save. Your choices are preserved; retry or review conflicts.");
        const receipt = await response.json();
        if (receipt?.protocolVersion !== 1 || receipt.status !== "success" || receipt.requestId !== chunkRequestId || !Array.isArray(receipt.results) || receipt.results.length !== changes.length) throw Error("Rental Manager returned an incomplete receipt. Your choices are preserved.");
        results.push(...receipt.results);
      }
    }
    return await ctx.runMutation(internal.marketingAdmin.finishSave, { requestId, results });
  },
});

/** Seed identified listings once; repeated runs preserve manual choices. */
export const seedIdentified = internalMutation({
  args: {}, handler: async ctx => {
    const rows = await ctx.db.query("listings").collect();
    let tagged = 0, updated = 0;
    for (const l of rows) {
      const fields = automaticMarketingFields(l, l);
      if (Object.keys(fields).length) { await ctx.db.patch(l._id, fields); updated++; }
      if (isMarketingOnly({ ...l, ...fields })) tagged++;
    }
    if (updated) await bumpCatalogRevision(ctx);
    return { tagged, updated, total: rows.length };
  },
});
