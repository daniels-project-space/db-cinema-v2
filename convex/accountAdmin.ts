import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { rentalsForAccount, belongsToRentalAccount } from "./lib/rentalAccount";
import { availableCreditRows } from "./lib/checkoutCredit";
import { listingImages } from "./lib/catalogImages";
import { paginationOptsValidator } from "convex/server";

export const directoryAccess = query({
  args: { token: v.string() },
  handler: async (_ctx, args) => checkAdminToken(args.token),
});

/** Bounded scans preserve cursor ordering across every account, including name
 * and email substring searches. Never load customer profiles or document bytes. */
export const directory = query({
  args: {
    token: v.string(), search: v.string(), paginationOpts: paginationOptsValidator,
    filter: v.union(v.literal("all"), v.literal("members"), v.literal("verified"), v.literal("pending")),
    tier: v.union(v.literal("all"), v.literal("standard"), v.literal("plus"), v.literal("pro"), v.literal("studio")),
    verification: v.optional(v.union(v.literal("all"), v.literal("verified"), v.literal("pending"))),
  },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) return { page: [], isDone: true, continueCursor: "" };
    if (args.search.length > 254) throw Error("Customer search is too long.");
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw Error("Invalid customer page size.");
    const result = await ctx.db.query("accounts").order("desc").paginate(args.paginationOpts);
    const search = args.search.trim().toLocaleLowerCase("en-GB");
    const now = Date.now();
    const matches = result.page.filter(account => {
      const tier = membershipActiveNow(account) ? membershipTierFor(account) ?? "standard" : "standard";
      const verified = account.rentalVerification ? account.rentalVerification.expiresAt > now : !!account.idVerified;
      return (!search || `${account.name ?? ""} ${account.email}`.toLocaleLowerCase("en-GB").includes(search)) &&
        (args.tier === "all" || tier === args.tier) &&
        (!args.verification || args.verification === "all" || (args.verification === "verified" ? verified : !verified)) &&
        (args.filter === "all" || args.filter === "members" && tier !== "standard" || args.filter === "verified" && verified || args.filter === "pending" && !verified);
    });
    return { ...result, page: await Promise.all(matches.map(async account => ({
      id: account._id, email: account.email, name: account.name ?? "", createdAt: account.createdAt,
      tier: membershipActiveNow(account) ? membershipTierFor(account) ?? "standard" : "standard",
      override: account.adminMembershipTier ?? "automatic", blocked: account.blockedAt != null,
      blockedReason: account.blockedReason ?? "", hasSubscription: !!account.stripeSubscriptionId,
      subscriptionTier: account.membershipTier ?? null,
      verified: account.rentalVerification ? account.rentalVerification.expiresAt > now : !!account.idVerified,
      avatarUrl: account.avatarStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : account.googleAvatarUrl ?? null,
    }))) };
  },
});

/** Load only the visible directory page. Operational counts exclude completed
 * and unpaid rentals; legacy email ownership never overrides an account link. */
export const directoryMetrics = query({
  args: { token: v.string(), accountIds: v.array(v.id("accounts")) },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) return [];
    if (args.accountIds.length > 10) throw Error("Invalid customer metrics page.");
    return Promise.all([...new Set(args.accountIds)].map(async id => {
      const account = await ctx.db.get(id);
      if (!account) return { id, activeRentals: 0, activeRentalsMore: false, credit: 0 };
      const active = (q: any) => q.or(q.eq(q.field("status"), "active"), q.eq(q.field("status"), "confirmed"));
      const [owned, legacy, credits] = await Promise.all([
        ctx.db.query("bookings").withIndex("by_account", q => q.eq("accountId", id)).filter(active).take(101),
        ctx.db.query("bookings").withIndex("by_guestEmail", q => q.eq("guestEmail", account.email.trim().toLowerCase()))
          .filter(q => q.and(active(q), q.eq(q.field("accountId"), undefined))).take(101),
        availableCreditRows(ctx, id),
      ]);
      const count = owned.length + legacy.length;
      return { id, activeRentals: Math.min(count, 100), activeRentalsMore: count > 100,
        credit: credits.reduce((n: number, c: any) => n + c.availablePence, 0) / 100 };
    }));
  },
});

const level = v.union(
  v.literal("standard"),
  v.literal("plus"),
  v.literal("pro"),
  v.literal("studio"),
  v.literal("automatic"),
);
export const search = query({
  args: { token: v.string(), email: v.string() },
  handler: async (ctx, a) => {
    if (!checkAdminToken(a.token))
      return { authorized: false, items: [], more: false };
    const prefix = a.email.trim().toLowerCase();
    if (prefix.length > 254) throw Error("Email search is too long.");
    const rows = prefix
      ? await ctx.db
          .query("accounts")
          .withIndex("by_email", (q) =>
            q.gte("email", prefix).lte("email", prefix + "\uffff"),
          )
          .take(51)
      : await ctx.db.query("accounts").order("desc").take(51);
    return {
      authorized: true,
      more: rows.length > 50,
      items: await Promise.all(
        rows.slice(0, 50).map(async (a) => ({
          id: a._id,
          email: a.email,
          name: a.name ?? "",
          createdAt: a.createdAt,
          tier: membershipActiveNow(a)
            ? (membershipTierFor(a) ?? "standard")
            : "standard",
          override: a.adminMembershipTier ?? "automatic",
          blocked: a.blockedAt != null,
          blockedReason: a.blockedReason ?? "",
          hasSubscription: !!a.stripeSubscriptionId,
          subscriptionTier: a.membershipTier ?? null,
          verified: a.rentalVerification
            ? a.rentalVerification.expiresAt > Date.now()
            : !!a.idVerified,
          avatarUrl: a.avatarStorageId
            ? await ctx.storage.getUrl(a.avatarStorageId)
            : (a.googleAvatarUrl ?? null),
        })),
      ),
    };
  },
});
export const setLevel = mutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    level,
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "accountAdmin.setLevel");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = a.reason.trim();
    if (!reason || reason.length > 500)
      throw Error("Add a reason of up to 500 characters.");
    if (
      account.adminMembershipTier === a.level ||
      (!account.adminMembershipTier && a.level === "automatic")
    )
      return;
    await ctx.db.patch(account._id, {
      adminMembershipTier: a.level === "automatic" ? undefined : a.level,
    });
    await ctx.db.insert("account_admin_changes", {
      accountId: account._id,
      at: Date.now(),
      kind: "level",
      before: account.adminMembershipTier ?? "automatic",
      after: a.level,
      reason,
    });
  },
});
export const setBlocked = mutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    blocked: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "accountAdmin.setBlocked");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = a.reason.trim();
    if (!reason || reason.length > 500)
      throw Error("Add a reason of up to 500 characters.");
    if ((account.blockedAt != null) === a.blocked) return;
    await ctx.db.patch(account._id, {
      blockedAt: a.blocked ? Date.now() : undefined,
      blockedReason: a.blocked ? reason : undefined,
    });
    if (a.blocked) {
      for (const session of await ctx.db
        .query("sessions")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect())
        await ctx.db.delete(session._id);
      for (const link of await ctx.db
        .query("account_access_links")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect())
        await ctx.db.delete(link._id);
    }
    await ctx.db.insert("account_admin_changes", {
      accountId: account._id,
      at: Date.now(),
      kind: a.blocked ? "block" : "unblock",
      before: account.blockedAt != null ? "blocked" : "active",
      after: a.blocked ? "blocked" : "active",
      reason,
    });
  },
});
export const history = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, a) =>
    checkAdminToken(a.token)
      ? ctx.db
          .query("account_admin_changes")
          .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
          .order("desc")
          .take(10)
      : [],
});

/** Admin-only projection; never return provider IDs, credentials or document URLs. */
export const detail = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw Error("unauthorized");
    const account = await ctx.db.get(args.accountId);
    if (!account) return null;
    const [bookings, credits, threads, notes] = await Promise.all([
      rentalsForAccount(ctx, account, 101),
      availableCreditRows(ctx, account._id),
      ctx.db
        .query("chat_threads")
        .withIndex("by_account_updated", (q) => q.eq("accountId", account._id))
        .order("desc")
        .take(20),
      ctx.db
        .query("account_admin_notes")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .order("desc")
        .take(20),
    ]);
    const rentalRows = await Promise.all(
      bookings.slice(0, 100).map(async (booking) => {
        const first = booking.lineItems?.[0];
        const listing = first?.listingId
          ? await ctx.db.get(first.listingId)
          : null;
        return {
          id: booking._id,
          status: booking.status,
          total: booking.total,
          title: first?.title ?? "Rental request",
          start: first
            ? Math.min(...booking.lineItems.map((l: any) => l.start))
            : null,
          end: first
            ? Math.max(...booking.lineItems.map((l: any) => l.end))
            : null,
          imageSources: listingImages(listing),
          quantity: (booking.lineItems ?? []).reduce(
            (n: number, l: any) => n + l.qty,
            0,
          ),
        };
      }),
    );
    const conversations = (
      await Promise.all(
        threads.map(async (thread) =>
          !thread.bookingId ||
          belongsToRentalAccount(await ctx.db.get(thread.bookingId), account)
            ? thread
            : null,
        ),
      )
    ).filter((t): t is NonNullable<typeof t> => !!t);
    return {
      id: account._id,
      phone: account.phone ?? null,
      address: account.address ?? null,
      createdAt: account.createdAt,
      membershipStatus: account.membershipStatus ?? null,
      membershipActive: membershipActiveNow(account),
      paidThrough: account.membershipPaidThrough ?? null,
      cancelAtPeriodEnd: !!account.membershipCancelAtPeriodEnd,
      verificationExpiresAt: account.rentalVerification?.expiresAt ?? null,
      credit:
        credits.reduce((n: number, c: any) => n + c.availablePence, 0) / 100,
      refundCredit:
        credits
          .filter((c: any) => c.kind === "refund")
          .reduce((n: number, c: any) => n + c.availablePence, 0) / 100,
      rentals: rentalRows,
      rentalsMore: bookings.length > 100,
      conversations: conversations
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((t) => ({
          id: t._id,
          bookingId: t.bookingId ?? null,
          lastMessage: t.lastMessage ?? "No messages yet",
          lastSender: t.lastSender ?? null,
          updatedAt: t.updatedAt,
          unread: t.unreadOwner ?? 0,
        })),
      notes: notes.map((n) => ({ id: n._id, text: n.text, at: n.at })),
    };
  },
});

export const addNote = mutation({
  args: { token: v.string(), accountId: v.id("accounts"), text: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.token, "accountAdmin.addNote");
    if (!(await ctx.db.get(args.accountId)))
      throw Error("Account no longer exists.");
    const text = args.text.trim();
    if (!text || text.length > 2000)
      throw Error("Add a note of up to 2,000 characters.");
    return ctx.db.insert("account_admin_notes", {
      accountId: args.accountId,
      text,
      at: Date.now(),
    });
  },
});
