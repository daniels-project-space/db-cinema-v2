import { assertVerificationArchive } from "./verificationArchive";
import { renterVerificationNote } from "../shared/verificationProgress";
import { ensureReferralCode } from "./lib/referrals";
import { rentalsForAccount } from "./lib/rentalAccount";
import { requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { creditKind } from "./lib/checkoutCredit";
import { loyaltyProgress, celebratedLoyaltyLevel, ENCORE_POLICY_VERSION } from "./lib/loyalty";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { usableCredit } from "./lib/creditLedger";
import { verificationDetail, verificationUpdateMessage } from "./lib/verificationReuse";
import {
  action,
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listingImages } from "./lib/catalogImages";
import { stream, mergedStream } from "convex-helpers/server/stream";
import schema from "./schema";

// ── crypto helpers (Web Crypto, available in Convex actions) ──────
const toHex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const fromHex = (h: string) =>
  new Uint8Array((h.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
function randomHex(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
}
async function pbkdf2(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// ── internal db helpers ──────────────────────────────────────────
export const _byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first(),
});

/** Resolve the AUTHENTICATED account from a session token (for checkout member perks —
 * so a member discount can't be claimed by merely typing a member's email). */
export const _byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!s || (s.expiresAt != null && s.expiresAt <= Date.now())) return null;
    const account=await ctx.db.get(s.accountId);
    if (!account || (account.emailVerificationRequired && !account.emailVerifiedAt)) return null;
    const loyalty=await loyaltyProgress(ctx,account);
    return {...account,loyaltyEligible:loyalty.eligible,loyaltyLevel:loyalty.level,loyaltyPercent:loyalty.percent};
  },
});

export const _create = internalMutation({
  args: {
    email: v.string(),
    salt: v.string(),
    hash: v.string(),
    name: v.optional(v.string()),
    token: v.string(),
    pendingEmailVerification: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    if(await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",a.email)).first())throw Error("An account with that email already exists.");
    const accountId = await ctx.db.insert("accounts", {
      email: a.email,
      salt: a.salt,
      hash: a.hash,
      emailVerificationRequired: !!a.pendingEmailVerification,
      name: a.name,
      createdAt: Date.now(),
    });
    await ensureReferralCode(ctx,accountId);
    await _applyPendingCollectiveGrant(ctx, accountId, a.email);
    const now = Date.now();
    if(!a.pendingEmailVerification)await ctx.db.insert("sessions", { token: a.token, accountId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return accountId;
  },
});

/** If a Creative Collective admin already approved this email for a complimentary
 *  membership before an account existed (`collective_applications.grantActive === true`),
 *  apply it to the freshly created account. Shared by both signup paths — password
 *  (`_create` above) and Google (`_upsertGoogle`'s insert-new-row branch in googleAuth.ts;
 *  the "link Google onto an existing account" branch never calls this — that account
 *  already got its grant applied once, either here or by an admin grant/revoke). */
export async function _applyPendingCollectiveGrant(ctx: any, accountId: any, email: string) {
  const apps = await ctx.db
    .query("collective_applications")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .collect();
  const grant = apps.find((a: any) => a.grantActive === true && a.grantedTier);
  if (!grant) return;
  await ctx.db.patch(accountId, {
    membershipTier: grant.grantedTier,
    membershipActive: true,
    membershipSource: "collective-comp",
  });
}

export const _session = internalMutation({
  args: { accountId: v.id("accounts"), token: v.string() },
  handler: async (ctx, { accountId, token }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.blockedAt != null) throw Error("This account is blocked. Contact DB Cinema Rentals.");
    const now = Date.now();
    await ctx.db.insert("sessions", { token, accountId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  },
});

/** Sweep expired sessions (Convex queries can't read the clock, so expiry is enforced by
 * deleting expired rows here — once gone, resolve() naturally returns null). Hourly cron.
 * Grandfathers legacy sessions that predate expiry tracking (expiresAt == null). */
export const sweepExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .collect();
    let n = 0;
    for (const s of rows) {
      if (s.expiresAt != null && s.expiresAt < now) { await ctx.db.delete(s._id); n++; }
    }
    return { swept: n };
  },
});

// ── public actions ───────────────────────────────────────────────
export const signUp = action({
  args: { email: v.string(), password: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { email, password, name }): Promise<{ token: string }> => {
    const e = email.trim().toLowerCase();
    if (e.length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) || password.length < 6)
      throw new Error("Enter a valid email and a password of 6+ characters.");
    const existing = await ctx.runQuery(internal.accounts._byEmail, { email: e });
    if (existing) throw new Error("An account with that email already exists.");
    const salt = randomHex(16);
    const hash = await pbkdf2(password, salt);
    const token = randomHex(24);
    await ctx.runMutation(internal.accounts._create, { email: e, salt, hash, name, token, pendingEmailVerification: true });
    await ctx.scheduler.runAfter(0,internal.accountAccess.sendForSignup,{email:e,credentialHash:hash});
    return { token: "" };
  },
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ token: string }> => {
    const e = email.trim().toLowerCase();
    const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email: e });
    if (!acct) throw new Error("No account found for that email.");
    if (acct.blockedAt != null) throw Error("This account is blocked. Contact DB Cinema Rentals.");
    if(acct.emailVerificationRequired&&!acct.emailVerifiedAt)throw Error("Confirm your signup email or request a private sign-in link first.");
    if (!acct.hash || !acct.salt)
      throw new Error("Use an email sign-in link or Continue with Google for this account.");
    const hash = await pbkdf2(password, acct.salt);
    if (hash !== acct.hash) throw new Error("Incorrect password.");
    const token = randomHex(24);
    await ctx.runMutation(internal.accounts._session, { accountId: acct._id, token });
    return { token };
  },
});

// ── token-scoped queries / mutations ─────────────────────────────
async function resolve(ctx: any, token: string) {
  const s = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!s || (s.expiresAt != null && s.expiresAt <= Date.now())) return null;
  const account=await ctx.db.get(s.accountId);return account?.blockedAt!=null||account?.emailVerificationRequired&&!account.emailVerifiedAt?null:account;
}

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) return null;
    const loyalty = await loyaltyProgress(ctx,a);
    const now = Date.now();
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_account", (q) => q.eq("accountId", a._id))
      .collect();
    const storeCredit = credits
      .filter((c) => c.status === "active" && c.expiresAt > now)
      .reduce((n, c) => n + usableCredit(c), 0);
    return {
      referralCode:a.referralCode??null,
      refundCredit:credits.filter(c=>c.status==="active"&&c.expiresAt>now&&creditKind(c)==="refund").reduce((n,c)=>n+usableCredit(c),0),
      earnedCredit:credits.filter(c=>c.status==="active"&&c.expiresAt>now&&creditKind(c)==="earned").reduce((n,c)=>n+usableCredit(c),0),
      loyaltyLevel:loyalty.level,loyaltyPercent:loyalty.percent,loyaltyCelebratedLevel:celebratedLoyaltyLevel(a),
      loyaltyEligible: loyalty.eligible,
      loyaltyCompleted: loyalty.completed,
      loyaltyCelebrated: (celebratedLoyaltyLevel(a))>=loyalty.level,
      membershipPerksPending: !!a.membershipPerksPendingBookingId,
      _id: a._id,
      email: a.email,
      name: a.name ?? null,
      phone: a.phone ?? null,
      address: a.address ?? null,
      marketingEmails: a.marketingEmails ?? false,
      favorites: (a.favorites ?? []) as string[],
      avatarUrl: a.avatarStorageId ? await ctx.storage.getUrl(a.avatarStorageId) : (a.googleAvatarUrl ?? null),
      idVerified: a.rentalVerification ? a.rentalVerification.expiresAt > now : (a.idVerified ?? false),
      verificationValidUntil: a.rentalVerification?.expiresAt ?? null,
      hasPassword: !!a.hash,
      membershipTier: membershipTierFor(a) ?? null,
      membershipAdminGranted: !!a.adminMembershipTier && a.adminMembershipTier !== "standard",
      membershipBillingTier: a.stripeSubscriptionId ? a.membershipTier ?? null : null,
      membershipActive: membershipActiveNow(a),
      membershipStatus: a.membershipStatus ?? null,
      membershipPaidThrough: a.membershipPaidThrough ?? null,
      membershipTrialEnd: a.membershipTrialEnd ?? null,
      membershipCancelAtPeriodEnd: a.membershipCancelAtPeriodEnd ?? false,
      membershipIntroUsed: a.membershipIntroUsed ?? false,
      freeAccessoryMonth: a.freeAccessoryMonth ?? null,
      freeAccessoryUsed: a.freeAccessoryUsed ?? 0,
      storeCredit,
      customerActionsEnabled: process.env.CUSTOMER_BOOKING_ACTIONS === "true",
    };
  },
});

export const _useFreeAccessories = internalMutation({
  args: { email: v.string(), month: v.string(), count: v.number() },
  handler: async (ctx, { email, month, count }) => {
    const a: any = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!a) return;
    const used = a.freeAccessoryMonth === month ? a.freeAccessoryUsed ?? 0 : 0;
    await ctx.db.patch(a._id, { freeAccessoryMonth: month, freeAccessoryUsed: used + count });
  },
});

export const _setMembership = internalMutation({
  args: { email: v.string(), tier: v.string(), subscriptionId: v.optional(v.string()) },
  handler: async (ctx, { email, tier, subscriptionId }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (a)
      await ctx.db.patch(a._id, {
        membershipTier: tier,
        membershipActive: true,
        stripeSubscriptionId: subscriptionId,
      });
  },
});

/** Admin-granted complimentary membership for an approved Creative Collective member
 *  (professionals → "pro", gear-providers → "plus"). Marked `membershipSource:
 *  "collective-comp"` so it's never confused with — or clobbered by — a real Stripe
 *  subscription. No-op if the account doesn't exist yet (the applicant hasn't signed up);
 *  `collective_applications.grantActive` is the source of truth until then, applied by
 *  `_applyPendingCollectiveGrant` at signup time. */
export const _grantComplimentaryMembership = internalMutation({
  args: { email: v.string(), tier: v.string() },
  handler: async (ctx, { email, tier }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!a) return;
    await ctx.db.patch(a._id, { membershipTier: tier, membershipActive: true, membershipSource: "collective-comp" });
  },
});

/** Revoke a complimentary Creative Collective membership. Only ever touches an account
 *  whose current membership came from `_grantComplimentaryMembership` — never a real paid
 *  subscription (guarded by `membershipSource`). */
export const _revokeComplimentaryMembership = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!a || a.membershipSource !== "collective-comp") return;
    await ctx.db.patch(a._id, { membershipTier: undefined, membershipActive: false });
  },
});

/** Mark an account ID-verified once any of its bookings clears Stripe Identity. */
export const _markVerifiedByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (a) await ctx.db.patch(a._id, { idVerified: true });
  },
});

/** Stash an account-level Stripe Identity session id (crew/member verification). */
export const _setIdSession = internalMutation({
  args: { accountId: v.id("accounts"), sessionId: v.string() },
  handler: async (ctx, { accountId, sessionId }) => {
    await ctx.db.patch(accountId, { idSessionId: sessionId });
  },
});

/** Mark an account ID-verified (called by identity.refreshAccount once Stripe clears it). */
export const _markIdVerified = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { idVerified: true });
  },
});

export const toggleFavorite = mutation({
  args: { token: v.string(), listingId: v.string() },
  handler: async (ctx, { token, listingId }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    const cur: string[] = a.favorites ?? [];
    const next = cur.includes(listingId)
      ? cur.filter((x) => x !== listingId)
      : [...cur, listingId];
    await ctx.db.patch(a._id, { favorites: next });
    return { favorites: next };
  },
});

export const updateProfile = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    marketingEmails: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, ...patch }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    const changed = (patch.name != null && verificationDetail(patch.name) !== verificationDetail(a.name)) ||
      (patch.address != null && verificationDetail(patch.address) !== verificationDetail(a.address));
    await ctx.db.patch(a._id, { ...patch, ...(changed ? { rentalVerification: undefined, idVerified: false } : {}) });
    if (changed) {
      const bookings = await ctx.db.query("bookings").withIndex("by_guestEmail", q => q.eq("guestEmail", a.email)).collect();
      for (const b of bookings) if (b.status === "confirmed" && b.verificationReusedFrom) { await ctx.db.patch(b._id, {
        idVerifyStatus: "requires_input", verificationReusedFrom: undefined, verificationExpiresAt: undefined,
        verificationNote: "Your account details changed. Complete a new identity and address check before handover.",
      }); await verificationUpdateMessage(ctx, b._id, b.idVerifyStatus, "requires_input"); }
    }
    return { ok: true };
  },
});

/** Profile photo upload — returns a short-lived Convex storage upload URL (token-gated). */
export const generateAvatarUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Set (or clear, when avatarStorageId is omitted) the account profile photo. Kept separate
 * from updateProfile so a normal profile save can never accidentally wipe the avatar. */
export const setAvatar = mutation({
  args: { token: v.string(), avatarStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { token, avatarStorageId }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    // delete the previous blob to avoid orphaned storage
    if (a.avatarStorageId && a.avatarStorageId !== avatarStorageId) {
      try { await ctx.storage.delete(a.avatarStorageId); } catch {}
    }
    await ctx.db.patch(a._id, { avatarStorageId: avatarStorageId ?? undefined });
    return { ok: true };
  },
});

export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (s) {
      const devices=await ctx.db.query("renter_push_subscriptions").withIndex("by_session",q=>q.eq("sessionId",s._id)).collect();
      for(const device of devices)await ctx.db.patch(device._id,{enabled:false,updatedAt:Math.max(Date.now(),device.updatedAt+1)});
      await ctx.db.delete(s._id);
    }
  },
});

/** Kept for old clients: cancellation must consult Stripe and preserve the conversation. */
export const deletePending = mutation({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async () => { throw new Error("Refresh this page to cancel checkout safely. Rental conversations are retained."); },
});

export const myBookings = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) return null;
    const rows = await rentalsForAccount(ctx,a,50);
    return enrichBookings(ctx,rows);
  },
});

async function enrichBookings(ctx:any,rows:any[]) {
    const allReviews = await ctx.db.query("reviews").collect();
    const reviewed = new Set(allReviews.map((r:any) => r.verifiedBookingId).filter(Boolean));

    // resolve a display image url for a listing (R2 → source → gallery), cached across bookings
    const listingCache = new Map<string, any>();
    const getListing = async (id: any) => {
      const k = String(id);
      if (!listingCache.has(k)) listingCache.set(k, await ctx.db.get(id));
      return listingCache.get(k);
    };
    const heroOf = (l: any): string | null => {
      if (!l) return null;
      const imgs = listingImages(l);
      return imgs?.[0] ?? null;
    };

    const archiveCache = new Map<string, boolean>();
    const out = [];
    for (const b of rows) {
      let verificationArchiveReady = false;
      if (b.idVerifyStatus === "verified") {
        const sourceId = String(b.verificationReusedFrom ?? b._id);
        if (!archiveCache.has(sourceId)) {
          try { await assertVerificationArchive(ctx, b); archiveCache.set(sourceId, true); }
          catch { archiveCache.set(sourceId, false); }
        }
        verificationArchiveReady = archiveCache.get(sourceId) === true;
      }
      const lines = [];
      for (const li of b.lineItems) {
        const l = await getListing(li.listingId);
        lines.push({
          listingId: li.listingId,
          title: li.title,
          start: li.start,
          end: li.end,
          qty: li.qty,
          lineTotal: li.lineTotal,
          pickupTime: li.pickupTime === undefined ? b.pickupTime ?? null : li.pickupTime,
          returnTime: li.returnTime ?? null,
          slug: (l as any)?.slug ?? null,
          heroImage: heroOf(l),
          imageSources: listingImages(l),
          category: (l as any)?.category ?? null,
          tip: (l as any)?.knowledge?.summary ?? null,
        });
      }
      const starts = b.lineItems.map((li: any) => li.start);
      const ends = b.lineItems.map((li: any) => li.end);
      out.push({
        _id: b._id,
        status: b.status,
        lineItems: lines,
        total: b.total,
        subtotal: b.subtotal,
        discount: b.discount,
        deliveryFee: b.deliveryFee ?? 0,
        creditApplied: b.creditApplied ?? 0,
        depositAmount: b.depositAmount,
        depositHoldAmount: b.depositHoldAmount ?? 0,
        depositHoldStatus: b.depositHoldStatus ?? null,
        securityHoldPolicyVersion:b.securityHoldPolicyVersion??null,securityHoldDueAt:b.securityHoldDueAt??null,
        depositHoldExpiresAt: b.depositHoldExpiresAt ?? null,
        depositHoldRenewalStatus: b.depositHoldRenewalStatus ?? null,
        depositHoldReleasePending: (b.depositHoldPreviousIntentIds?.length ?? 0) > 0,
        depositRefunded: b.depositRefunded ?? false,
        hasReturnStatement: !!b.returnStatement,
        returnStatementIssuedAt:b.returnStatement?.issuedAt,
        hasPayment: !!b.stripePaymentIntentId || ["confirmed", "active", "returned"].includes(b.status),
        lateFeeAmount: b.lateFeeAmount ?? 0,
        lateFeeStatus: b.lateFeeStatus ?? null,
        currency: b.currency ?? "GBP",
        fulfilment: b.fulfilment,
        address: b.address ?? null,
        pickupTime: b.pickupTime ?? null,
        returnTime: b.returnTime ?? null,
        idVerifyStatus: b.idVerifyStatus ?? "required",
        verificationNote: renterVerificationNote(b.verificationNote),
        verificationArchiveReady,
        verificationExpiresAt: b.verificationExpiresAt ?? null,
        documentExpiresAt: b.documentExpiresAt ?? null,
        verificationChecks: b.verificationChecks ?? null,
        idVerificationSource: b.idVerificationSource ?? null,
        cancellationPending: !!b.cancellationDecision && b.status !== "cancelled",
        returnPending: !!b.returnDecision && b.status !== "returned",
        requiresDroneLicence: await requiresDroneLicence(ctx, b),
        droneLicenceStatus: await droneLicenceStatusForRental(ctx, b),
        reviewed: reviewed.has(b._id),
        firstSlug: lines[0]?.slug ?? null,
        start: starts.length ? Math.min(...starts) : null,
        end: ends.length ? Math.max(...ends) : null,
        at: b._creationTime,
      });
    }
    return out;
}
export const myBookingsPage=query({args:{token:v.string(),paginationOpts:paginationOptsValidator},handler:async(ctx,{token,paginationOpts})=>{
 if (!Number.isInteger(paginationOpts.numItems) || paginationOpts.numItems < 1) throw Error("Invalid rental page size");
 const a:any=await resolve(ctx,token);if(!a)return {page:[],isDone:true,continueCursor:""};
 const linked = stream(ctx.db, schema).query("bookings").withIndex("by_account", q => q.eq("accountId", a._id)).order("desc");
 const legacy = stream(ctx.db, schema).query("bookings").withIndex("by_account_guestEmail", q => q.eq("accountId", undefined).eq("guestEmail", a.email)).order("desc");
 const page = await mergedStream([linked, legacy], ["_creationTime"]).paginate({...paginationOpts, numItems:Math.min(50,paginationOpts.numItems), maximumRowsRead:100});
 return {...page,page:await enrichBookings(ctx,page.page)};
}});

// ── account management: change password / delete ─────────────────
export const _authFor = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!s||(s.expiresAt!=null&&s.expiresAt<=Date.now())) return null;
    const a: any = await ctx.db.get(s.accountId);
    if (!a||a.blockedAt!=null||a.emailVerificationRequired&&!a.emailVerifiedAt) return null;
    return { accountId: a._id, salt: a.salt, hash: a.hash, emailVerified:!!a.emailVerifiedAt||!!a.googleId };
  },
});

export const _setPassword = internalMutation({
  args: { accountId: v.id("accounts"), salt: v.string(), hash: v.string() },
  handler: async (ctx, { accountId, salt, hash }) => {
    await ctx.db.patch(accountId, { salt, hash });
  },
});

export const changePassword = action({
  args: { token: v.string(), oldPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, oldPassword, newPassword }) => {
    if (newPassword.length < 6) throw new Error("New password must be 6+ characters.");
    const a: any = await ctx.runQuery(internal.accounts._authFor, { token });
    if (!a) throw new Error("unauthorized");
    if(a.hash&&a.salt){const oldHash = await pbkdf2(oldPassword,a.salt);if(oldHash!==a.hash)throw new Error("Current password is incorrect.");}
    else if(!a.emailVerified)throw Error("Verify your email before setting a password.");
    const salt = randomHex(16);
    const hash = await pbkdf2(newPassword, salt);
    await ctx.runMutation(internal.accounts._setPassword, { accountId: a.accountId, salt, hash });
    return { ok: true };
  },
});

export const deleteAccount = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    const sessions = await ctx.db.query("sessions").collect();
    for (const s of sessions) if (s.accountId === a._id) await ctx.db.delete(s._id);
    await ctx.db.delete(a._id);
    return { ok: true };
  },
});

/** Every account with a Stripe subscription — drives the membership reconcile cron. */
export const _listSubscribers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("accounts").collect();
    return rows
      .filter((a) => !!a.stripeSubscriptionId)
      .map((a) => ({
        accountId: a._id,
        email: a.email,
        subscriptionId: a.stripeSubscriptionId as string,
        membershipActive: membershipActiveNow(a),
        membershipTier: a.membershipTier ?? null,
      }));
  },
});

/** Reconcile one account's membership to the REAL Stripe subscription state (cron). */
export const _applyMembershipReconcile = internalMutation({
  args: { accountId: v.id("accounts"), active: v.boolean(), tier: v.optional(v.string()) },
  handler: async (ctx, { accountId, active, tier }) => {
    const patch: Record<string, unknown> = { membershipActive: active };
    if (tier) patch.membershipTier = tier;
    await ctx.db.patch(accountId, patch);
  },
});

/** Set membership active/tier for the account tied to a Stripe subscription id (webhook
 *  customer.subscription.updated/deleted). No-op if no account carries that subscription yet. */
export const _setMembershipBySubscription = internalMutation({
  args: { subscriptionId: v.string(), active: v.boolean(), tier: v.optional(v.string()) },
  handler: async (ctx, { subscriptionId, active, tier }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_subscription", (q) => q.eq("stripeSubscriptionId", subscriptionId))
      .first();
    if (!a) return;
    const patch: Record<string, unknown> = { membershipActive: active };
    if (tier) patch.membershipTier = tier;
    await ctx.db.patch(a._id, patch);
  },
});

export const _setStripeCustomer = internalMutation({
  args: { email: v.string(), customerId: v.string() },
  handler: async (ctx, { email, customerId }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (a) await ctx.db.patch(a._id, { stripeCustomerId: customerId });
  },
});

/** Checkout recovery binds by permanent account ID, without overwriting a
 * newer concurrent customer or relinking an existing subscription. */
export const _bindCheckoutCustomer = internalMutation({
  args: {accountId:v.id("accounts"),customerId:v.string(),expectedCustomerId:v.optional(v.string())},
  handler: async(ctx,{accountId,customerId,expectedCustomerId})=>{
    const account=await ctx.db.get(accountId);
    if(!account||account.blockedAt!=null)throw new ConvexError({code:"BILLING_ACCOUNT_UNAVAILABLE",message:"Please sign in again before paying."});
    if(account.stripeCustomerId===customerId)return;
    if(account.stripeCustomerId!==expectedCustomerId||account.stripeSubscriptionId)
      throw new ConvexError({code:"BILLING_ACCOUNT_CHANGED",message:"Your billing account changed. Please retry checkout."});
    await ctx.db.patch(accountId,{stripeCustomerId:customerId});
  },
});

/** Acknowledgement is authenticated and persisted across devices. */
export const acknowledgeLoyalty = mutation({
  args:{token:v.string(),level:v.optional(v.number())},
  handler:async(ctx,{token,level})=>{
    const account=await resolve(ctx,token);
    if(!account)throw Error("Sign in to your account.");
    const progress=await loyaltyProgress(ctx,account),earned=level??progress.level;
    if(!Number.isInteger(earned)||earned<1||earned>progress.level)throw Error("Complete a clean rental and its review before claiming this Encore level.");
    const celebrated=celebratedLoyaltyLevel(account);
    if(earned>celebrated)await ctx.db.patch(account._id,{loyaltyPolicyVersion:ENCORE_POLICY_VERSION,loyaltyLevel:progress.level,loyaltyCelebratedLevel:earned,...(earned===3?{loyaltyUnlockedAt:account.loyaltyUnlockedAt??Date.now(),loyaltyCelebratedAt:Date.now()}:{})});
    return true;
  },
});
