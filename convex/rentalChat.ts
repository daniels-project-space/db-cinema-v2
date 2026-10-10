import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import schema from "./schema";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { listingImages } from "./lib/catalogImages";
import { listingAvailability } from "./availability";
import { rentalReplyTemplates } from "./lib/rentalReplyTemplates";
import { acknowledgeOwnerNotifications } from "./lib/adminPush";
import { accountForRental, belongsToRentalAccount, rentalsForAccount } from "./lib/rentalAccount";
import { bookingStockLines } from "../shared/rentalWindow";
import { requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { assertVerificationArchive } from "./verificationArchive";
import {
  accountForToken,
  ownedBooking,
  postRentalMessage,
  rentalThread,
} from "./lib/rentalChat";

async function ownerAccount(ctx: any, bookingId?: any, accountId?: any) {
  if (bookingId) {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return accountForRental(ctx,b);
  }
  return accountId ? ctx.db.get(accountId) : null;
}
async function bookingView(ctx: any, b: any, account: any, options: { includeAvailability?: boolean; thread?: any } = {}) {
  let verificationArchiveReady = false;
  if (b.idVerifyStatus === "verified") { try { await assertVerificationArchive(ctx, b); verificationArchiveReady = true; } catch {} }
  const thread = options.thread ?? (account ? await rentalThread(ctx, account._id, b._id) : null);
  const items = await Promise.all(
    bookingStockLines(b).map(async (li: any) => {
      const l = await ctx.db.get(li.listingId);
      const stock = options.includeAvailability && l
        ? await listingAvailability(ctx, {
            listingId: li.listingId,
            start: li.start,
            end: li.end,
            pickupTime: li.pickupTime,
            returnTime: li.returnTime,
            excludeBookingId: String(b._id),
          })
        : null;
      return {
        ...li,
        heroImage: listingImages(l)[0] ?? null,
        imageSources: listingImages(l),
        slug: l?.slug ?? null,
        stockAvailability: stock ? {
          availableUnits: stock.available,
          ownedUnits: stock.owned,
          requestedQty: li.qty,
          available: stock.available >= li.qty,
          blocked: !!stock.blocked,
        } : null,
      };
    }),
  );
  return {
    _id: b._id,
    status: b.status,
    idVerifyStatus: b.idVerifyStatus ?? "required",
    idVerificationSource: b.idVerificationSource ?? null,
    verificationChecks: b.verificationChecks ?? null,
    verificationArchiveReady,
    verificationExpiresAt: b.verificationExpiresAt ?? null,
    documentExpiresAt: b.documentExpiresAt ?? null,
    verificationUpdatedAt: b.verificationUpdatedAt ?? null,
    requiresDroneLicence: await requiresDroneLicence(ctx, b),
    droneLicenceStatus: await droneLicenceStatusForRental(ctx, b),
    depositHoldAmount: b.depositHoldAmount ?? 0,
    depositHoldStatus: b.depositHoldStatus ?? null,
    depositHoldExpiresAt: b.depositHoldExpiresAt ?? null,
    returnChecking: !!b.returnDecision && b.status !== "returned",
    guestEmail: account?.email ?? b.guestEmail,
    name: account?.name ?? null,
    verifiedRenterEmail: account?.emailVerifiedAt && typeof account.email === "string"
      ? account.email.trim().toLowerCase()
      : null,
    renterPhoto: account
      ? ((account.avatarStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null) ?? account.googleAvatarUrl ?? null)
      : null,
    start: Math.min(...items.map((li: any) => li.start)),
    end: Math.max(...items.map((li: any) => li.end)),
    total: b.total,
    items,
    accountId: account?._id ?? null,
    escalated: !!thread?.escalated,
    unreadOwner: thread?.unreadOwner ?? 0,
    unreadRenter: thread?.unreadRenter ?? 0,
    lastMessage: thread?.lastMessage ?? null,
    lastSender: thread?.lastSender ?? null,
    updatedAt: thread?.updatedAt ?? b._creationTime,
  };
}
export const mine = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = await accountForToken(ctx, token);
    if (!a) return null;
    const bookings = await rentalsForAccount(ctx,a,200);
    return Promise.all(bookings.map((b) => bookingView(ctx, b, a)));
  },
});
export const adminInbox = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) return { authorized: false, items: [] };
    const bookings = await ctx.db.query("bookings").order("desc").take(200);
    const conversations = await Promise.all(bookings.map(async (b) => {
      const account = await accountForRental(ctx, b);
      const thread = account ? await rentalThread(ctx, account._id, b._id) : null;
      return { booking: b, account, thread };
    }));
    const active = conversations
      .filter(({ thread }) => typeof thread?.lastMessage === "string" && thread.lastMessage.trim().length > 0)
      .sort((a, b) => (b.thread?.updatedAt ?? b.booking._creationTime) - (a.thread?.updatedAt ?? a.booking._creationTime))
      .slice(0, 100);
    const items = await Promise.all(active.map(({ booking, account, thread }) =>
      bookingView(ctx, booking, account, { includeAvailability: true, thread }),
    ));
    return { authorized: true, items };
  },
});

/** Private identity bridge for owner-only trust lookup in Rental Manager.
 *  Only verified DB Cinema emails are eligible for an exact cross-platform match. */
export const adminRenterIdentity = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return { authorized: false, email: null };
    const booking = await ctx.db.get(bookingId);
    if (!booking) return { authorized: true, email: null };
    const account = await accountForRental(ctx, booking);
    return {
      authorized: true,
      email: account?.emailVerifiedAt && typeof account.email === "string"
        ? account.email.trim().toLowerCase()
        : null,
    };
  },
});
export const messages = query({
  args: {
    token: v.string(),
    bookingId: v.optional(v.id("bookings")),
    admin: v.optional(v.boolean()),
    accountId: v.optional(v.id("accounts")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (
    ctx,
    { token, bookingId, admin, accountId, paginationOpts },
  ) => {
    let a: any;
    if (admin) {
      if (!checkAdminToken(token)) return null;
      a = await ownerAccount(ctx, bookingId, accountId);
    } else {
      a = await accountForToken(ctx, token);
      if (!a) return null;
      if (bookingId) await ownedBooking(ctx, a, bookingId);
    }
    if (!a)
      return { page: [], isDone: true, continueCursor: "", escalated: false };
    // Account filter also protects old rows created before booking ownership was enforced.
    const page = await ctx.db
      .query("messages")
      .withIndex("by_booking_at", (q) => q.eq("bookingId", bookingId))
      .filter((q) => q.eq(q.field("accountId"), a._id))
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(50, paginationOpts.numItems),
      });
    const thread = await rentalThread(ctx, a._id, bookingId);
    return { ...page, escalated: !!thread?.escalated,
      quickReplies: admin ? rentalReplyTemplates(bookingId ? await ctx.db.get(bookingId) : null, await ctx.db.query("settings").first()) : [],
      renter: { name: a.name?.split(/\s+/)[0] ?? "Renter",
        photo: (a.avatarStorageId ? await ctx.storage.getUrl(a.avatarStorageId) : null) ?? a.googleAvatarUrl ?? null },
    };
  },
});
export const ownerDraftContext = internalQuery({
  args: { token: v.string(), bookingId: v.optional(v.id("bookings")), accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { token, bookingId, accountId }) => {
    if (!checkAdminToken(token)) throw Error("unauthorized");
    const account = await ownerAccount(ctx, bookingId, accountId);
    if (!account) throw Error("No renter account yet.");
    return { accountId: account._id, bookingId };
  },
});
export const sendOwner = mutation({
  args: {
    token: v.string(),
    bookingId: v.optional(v.id("bookings")),
    accountId: v.optional(v.id("accounts")),
    text: v.string(),
  },
  handler: async (ctx, { token, bookingId, accountId, text }) => {
    await assertAdmin(ctx, token, "rentalChat.sendOwner");
    const a = await ownerAccount(ctx, bookingId, accountId);
    if (!a)
      throw Error(
        "The renter must create an account with their booking email to use chat.",
      );
    if (!text.trim() || text.trim().length > 2000)
      throw Error("Write a message of up to 2,000 characters.");
    await postRentalMessage(ctx, {
      accountId: a._id,
      bookingId,
      sender: "owner",
      text: text.trim(),
    });
    const t = await rentalThread(ctx, a._id, bookingId);
    if (t) await ctx.db.patch(t._id, { escalated: true });
    await acknowledgeOwnerNotifications(ctx, a._id, bookingId);
    return { ok: true };
  },
});
export const markRead = mutation({
  args: {
    token: v.string(),
    bookingId: v.optional(v.id("bookings")),
    admin: v.optional(v.boolean()),
    accountId: v.optional(v.id("accounts")),
    through: v.id("messages"),
  },
  handler: async (ctx, { token, bookingId, admin, accountId, through }) => {
    let a: any;
    if (admin) {
      await assertAdmin(ctx, token, "rentalChat.markRead");
      a = await ownerAccount(ctx, bookingId, accountId);
    } else {
      a = await accountForToken(ctx, token);
      if (bookingId) await ownedBooking(ctx, a, bookingId);
    }
    if (!a) return;
    const t = await rentalThread(ctx, a._id, bookingId);
    if (!t) return;
    const seen = await ctx.db.get(through);
    if (!seen || seen.accountId !== a._id || seen.bookingId !== bookingId)
      throw Error("Invalid read marker");
    const previous = admin ? t.ownerReadAt : t.renterReadAt;
    if (previous != null && previous > seen.at) return;
    if (admin) await acknowledgeOwnerNotifications(ctx, a._id, bookingId, seen.at);
    // at is monotonic for new messages; creation time disambiguates historical ties.
    const newer = await ctx.db
      .query("messages")
      .withIndex("by_booking_at", (q) =>
        q.eq("bookingId", bookingId).gte("at", seen.at),
      )
      .filter((q) => q.eq(q.field("accountId"), a._id))
      .collect();
    const unread = newer.filter(
      (m) =>
        (m.at > seen.at || m._creationTime > seen._creationTime) &&
        (admin ? m.sender === "renter" : m.sender !== "renter"),
    ).length;
    await ctx.db.patch(
      t._id,
      admin
        ? { unreadOwner: unread, ownerReadAt: seen.at }
        : { unreadRenter: unread, renterReadAt: seen.at },
    );
    if (bookingId)
      await ctx.db.patch(
        bookingId,
        admin ? { chatUnreadOwner: unread } : { chatUnreadRenter: unread },
      );
  },
});
export const setHandler = mutation({
  args: {
    token: v.string(),
    bookingId: v.optional(v.id("bookings")),
    accountId: v.optional(v.id("accounts")),
    gaffer: v.boolean(),
  },
  handler: async (ctx, { token, bookingId, accountId, gaffer }) => {
    await assertAdmin(ctx, token, "rentalChat.setHandler");
    const a = await ownerAccount(ctx, bookingId, accountId);
    if (!a) throw Error("No renter account yet");
    const t = await rentalThread(ctx, a._id, bookingId);
    await acknowledgeOwnerNotifications(ctx, a._id, bookingId);
    if (t)
      await ctx.db.patch(t._id, { escalated: !gaffer, updatedAt: Date.now() });
    else
      await ctx.db.insert("chat_threads", {
        accountId: a._id,
        bookingId,
        escalated: !gaffer,
        updatedAt: Date.now(),
      });
    await postRentalMessage(ctx, {
      accountId: a._id,
      bookingId,
      sender: "system",
      text: gaffer
        ? "Gaffer is here to help with this rental."
        : "The team is handling this conversation.",
    });
    if (gaffer)
      await ctx.scheduler.runAfter(0, internal.gaffer.gafferReply, {
        accountId: a._id,
        bookingId,
      });
  },
});

export const minePage = query({
  args: { token: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, paginationOpts }) => {
    if (!Number.isInteger(paginationOpts.numItems) || paginationOpts.numItems < 1) throw Error("Invalid rental page size");
    const a = await accountForToken(ctx, token);
    if (!a) return { page: [], isDone: true, continueCursor: "" };
    const linked = stream(ctx.db, schema).query("bookings")
      .withIndex("by_account_chat_updated", q => q.eq("accountId", a._id)).order("desc");
    const legacy = stream(ctx.db, schema).query("bookings")
      .withIndex("by_account_guest_chat_updated", q => q.eq("accountId", undefined).eq("guestEmail", a.email)).order("desc");
    const page = await mergedStream([linked, legacy], ["chatUpdatedAt", "_creationTime"]).paginate({
        ...paginationOpts,
        numItems: Math.min(50, paginationOpts.numItems),
        maximumRowsRead: 100,
      });
    return {
      ...page,
      page: await Promise.all(page.page.map((b) => bookingView(ctx, b, a))),
    };
  },
});
export const adminPage = query({
  args: {
    token: v.string(),
    stage: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { token, stage, paginationOpts }) => {
    if (!checkAdminToken(token))
      return { page: [], isDone: true, continueCursor: "" };
    const statuses = [
      "pending_payment",
      "confirmed",
      "active",
      "returned",
      "cancelled",
    ] as const;
    if (stage && stage !== "unread" && !statuses.includes(stage as any))
      throw Error("Invalid rental stage");
    const query =
      stage === "unread"
        ? ctx.db
            .query("bookings")
            .withIndex("by_owner_unread_updated", (q) =>
              q.gt("chatUnreadOwner", 0),
            )
        : stage
          ? ctx.db
              .query("bookings")
              .withIndex("by_status_chat_updated", (q) =>
                q.eq("status", stage as (typeof statuses)[number]),
              )
          : ctx.db.query("bookings").withIndex("by_chat_updated");
    const page = await query.order("desc").paginate({
      ...paginationOpts,
      numItems: Math.min(50, paginationOpts.numItems),
    });
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (b) => {
          const a = await accountForRental(ctx, b);
          return bookingView(ctx, b, a);
        }),
      ),
    };
  },
});
export const unreadTotals = query({
  args: { token: v.string(), admin: v.optional(v.boolean()) },
  handler: async (ctx, { token, admin }) => {
    if (admin && !checkAdminToken(token)) return 0;
    const account = admin ? null : await accountForToken(ctx, token);
    if (!admin && !account) return 0;
    const threads = admin
      ? await ctx.db.query("chat_threads").collect()
      : await ctx.db
          .query("chat_threads")
          .withIndex("by_account", (q) => q.eq("accountId", account!._id))
          .collect();
    return threads.reduce(
      (sum, t) => sum + (admin ? (t.unreadOwner ?? 0) : (t.unreadRenter ?? 0)),
      0,
    );
  },
});

async function generalConversationView(ctx: any, t: any) {
  const a = await ctx.db.get(t.accountId);
  return { _id: t.accountId, accountId: t.accountId, status: "support" as const,
    name: a?.name ?? null, guestEmail: a?.email ?? "", start: 0, end: 0, total: 0, items: [],
    escalated: t.escalated, unreadOwner: t.unreadOwner ?? 0, unreadRenter: t.unreadRenter ?? 0,
    lastMessage: t.lastMessage ?? null, lastSender: t.lastSender ?? null, updatedAt: t.updatedAt };
}
export const getGeneralConversation = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, { token, accountId }) => {
    if (!checkAdminToken(token)) return null;
    const account = await ctx.db.get(accountId);
    if (!account) return null;
    const thread = await rentalThread(ctx, accountId);
    return thread ? generalConversationView(ctx, thread) : null;
  },
});
export const generalOwnerPage = query({
  args: { token: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, paginationOpts }) => {
    if (!checkAdminToken(token))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("chat_threads")
      .withIndex("by_updated")
      .filter((q) => q.eq(q.field("bookingId"), undefined))
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(50, paginationOpts.numItems),
      });
    const entries = await Promise.all(
      page.page.map(t => generalConversationView(ctx, t)),
    );
    return { ...page, page: entries };
  },
});
export const getConversation = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    admin: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, bookingId, admin }) => {
    let account: any, b: any;
    if (admin) {
      if (!checkAdminToken(token)) return null;
      b = await ctx.db.get(bookingId);
      if (!b) return null;
      account = await ownerAccount(ctx, bookingId);
    } else {
      account = await accountForToken(ctx, token);
      if (!account) return null;
      b = await ownedBooking(ctx, account, bookingId);
    }
    return bookingView(ctx, b, account);
  },
});

/** One-time bounded migration. Per-message receipts make retries safe alongside new messages. */
export const migrateLegacyUnread = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("messages")
      .order("asc")
      .paginate({ numItems: 100, cursor });
    let migrated = 0;
    for (const m of page.page) {
      if (m.threadCounted) continue;
      const account = await ctx.db.get(m.accountId);
      if (!account) continue;
      const b = m.bookingId ? await ctx.db.get(m.bookingId) : null;
      if (m.bookingId && !belongsToRentalAccount(b, account))
        continue;
      const t = await rentalThread(ctx, m.accountId, m.bookingId);
      const ownerUnread =
        m.sender === "renter" && !m.readByOwner && m.at > (t?.ownerReadAt ?? 0);
      const renterUnread =
        m.sender !== "renter" && m.at > (t?.renterReadAt ?? 0);
      const patch = {
        unreadOwner: (t?.unreadOwner ?? 0) + (ownerUnread ? 1 : 0),
        unreadRenter: (t?.unreadRenter ?? 0) + (renterUnread ? 1 : 0),
        ...(m.at >= (t?.updatedAt ?? 0)
          ? {
              updatedAt: m.at,
              lastMessage: m.text.slice(0, 160),
              lastSender: m.sender,
            }
          : {}),
      };
      if (t) await ctx.db.patch(t._id, patch);
      else
        await ctx.db.insert("chat_threads", {
          accountId: m.accountId,
          bookingId: m.bookingId,
          escalated: false,
          updatedAt: m.at,
          ...patch,
        });
      if (b)
        await ctx.db.patch(b._id, {
          chatUpdatedAt: Math.max(t?.updatedAt ?? 0, m.at),
          chatUnreadOwner: patch.unreadOwner,
          chatUnreadRenter: patch.unreadRenter,
        });
      await ctx.db.patch(m._id, { threadCounted: true });
      migrated++;
    }
    return { cursor: page.continueCursor, isDone: page.isDone, migrated };
  },
});

export const unreadBreakdown = query({
  args: { token: v.string(), admin: v.optional(v.boolean()) },
  handler: async (ctx, { token, admin }) => {
    if (admin && !checkAdminToken(token)) return { rentals: 0, general: 0 };
    const account = admin ? null : await accountForToken(ctx, token);
    if (!admin && !account) return { rentals: 0, general: 0 };
    const threads = admin
      ? await ctx.db.query("chat_threads").collect()
      : await ctx.db
          .query("chat_threads")
          .withIndex("by_account", (q) => q.eq("accountId", account!._id))
          .collect();
    return threads.reduce(
      (sum, t) => {
        const count = admin ? (t.unreadOwner ?? 0) : (t.unreadRenter ?? 0);
        if (t.bookingId) sum.rentals += count;
        else sum.general += count;
        return sum;
      },
      { rentals: 0, general: 0 },
    );
  },
});
