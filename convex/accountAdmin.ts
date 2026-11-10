import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { membershipSnapshot } from "./lib/membershipSnapshot";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { rentalsForAccount, belongsToRentalAccount } from "./lib/rentalAccount";
import { availableCreditRows } from "./lib/checkoutCredit";
import { listingRentalImages } from "./lib/catalogImages";
import { paginationOptsValidator } from "convex/server";
import { accountVerificationReady } from "./lib/accountVerificationReady";
import { verificationValidUntil } from "../shared/verificationProgress";
import { customerAdminVisual, customerSubscriptionTier } from "../shared/customerAdminVisual";
import { earnedEncoreProgress } from "./lib/loyalty";
import { approvedRestrictedIdentitySource, restrictedIdentityMatches } from "./lib/restrictedIdentityMatch";
import { internal } from "./_generated/api";
import { queueRestrictedAccountRecheck } from "./restrictedIdentityAlerts";
import { adminSessionMigrationReady, assertAdminScopeSession, assertCustomerReadSession, assertCustomerWriteSession } from "./adminAccountSessionV2";
import type { MutationCtx, QueryCtx } from "./_generated/server";

async function customerReadAuthorized(ctx: QueryCtx, token: string): Promise<boolean> {
  if (process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
    await assertCustomerReadSession(ctx, token);
    return true;
  }
  return checkAdminToken(token);
}

async function authorizeCustomerWrite(ctx: MutationCtx, token: string, fn: string): Promise<void> {
  if (process.env.ADMIN_SESSION_CUSTOMER_WRITE_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
    await assertCustomerWriteSession(ctx, token);
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn });
    return;
  }
  await assertAdmin(ctx, token, fn);
}

export const directoryAccess = query({
  args: { token: v.string() },
  handler: async (ctx, args) => customerReadAuthorized(ctx, args.token),
});

export const possibleRestrictedIdentityMatches = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    if (process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 === "enabled" || process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx, args.token, "verification:read");
      if (process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled") await assertCustomerReadSession(ctx, args.token);
    } else if (!await customerReadAuthorized(ctx, args.token)) return { matches: [], more: false };
    const booking = await ctx.db.get(args.bookingId);
    if (!await approvedRestrictedIdentitySource(ctx,booking) || !booking?.renterPersonKey) return { matches: [], more: false };
    const result = await restrictedIdentityMatches(ctx, booking, booking.renterPersonKey);
    return { matches: result.matches.map((account: any) => ({ id: account._id, name: account.name ?? "", email: account.email, blockedAt: account.blockedAt, blockedReason: account.blockedReason ?? "" })), more: result.more };
  },
});

const directoryView = v.optional(v.union(v.literal("all"), v.literal("unread"), v.literal("starred")));
const ENCORE_FILTER_SCAN_PAGE = 20;

function effectiveAccessTier(account: any) {
  return membershipActiveNow(account) ? membershipTierFor(account) ?? "standard" : "standard";
}

async function effectiveEncoreTier(ctx: any, account: any) {
  const progress = await earnedEncoreProgress(ctx, account);
  return progress.completed;
}

function tierFilterMatches(filter: string, subscriptionTier: string | null) {
  return filter === "all" || (filter === "standard" ? subscriptionTier == null : subscriptionTier === filter);
}

async function belongsToCustomerConversation(ctx: QueryCtx, account: any, conversation: { bookingId?: any }) {
  return !conversation.bookingId || belongsToRentalAccount(await ctx.db.get(conversation.bookingId), account);
}

async function matchesDirectoryView(ctx: any, account: any, view: "all" | "unread" | "starred" | undefined) {
  if (view === "starred") return account.adminStarred === true;
  if (view !== "unread") return true;
  const threads = await ctx.db.query("chat_threads")
    .withIndex("by_account_unread_owner", (q: any) => q.eq("accountId", account._id).gt("unreadOwner", 0))
    .take(100);
  for (const thread of threads) if (await belongsToCustomerConversation(ctx, account, thread)) return true;
  return false;
}

export const setStarred = mutation({
  args: { token: v.string(), accountId: v.id("accounts"), starred: v.boolean() },
  handler: async (ctx, args) => {
    if (process.env.ADMIN_SESSION_STARRED_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
      await assertCustomerWriteSession(ctx, args.token);
      await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn: "accountAdmin.setStarred" });
    } else {
      await assertAdmin(ctx, args.token, "accountAdmin.setStarred");
    }
    const account = await ctx.db.get(args.accountId);
    if (!account) throw Error("Account no longer exists.");
    if ((account.adminStarred === true) !== args.starred)
      await ctx.db.patch(account._id, { adminStarred: args.starred ? true : undefined });
  },
});

export const billingPortalTarget = internalMutation({
  args: { token: v.string(), accountId: v.id("accounts"), purpose: v.optional(v.union(v.literal("portal"), v.literal("membership_refresh"))) },
  handler: async (ctx, { token, accountId, purpose }) => {
    if ((purpose === "portal" && process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") || (purpose === "membership_refresh" && process.env.ADMIN_SESSION_MEMBERSHIP_REFRESH_V2 === "enabled")) {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx, token, "payments:write");
      await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn: `accountAdmin.billingPortal:${accountId}` });
    } else await assertAdmin(ctx, token, `accountAdmin.billingPortal:${accountId}`);
    const account = await ctx.db.get(accountId);
    if (!account?.stripeCustomerId || !account.stripeSubscriptionId)
      throw Error("This account does not have a linked Stripe subscription and customer.");
    return { customerId: account.stripeCustomerId, subscriptionId: account.stripeSubscriptionId, membershipSnapshot: membershipSnapshot(account) };
  },
});

export const billingCustomerPortalTarget = internalMutation({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, { token, accountId }) => {
    if (process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx, token, "payments:write");
      await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn: `accountAdmin.billingPortal:${accountId}` });
    } else await assertAdmin(ctx, token, `accountAdmin.billingPortal:${accountId}`);
    const account = await ctx.db.get(accountId);
    if (!account?.stripeCustomerId) throw Error("This account does not have a linked Stripe customer.");
    return { customerId: account.stripeCustomerId };
  },
});

export const membershipInvoiceReceipt = internalQuery({
  args:{accountId:v.id("accounts"),customerId:v.string(),subscriptionId:v.string(),invoiceId:v.string()},
  handler:async(ctx,args)=>{
    const account=await ctx.db.get(args.accountId);
    if(!account||account.stripeCustomerId!==args.customerId||account.stripeSubscriptionId!==args.subscriptionId)throw Error("The billing link changed. Review the account and try again.");
    const grant=await ctx.db.query("membership_credit_grants").withIndex("by_invoice",q=>q.eq("invoiceId",args.invoiceId)).unique();
    if(!grant)return null;
    if(grant.accountId!==args.accountId||grant.subscriptionId!==args.subscriptionId)throw Error("The invoice credit receipt belongs to another account. Review it before continuing.");
    return {creditPence:grant.creditPence,bonusPence:grant.bonusPence,revokedPence:grant.revokedPence,paidMembershipPence:grant.paidMembershipPence,membershipRefundedPence:grant.membershipRefundedPence,createdAt:grant.createdAt,historicalPriceId:grant.historicalPriceId};
  },
});

/** Bounded scans preserve cursor ordering across every account, including name
 * and email substring searches. Never load customer profiles or document bytes. */
export const directory = query({
  args: {
    token: v.string(), search: v.string(), paginationOpts: paginationOptsValidator,
    filter: v.union(v.literal("all"), v.literal("members"), v.literal("verified"), v.literal("pending")),
    tier: v.union(v.literal("all"), v.literal("standard"), v.literal("plus"), v.literal("pro"), v.literal("studio")),
    encore: v.optional(v.union(v.literal("all"), v.literal("automatic"), v.literal("1"), v.literal("2"), v.literal("3"))),
    verification: v.optional(v.union(v.literal("all"), v.literal("verified"), v.literal("pending"))),
    view: directoryView,
  },
  handler: async (ctx, args) => {
    if (!await customerReadAuthorized(ctx, args.token)) return { page: [], isDone: true, continueCursor: "" };
    if (args.search.length > 254) throw Error("Customer search is too long.");
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw Error("Invalid customer page size.");
    const encoreFilter = args.encore && ["1", "2", "3"].includes(args.encore);
    const pageOpts = encoreFilter
      ? { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, ENCORE_FILTER_SCAN_PAGE) }
      : args.paginationOpts;
    const result = await ctx.db.query("accounts").order("desc").paginate(pageOpts);
    const search = args.search.trim().toLocaleLowerCase("en-GB");
    const checked=await Promise.all(result.page.map(async account=>({account,readiness:await accountVerificationReady(ctx,account),viewMatch:await matchesDirectoryView(ctx,account,args.view)})));
    const baseMatches = checked.filter(({account,viewMatch}) => {
      const subscriptionTier = customerSubscriptionTier(account);
      return viewMatch && (!search || `${account.name ?? ""} ${account.email}`.toLocaleLowerCase("en-GB").includes(search)) &&
        tierFilterMatches(args.tier, subscriptionTier);
    });
    const matches = await Promise.all(baseMatches.map(async row => ({
      ...row,
      accessTier: effectiveAccessTier(row.account),
      effectiveEncore: args.encore && ["1", "2", "3"].includes(args.encore)
        ? await effectiveEncoreTier(ctx, row.account)
        : row.account.adminEncoreLevel ?? 0,
    })));
    const filtered = matches.filter(({account,readiness,effectiveEncore,accessTier}) => {
      const verified = !!readiness;
      const encoreMatch = !args.encore || args.encore === "all" ||
        (args.encore === "automatic" ? account.adminEncoreLevel == null : effectiveEncore !== null && String(effectiveEncore) === args.encore);
      return encoreMatch &&
        (!args.verification || args.verification === "all" || (args.verification === "verified" ? verified : !verified)) &&
        (args.filter === "all" || args.filter === "members" && accessTier !== "standard" || args.filter === "verified" && verified || args.filter === "pending" && !verified);
    });
    return { ...result, page: await Promise.all(filtered.map(async ({account,readiness,accessTier}) => ({
      id: account._id, email: account.email, name: account.name ?? "", createdAt: account.createdAt,
      tier: accessTier,
      override: account.adminMembershipTier ?? "automatic", encoreOverride: account.adminEncoreLevel == null ? "automatic" : String(account.adminEncoreLevel), blocked: account.blockedAt != null,
      blockedReason: account.blockedReason ?? "", blockedAt: account.blockedAt ?? null, restrictionRevision: account.restrictionRevision ?? 0, restrictionNoticeId: account.restrictionNoticeId ?? null, hasSubscription: !!account.stripeSubscriptionId, visualTier: customerAdminVisual(account), starred: account.adminStarred === true,
      subscriptionTier: customerSubscriptionTier(account),
      verified: !!readiness, verifiedUntil: readiness?.proofExpiresAt ?? null,
      avatarUrl: account.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : account.googleAvatarUrl ?? null,
    }))) };
  },
});

export const searchMessages = query({
  args: {
    token: v.string(), search: v.string(),
    paginationOpts: paginationOptsValidator,
    filter: v.union(v.literal("all"), v.literal("members"), v.literal("verified"), v.literal("pending")),
    tier: v.union(v.literal("all"), v.literal("standard"), v.literal("plus"), v.literal("pro"), v.literal("studio")),
    encore: v.optional(v.union(v.literal("all"), v.literal("automatic"), v.literal("1"), v.literal("2"), v.literal("3"))),
    verification: v.optional(v.union(v.literal("all"), v.literal("verified"), v.literal("pending"))),
    view: directoryView,
  },
  handler: async (ctx, args) => {
    if (!await customerReadAuthorized(ctx, args.token)) return { page: [], isDone: true, continueCursor: "" };
    const search = args.search.trim();
    if (search.length > 254) throw Error("Customer search is too long.");
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw Error("Invalid customer message page size.");
    if (search.length < 2) return { page: [], isDone: true, continueCursor: "" };
    const encoreFilter = args.encore && ["1", "2", "3"].includes(args.encore);
    const pageOpts = encoreFilter
      ? { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, ENCORE_FILTER_SCAN_PAGE) }
      : args.paginationOpts;
    const result = await ctx.db.query("messages")
      .withSearchIndex("search_text", q => q.search("text", search))
      .paginate(pageOpts);
    const seen = new Set<string>();
    const page = [];
    for (const message of result.page) {
      const accountId = String(message.accountId);
      if (seen.has(accountId)) continue;
      const account = await ctx.db.get(message.accountId);
      if (!account) continue;
      if (!await belongsToCustomerConversation(ctx, account, message)) continue;
      seen.add(accountId);
      if (!await matchesDirectoryView(ctx, account, args.view)) continue;
      const readiness = await accountVerificationReady(ctx, account);
      const verified = !!readiness;
      const tier = effectiveAccessTier(account);
      const subscriptionTier = customerSubscriptionTier(account);
      const effectiveEncore = args.encore && ["1", "2", "3"].includes(args.encore)
        ? await effectiveEncoreTier(ctx, account)
        : account.adminEncoreLevel ?? 0;
      const encoreMatch = !args.encore || args.encore === "all" ||
        (args.encore === "automatic" ? account.adminEncoreLevel == null : effectiveEncore !== null && String(effectiveEncore) === args.encore);
      if (!tierFilterMatches(args.tier, subscriptionTier)) continue;
      if (!encoreMatch) continue;
      if (args.verification && args.verification !== "all" && (args.verification === "verified" ? !verified : verified)) continue;
      if (!(args.filter === "all" || args.filter === "members" && tier !== "standard" || args.filter === "verified" && verified || args.filter === "pending" && !verified)) continue;
      page.push({
        id: account._id, email: account.email, name: account.name ?? "", createdAt: account.createdAt,
        tier, override: account.adminMembershipTier ?? "automatic", encoreOverride: account.adminEncoreLevel == null ? "automatic" : String(account.adminEncoreLevel),
        blocked: account.blockedAt != null, blockedReason: account.blockedReason ?? "", blockedAt: account.blockedAt ?? null, restrictionRevision: account.restrictionRevision ?? 0, restrictionNoticeId: account.restrictionNoticeId ?? null, hasSubscription: !!account.stripeSubscriptionId, visualTier: customerAdminVisual(account),
        subscriptionTier, verified, verifiedUntil: readiness?.proofExpiresAt ?? null, starred: account.adminStarred === true,
        avatarUrl: account.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : account.googleAvatarUrl ?? null,
        matchedMessage: message.text.slice(0, 150),
      });
    }
    return { ...result, page };
  },
});

/** Load only the visible directory page. Operational counts exclude completed
 * and unpaid rentals; legacy email ownership never overrides an account link. */
export const directoryMetrics = query({
  args: { token: v.string(), accountIds: v.array(v.id("accounts")) },
  handler: async (ctx, args) => {
    if (!await customerReadAuthorized(ctx, args.token)) return [];
    if (args.accountIds.length > 11) throw Error("Invalid customer metrics page.");
    return Promise.all([...new Set(args.accountIds)].map(async id => {
      const account = await ctx.db.get(id);
      if (!account) return { id, activeRentals: 0, activeRentalsMore: false, credit: 0, unreadMessages: 0, lastMessage: null, visualTier: "guest" as const, encoreLevel: 0 };
      const active = (q: any) => q.or(q.eq(q.field("status"), "active"), q.eq(q.field("status"), "confirmed"));
      const [owned, legacy, credits, unreadThreads, recentThreads] = await Promise.all([
        ctx.db.query("bookings").withIndex("by_account", q => q.eq("accountId", id)).filter(active).take(101),
        ctx.db.query("bookings").withIndex("by_guestEmail", q => q.eq("guestEmail", account.email.trim().toLowerCase()))
          .filter(q => q.and(active(q), q.eq(q.field("accountId"), undefined))).take(101),
        availableCreditRows(ctx, id),
        ctx.db.query("chat_threads").withIndex("by_account_unread_owner", q => q.eq("accountId", id).gt("unreadOwner", 0)).take(100),
        ctx.db.query("chat_threads").withIndex("by_account_updated", q => q.eq("accountId", id)).order("desc").take(100),
      ]);
      const [validUnread, validRecent] = await Promise.all([
        Promise.all(unreadThreads.map(thread => belongsToCustomerConversation(ctx, account, thread))),
        Promise.all(recentThreads.map(thread => belongsToCustomerConversation(ctx, account, thread))),
      ]);
      const latestThread = recentThreads.find((_, index) => validRecent[index]);
      const progress = await earnedEncoreProgress(ctx, account);
      const earnedEncoreLevel = progress.completed;
      const count = owned.length + legacy.length;
      return { id, activeRentals: Math.min(count, 100), activeRentalsMore: count > 100,
        credit: credits.reduce((n: number, c: any) => n + c.availablePence, 0) / 100,
        unreadMessages: Math.min(100, unreadThreads.reduce((n, thread, index) => n + (validUnread[index] ? thread.unreadOwner ?? 0 : 0), 0)),
        lastMessage: typeof latestThread?.lastMessage === "string" ? latestThread.lastMessage.slice(0, 150) : null,
        visualTier: customerAdminVisual(account, earnedEncoreLevel ?? undefined), earnedEncoreLevel,
        encoreLevel: account.adminEncoreLevel ?? earnedEncoreLevel };
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
    if (!await customerReadAuthorized(ctx, a.token))
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
          encoreOverride: a.adminEncoreLevel == null ? "automatic" : String(a.adminEncoreLevel),
          blocked: a.blockedAt != null,
          blockedReason: a.blockedReason ?? "",
          hasSubscription: !!a.stripeSubscriptionId,
          subscriptionTier: a.membershipTier ?? null,
          verified: !!await accountVerificationReady(ctx,a),
          avatarUrl: a.avatarStorageId && a.avatarStorageId === a.avatarOwnedStorageId
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
    expectedLevel: level,
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await authorizeCustomerWrite(ctx, a.token, "accountAdmin.setLevel");
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
    if ((account.adminMembershipTier ?? "automatic") !== a.expectedLevel)
      throw Error("Membership access changed in another session. Review the current level and try again.");
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
export const setEncoreLevel = mutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    level: v.union(v.literal("automatic"), v.literal(1), v.literal(2), v.literal(3)),
    expectedLevel: v.union(v.literal("automatic"), v.literal(1), v.literal(2), v.literal(3)),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await authorizeCustomerWrite(ctx, a.token, "accountAdmin.setEncoreLevel");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = a.reason.trim();
    if (!reason || reason.length > 500)
      throw Error("Add a reason of up to 500 characters.");
    if (
      account.adminEncoreLevel === a.level ||
      (account.adminEncoreLevel == null && a.level === "automatic")
    )
      return;
    if ((account.adminEncoreLevel ?? "automatic") !== a.expectedLevel)
      throw Error("Encore access changed in another session. Review the current level and try again.");
    await ctx.db.patch(account._id, {
      adminEncoreLevel: a.level === "automatic" ? undefined : a.level,
    });
    await ctx.db.insert("account_admin_changes", {
      accountId: account._id,
      at: Date.now(),
      kind: "encore_level",
      before: account.adminEncoreLevel == null ? "automatic" : String(account.adminEncoreLevel),
      after: a.level === "automatic" ? "automatic" : String(a.level),
      reason,
    });
  },
});
/** Update the two account-level rental entitlements together. Keeping this as
 * one mutation means an operator can promote or correct a member without a
 * partial tier change if one of the fields became stale in another session. */
export const setRentalAccess = mutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    level,
    expectedLevel: level,
    encoreLevel: v.union(v.literal("automatic"), v.literal(1), v.literal(2), v.literal(3)),
    expectedEncoreLevel: v.union(v.literal("automatic"), v.literal(1), v.literal(2), v.literal(3)),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await authorizeCustomerWrite(ctx, args.token, "accountAdmin.setRentalAccess");
    const account = await ctx.db.get(args.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = args.reason.trim();
    if (!reason || reason.length > 500) throw Error("Add a reason of up to 500 characters.");

    const currentLevel = account.adminMembershipTier ?? "automatic";
    const currentEncore = account.adminEncoreLevel == null ? "automatic" : account.adminEncoreLevel;
    if (currentLevel !== args.expectedLevel || currentEncore !== args.expectedEncoreLevel)
      throw Error("Membership access changed in another session. Review both current levels and try again.");

    const nextEncore = args.encoreLevel === "automatic" ? undefined : args.encoreLevel;
    const levelChanged = currentLevel !== args.level;
    const encoreChanged = currentEncore !== args.encoreLevel;
    if (!levelChanged && !encoreChanged) return { updated: false };

    await ctx.db.patch(account._id, {
      ...(levelChanged ? { adminMembershipTier: args.level === "automatic" ? undefined : args.level } : {}),
      ...(encoreChanged ? { adminEncoreLevel: nextEncore } : {}),
    });
    const at = Date.now();
    if (levelChanged) await ctx.db.insert("account_admin_changes", {
      accountId: account._id,
      at,
      kind: "level",
      before: currentLevel,
      after: args.level,
      reason,
    });
    if (encoreChanged) await ctx.db.insert("account_admin_changes", {
      accountId: account._id,
      at,
      kind: "encore_level",
      before: String(currentEncore),
      after: String(args.encoreLevel),
      reason,
    });
    return { updated: true, levelChanged, encoreChanged };
  },
});
export const updateProfile = mutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    name: v.string(),
    phone: v.string(),
    address: v.string(),
    expected: v.object({
      name: v.union(v.string(), v.null()),
      phone: v.union(v.string(), v.null()),
      address: v.union(v.string(), v.null()),
    }),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await authorizeCustomerWrite(ctx, args.token, "accountAdmin.updateProfile");
    const account = await ctx.db.get(args.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw Error("Add a short reason for this profile edit.");
    const current = {
      name: account.name ?? null,
      phone: account.phone ?? null,
      address: account.address ?? null,
    };
    if (current.name !== args.expected.name || current.phone !== args.expected.phone || current.address !== args.expected.address)
      throw Error("Account details changed in another session. Review the current values and try again.");

    const name = args.name.trim().replace(/\s+/g, " ");
    const phone = args.phone.trim().replace(/\s+/g, " ");
    const address = args.address.trim().replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
    if (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw Error("Name must be 120 characters or fewer.");
    if (phone.length > 40 || (phone && !/^[+0-9(). -]+$/.test(phone))) throw Error("Enter a phone number using digits and standard phone punctuation.");
    if (address.length > 300 || /[\u0000-\u001f\u007f]/.test(address)) throw Error("Address must be 300 characters or fewer.");

    const next = {
      name: name || null,
      phone: phone || null,
      address: address || null,
    };
    const changed = (Object.keys(next) as Array<keyof typeof next>).filter((field) => current[field] !== next[field]);
    if (!changed.length) return { updated: false };
    await ctx.db.patch(account._id, {
      name: next.name ?? undefined,
      phone: next.phone ?? undefined,
      address: next.address ?? undefined,
    });
    // Keep the audit entry free of contact values; the current account row is
    // authoritative and the audit records which fields were changed.
    await ctx.db.insert("account_admin_changes", {
      accountId: account._id,
      at: Date.now(),
      kind: "profile_update",
      before: changed.join(", "),
      after: "updated",
      reason,
    });
    return { updated: true };
  },
});
export const setBlocked = mutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    blocked: v.boolean(),
    reason: v.string(),
    expected: v.object({ blockedAt: v.union(v.number(), v.null()), noticeId: v.union(v.id("account_restriction_notices"), v.null()), reason: v.string(), revision: v.number() }),
  },
  handler: async (ctx, a) => {
    await authorizeCustomerWrite(ctx, a.token, "accountAdmin.setBlocked");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = a.reason.trim();
    if (!reason || reason.length > 500)
      throw Error("Add a reason of up to 500 characters.");
    if ((account.blockedAt ?? null) !== a.expected.blockedAt || (account.restrictionNoticeId ?? null) !== a.expected.noticeId || (account.blockedReason ?? "") !== a.expected.reason || (account.restrictionRevision ?? 0) !== a.expected.revision)
      throw Error("Account restriction changed in another session. Review the current status and try again.");
    if ((account.blockedAt != null) === a.blocked) return;
    const lastRestrictedAt = Math.max(account.lastRestrictedAt ?? 0, account.blockedAt ?? 0);
    if (!Number.isSafeInteger(lastRestrictedAt) || lastRestrictedAt < 0 || lastRestrictedAt >= Number.MAX_SAFE_INTEGER) throw Error("Restriction history needs review.");
    const blockedAt = a.blocked ? Math.max(Date.now(), lastRestrictedAt + 1) : undefined;
    const noticeId = blockedAt == null ? undefined : await ctx.db.insert("account_restriction_notices", {
      accountId: account._id, blockedAt, recipient: account.email, reason,
      state: "pending", dueAt: blockedAt, createdAt: blockedAt, updatedAt: blockedAt,
    });
    await ctx.db.patch(account._id, {
      blockedAt,
      lastRestrictedAt: blockedAt ?? (lastRestrictedAt || undefined),
      restrictionRevision: (account.restrictionRevision ?? 0) + 1,
      restrictionNoticeId: noticeId,
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
    if (noticeId != null) {
      await ctx.scheduler.runAfter(0, internal.accountRestrictionNotice.dispatchOne, { noticeId });
      await queueRestrictedAccountRecheck(ctx,account._id,blockedAt!);
    }
  },
});
export const history = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, a) =>
    await customerReadAuthorized(ctx, a.token)
      ? ctx.db
          .query("account_admin_changes")
          .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
          .order("desc")
          .take(10)
      : [],
});

export const verificationReviews = query({
  args:{token:v.string(),accountId:v.id("accounts")},
  handler:async(ctx,args)=>{
    if(!await customerReadAuthorized(ctx,args.token))throw Error("unauthorized");
    const account=await ctx.db.get(args.accountId);if(!account)return {items:[],more:false};
    const statuses=["pending_verification","confirmed","active"] as const;
    const groups=await Promise.all(statuses.flatMap(status=>[
      ctx.db.query("bookings").withIndex("by_account_verification_review",q=>q.eq("accountId",account._id).eq("idVerifyStatus","manual_review").eq("verificationProvider","didit").eq("status",status)).order("desc").take(21),
      ctx.db.query("bookings").withIndex("by_guest_verification_review",q=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("accountId",undefined).eq("idVerifyStatus","manual_review").eq("verificationProvider","didit").eq("status",status)).order("desc").take(21),
    ]));
    const rows=groups.flat().sort((left,right)=>right._creationTime-left._creationTime);
    return {items:rows.slice(0,20).map(booking=>({id:booking._id,title:booking.lineItems?.[0]?.title??"Rental request",start:booking.lineItems?.length?Math.min(...booking.lineItems.map(line=>line.start)):null})),more:rows.length>20};
  },
});

/** Admin-only projection; never return provider IDs, credentials or document URLs. */
export const detail = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    if (!await customerReadAuthorized(ctx, args.token)) throw Error("unauthorized");
    const account = await ctx.db.get(args.accountId);
    if (!account) return null;
    const [bookings, credits, threads, notes, restrictionNotice] = await Promise.all([
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
      account.restrictionNoticeId ? ctx.db.get(account.restrictionNoticeId) : null,
    ]);
    const rentalRows = await Promise.all(
      bookings.slice(0, 100).map(async (booking) => {
        const first = booking.lineItems?.[0];
        const grouped = new Map<string, { listingId: typeof first.listingId; title: string; qty: number }>();
        for (const line of booking.lineItems ?? []) {
          const key = String(line.listingId ?? line.title);
          const previous = grouped.get(key);
          if (previous) previous.qty += line.qty;
          else grouped.set(key, { listingId: line.listingId, title: line.title, qty: line.qty });
        }
        const items = await Promise.all([...grouped.values()].map(async item => {
          const imageSources = listingRentalImages(item.listingId ? await ctx.db.get(item.listingId) : null);
          return {
            ...item,
            heroImage: imageSources[0] ?? null,
            imageSources,
          };
        }));
        return {
          id: booking._id,
          status: booking.status,
          idVerifyStatus: booking.idVerifyStatus ?? null,
          verificationProvider: booking.verificationProvider ?? null,
          total: booking.total,
          title: first?.title ?? "Rental request",
          start: first
            ? Math.min(...booking.lineItems.map((l: any) => l.start))
            : null,
          end: first
            ? Math.max(...booking.lineItems.map((l: any) => l.end))
            : null,
          imageSources: items[0]?.imageSources ?? [],
          items,
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
      name: account.name ?? null,
      phone: account.phone ?? null,
      address: account.address ?? null,
      hasBillingCustomer: !!account.stripeCustomerId,
      createdAt: account.createdAt,
      membershipStatus: account.membershipStatus ?? null,
      membershipActive: membershipActiveNow(account),
      paidThrough: account.membershipPaidThrough ?? null,
      trialEnd: account.membershipTrialEnd ?? null,
      cancelAtPeriodEnd: !!account.membershipCancelAtPeriodEnd,
      restrictionNotice: restrictionNotice && restrictionNotice.accountId === account._id && restrictionNotice.blockedAt === account.blockedAt ? { state: restrictionNotice.state, sentAt: restrictionNotice.sentAt ?? null } : null,
      verificationExpiresAt: account.rentalVerification ? verificationValidUntil(account.rentalVerification) : null,
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
    await authorizeCustomerWrite(ctx, args.token, "accountAdmin.addNote");
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
