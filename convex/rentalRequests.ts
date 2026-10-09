import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage } from "./lib/rentalChat";
import { bookingCancelKind, cancellationDaysForBooking } from "../src/lib/cancellationPolicy";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import type { Doc, Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { listingImages } from "./lib/catalogImages";
import { kitRequestInput, requestableListing, resolveKitRequest, sameKitInput } from "./lib/rentalKitSelection";

const labels = { dates: "Change dates", items: "Change kit", extension: "Extend rental", cancel: "Cancel rental" };

/** Bounded, reactive request history for the selected rental only. */
export const list = query({
  args: { token: v.string(), bookingId: v.id("bookings"), admin: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, bookingId, admin, paginationOpts }) => {
    if (!Number.isSafeInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > 50) throw Error("Choose 1–50 requests per page.");
    let accountId: Id<"accounts"> | undefined;
    if (admin) {
      if (!checkAdminToken(token)) throw Error("unauthorized");
      if (!await ctx.db.get(bookingId)) return { page: [], isDone: true, continueCursor: "" };
    } else {
      const account = await accountForToken(ctx, token, true);
      if (!account) throw Error("Please sign in.");
      await ownedBooking(ctx, account, bookingId);
      accountId = account._id;
    }
    const scoped = ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc");
    const rows = await (admin ? scoped : scoped.filter(q => q.eq(q.field("accountId"), accountId))).paginate(paginationOpts);
    return { ...rows, page: await Promise.all(rows.page.map(async row => {
      const linked = row.extensionRequestId ? await ctx.db.get(row.extensionRequestId) : null;
      const validExtension = row.kind === "extension" && linked?.type === "extend" && linked.bookingId === row.bookingId && linked.accountId === row.accountId;
      const extension = row.extensionRequestId ? validExtension ? { status: linked!.status, amount: linked!.priceDelta ?? null, returnTime: linked!.approvedReturnTime ?? linked!.requestedReturnTime ?? null, returnTimeApproved: !!linked!.approvedReturnTime, reason: linked!.approvalReason, completedAt: linked!.status === "applied" ? linked!.resolvedAt : undefined } : { status: "unavailable" as const, amount: null, returnTime: null, returnTimeApproved: false, reason: undefined, completedAt: undefined } : undefined;
      const linkedAddition=row.additionRequestId?await ctx.db.get(row.additionRequestId):null;
      const validAddition=row.kind==="items"&&linkedAddition?.bookingId===row.bookingId&&linkedAddition.changeRequestId===row._id;
      const addition=row.additionRequestId?(validAddition?{id:linkedAddition!._id,status:linkedAddition!.status,title:linkedAddition!.title,qty:linkedAddition!.qty,start:linkedAddition!.start,end:linkedAddition!.end,amount:(linkedAddition!.draftReplacement?linkedAddition!.baseTotal??0:0)+linkedAddition!.lineTotal+linkedAddition!.securityCharge+(linkedAddition!.membershipFee??0),paymentReceived:!!linkedAddition!.paymentIntentId,updatedAt:linkedAddition!.updatedAt}:{id:null,status:"unavailable",title:null,qty:null,start:null,end:null,amount:null,paymentReceived:false,updatedAt:null}):undefined;
      return {
      _id: row._id, kind: row.kind, detail: row.detail, createdAt: row.createdAt,
      status: extension ? extension.status === "pending" ? "pending" as const : ["declined", "withdrawn", "expired", "refunded"].includes(extension.status) ? "declined" as const : "approved" as const : row.status ?? "pending", decisionNote: row.decisionNote, decidedAt: row.decidedAt,
      execution: row.execution ? { operation: row.execution.operation, status: row.execution.status, appliedAt: row.execution.appliedAt, detail: row.execution.detail } : undefined,
      extension,addition,...(row.kitSelection ? { kitSelection: row.kitSelection } : {}),
    }; })) };
  },
});

/** This records the human decision, not a dates/stock/payment mutation.
 * Those changes retain their existing inventory, bank and verification gates. */
export const review = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), id: v.id("rental_change_requests"),
    decision: v.union(v.literal("approved"), v.literal("declined")), note: v.string() },
  handler: async (ctx, { token, bookingId, id, decision, note }) => {
    await assertAdmin(ctx, token, "rentalRequests.review");
    const request = await ctx.db.get(id);
    const booking = await ctx.db.get(bookingId);
    const account = request ? await ctx.db.get(request.accountId) : null;
    if (!request || request.bookingId !== bookingId || !belongsToRentalAccount(booking, account)) throw Error("This request is not available for this rental.");
    if (request.extensionRequestId) throw Error("Review this extension using its quote and payment controls.");
    const text = note.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Record a reply in 5–1000 characters.");
    if (request.status && request.status !== "pending") {
      if (request.status !== decision || request.decisionNote !== text) throw Error("This request has already been reviewed. Discuss any further change in the conversation.");
      return { ok: true, status: decision, messageId: request.decisionMessageId };
    }
    if (decision === "approved" && (!["pending_payment", "confirmed", "active"].includes(booking!.status) || booking!.cancellationDecision || booking!.returnDecision)) throw Error("This rental can no longer accept a new change. Reply in the conversation instead.");
    if (decision === "approved" && request.kind === "cancel" && booking!.status === "active") throw Error("This rental has started. Arrange an early return in the conversation instead.");
    const messageId = await postRentalMessage(ctx, { accountId: request.accountId, bookingId, sender: "system",
      text: decision === "approved"
        ? `The team approved your ${labels[request.kind].toLowerCase()} request for arrangement: ${text} Your rental is unchanged until the team confirms the actual update and any settlement separately.`
        : `The team declined your ${labels[request.kind].toLowerCase()} request: ${text} Your rental is unchanged. Reply here if you would like to discuss another option.`,
      meta: { type: "rental_change_decision", changeRequestId: id, decision } });
    await ctx.db.patch(id, { status: decision, decisionNote: text, decidedAt: Date.now(), decisionMessageId: messageId });
    return { ok: true, status: decision, messageId };
  },
});

export const context = query({
  args: { token: v.string(), bookingId: v.id("bookings"), refreshKey: v.optional(v.number()) },
  handler: async (ctx, { token, bookingId }) => {
    const a = await accountForToken(ctx, token, true);
    if (!a) return null;
    const b = await ownedBooking(ctx, a, bookingId);
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    const lineItems = await Promise.all(b.lineItems.map(async (line: Doc<"bookings">["lineItems"][number], index: number) => {
      const images = listingImages(await ctx.db.get(line.listingId));
      return { index, listingId: line.listingId, title: line.title, qty: line.qty, start: line.start, end: line.end,
        pickupTime: line.pickupTime === undefined ? b.pickupTime ?? null : line.pickupTime,
        returnTime: line.returnTime === undefined ? b.returnTime ?? null : line.returnTime,
        heroImage: images[0] ?? null, imageSources: images };
    }));
    return { status: b.status, lineItems, start: lineItems.length ? Math.min(...lineItems.map(l => l.start)) : null, end: lineItems.length ? Math.max(...lineItems.map(l => l.end)) : null,
      cancellationKind: bookingCancelKind(b, Date.now()), cancellationFullRefundDays: cancellationDaysForBooking(b),
      cancellationTermsVersion: b.agreementDocs?.find((d: { kind: string; version: string }) => d.kind === "cancellation")?.version ?? "2026-10-v10",
      direct: reservations.every(r => r.source === "site"),
      selfService: process.env.CUSTOMER_BOOKING_ACTIONS === "true",
      locked: !!(b.cancellationDecision || (b.activeAdditionId || b.activeExtensionId) || b.returnDecision) };
  },
});

/** Visible request drawer only: indexed, bounded catalogue results; no stock promise. */
export const equipment = query({
  args: { token: v.string(), bookingId: v.id("bookings"), search: v.string(),admin:v.optional(v.boolean()) },
  handler: async (ctx, { token, bookingId, search, admin }) => {
    let booking;
    if(admin){if(!checkAdminToken(token))throw Error("unauthorized");booking=await ctx.db.get(bookingId);if(!booking)throw Error("Rental unavailable.");}
    else{const account=await accountForToken(ctx,token,true);if(!account)throw Error("Please sign in.");booking=await ownedBooking(ctx,account,bookingId);}
    if (!["pending_payment", "confirmed", "active"].includes(booking.status)) return [];
    const term = search.trim();
    if (term.length > 100) throw Error("Search using a short equipment name.");
    // A pasted title may contain many hyphenated model tokens. Stay within
    // the search provider's term limit without crashing the request drawer.
    if (term && (!(term.match(/[\p{L}\p{N}]+/gu)?.length) || (term.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) > 12)) return [];
    const rows = term ? await ctx.db.query("listings").withSearchIndex("search_request_title", q => q.search("title", term).eq("active", true)).take(32)
      : await ctx.db.query("listings").withIndex("by_active", q => q.eq("active", true)).take(32);
    return rows.filter(requestableListing).slice(0, 12).map(listing => {
      const images = listingImages(listing);
      return { id: listing._id, title: listing.title, category: listing.category, heroImage: images[0] ?? null, imageSources: images };
    });
  },
});

/** Canonical selected equipment for the real owner action; no arbitrary row IDs. */
export const agreedKit = query({
  args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_change_requests")},
  handler:async(ctx,{token,bookingId,id})=>{
    if(!checkAdminToken(token))return null;
    const booking=await ctx.db.get(bookingId),request=await ctx.db.get(id),account=request?await ctx.db.get(request.accountId):null;
    if(!request||request.bookingId!==bookingId||request.kind!=="items"||!belongsToRentalAccount(booking,account))return null;
    const listing=request.kitSelection?.listingId?await ctx.db.get(request.kitSelection.listingId):null,images=listingImages(listing);
    const source=request.kitSelection?.sourceListingId?await ctx.db.get(request.kitSelection.sourceListingId):null,sourceImages=listingImages(source);
    return {id:request._id,status:request.status??"pending",detail:request.detail,decisionNote:request.decisionNote??null,kitSelection:request.kitSelection??null,execution:request.execution??null,
      target:listing?{id:listing._id,title:listing.title,heroImage:images[0]??null,imageSources:images,requestable:requestableListing(listing)}:null,
      sourceEquipment:source?{id:source._id,title:source.title,heroImage:sourceImages[0]??null,imageSources:sourceImages}:null};
  },
});

/** Requests reach a human; they never mutate dates, prices or payments. */
export const submit = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestId: v.string(),
    kind: v.union(v.literal("dates"), v.literal("items"), v.literal("extension"), v.literal("cancel")), detail: v.string(), kit: v.optional(kitRequestInput) },
  handler: async (ctx, { token, bookingId, requestId, kind, detail, kit }) => {
    const a = await accountForToken(ctx, token, true);
    if (!a) throw Error("Please sign in.");
    const b = await ownedBooking(ctx, a, bookingId);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw Error("Invalid request.");
    const previous = await ctx.db.query("rental_change_requests").withIndex("by_request", q => q.eq("requestId", requestId)).first();
    if (previous) {
      if (previous.accountId !== a._id || previous.bookingId !== bookingId || previous.kind !== kind || previous.detail !== detail.trim() || !sameKitInput(previous.kitSelection, kit)) throw Error("Request belongs to a different change.");
      return { ok: true, messageId: previous.messageId };
    }
    if (!["pending_payment", "confirmed", "active"].includes(b.status)) throw Error("This rental has finished. Please message the team instead.");
    if (kind === "cancel" && b.status === "active") throw Error("This rental has started. Ask the team about an early return instead.");
    if (b.cancellationDecision || b.returnDecision) throw Error("A cancellation or return is already being processed.");
    const text = detail.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Describe your request in 5–1000 characters.");
    if (kit && kind !== "items") throw Error("Equipment selection requires a kit request.");
    const selection = kit ? await resolveKitRequest(ctx, b, kit) : undefined;
    if (selection && selection.detail !== text) throw Error("Equipment changed. Review the selected item and send the request again.");
    const recent = await ctx.db.query("rental_change_requests").withIndex("by_account", q => q.eq("accountId", a._id)).order("desc").take(10);
    if (recent.filter(r => r.createdAt > Date.now() - 60000).length >= 3) throw Error("Please wait a minute before sending another request.");
    const thread = await rentalThread(ctx, a._id, bookingId);
    if (thread) await ctx.db.patch(thread._id, { escalated: true });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId, escalated: true, updatedAt: Date.now(), unreadOwner: 0, unreadRenter: 0 });
    const label = labels[kind];
    const messageId = await postRentalMessage(ctx, { accountId: a._id, bookingId, sender: "renter", text: `${label} request: ${text}`, meta: { type: "rental_change_request", kind, requestedStage: b.status } });
    await ctx.db.insert("rental_change_requests", { requestId, accountId: a._id, bookingId, kind, detail: text, messageId, createdAt: Date.now(), status: "pending", ...(selection ? { kitSelection: selection.snapshot } : {}) });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, bookingId, text: `${label} request: ${text}` });
    return { ok: true, messageId };
  },
});
