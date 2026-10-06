import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { automaticMarketingFields, isMarketingOnly, marketingRedirect } from "./lib/marketingInventory";
import { listingImages } from "./lib/catalogImages";

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
    const at = rows.reduce((value, row) => Math.max(value, (row.listing.marketingOnlyUpdatedAt ?? 0) + 1), Date.now());
    for (const { listing, change } of rows) await ctx.db.patch(listing._id, {
      marketingOnly: change.marketingOnly ?? !!marketingRedirect(listing),
      marketingOnlySource: change.marketingOnly === null ? "auto" : "admin",
      marketingOnlyUpdatedAt: at,
    });
    return { saved: rows.length };
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
    return { tagged, updated, total: rows.length };
  },
});
