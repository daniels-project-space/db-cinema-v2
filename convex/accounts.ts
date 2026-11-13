import { assertVerificationArchive } from "./verificationArchive";
import { retainVerificationArchiveLink } from "./lib/verificationArchiveLink";
import { renterVerificationNote, verificationValidUntil } from "../shared/verificationProgress";
import { renterRentalActionReady } from "./lib/renterRentalActionGate";
import { ensureReferralCode } from "./lib/referrals";
import { belongsToRentalAccount, rentalsForAccount } from "./lib/rentalAccount";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { creditKind } from "./lib/checkoutCredit";
import { loyaltyProgress, celebratedLoyaltyLevel, ENCORE_POLICY_VERSION } from "./lib/loyalty";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { usableCredit } from "./lib/creditLedger";
import { verificationDetail, verificationUpdateMessage } from "./lib/verificationReuse";
import { accountVerificationReady } from "./lib/accountVerificationReady";
import { deletePrivateFile } from "./lib/privateStorage";
import { droneDocumentType } from "./lib/droneDocument";
import {
  action,
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listingRentalImages } from "./lib/catalogImages";
import { stream, mergedStream } from "convex-helpers/server/stream";
import schema from "./schema";
import { accountAuthError, validAccountEmail } from "../shared/accountAuth";
import { LEO_SUPPORT_PHONE, TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS } from "../shared/pickupLocation";
import { CURRENT_PRIVACY_NOTICE_VERSION, legalVersionForPolicy } from "../shared/legalVersioning";

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
const PASSWORD_SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_SIGNIN_ATTEMPT_LIMIT = 8;
// Use the same PBKDF2 cost when the email has no usable password, so the
// public sign-in action returns the same credential error for every state.
const DUMMY_PASSWORD_SALT_HEX = "00112233445566778899aabbccddeeff";

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
    const account=await resolve(ctx,token);
    if (!account) return null;
    const loyalty=await loyaltyProgress(ctx,account);
    return {...account,loyaltyEligible:loyalty.eligible,loyaltyLevel:loyalty.level,loyaltyPercent:loyalty.percent,loyaltyCompleted:loyalty.completed};
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
    accountTermsVersion: v.string(),
    accountTermsAcceptedAt: v.number(),
    privacyNoticeVersion: v.string(),
    privacyNoticeAcknowledgedAt: v.number(),
  },
  handler: async (ctx, a) => {
    if(await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",a.email)).first())throw new ConvexError(accountAuthError("ACCOUNT_EXISTS"));
    const accountId = await ctx.db.insert("accounts", {
      email: a.email,
      salt: a.salt,
      hash: a.hash,
      emailVerificationRequired: !!a.pendingEmailVerification,
      name: a.name,
      accountTermsVersion: a.accountTermsVersion,
      accountTermsAcceptedAt: a.accountTermsAcceptedAt,
      privacyNoticeVersion: a.privacyNoticeVersion,
      privacyNoticeAcknowledgedAt: a.privacyNoticeAcknowledgedAt,
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
  args: { accountId: v.id("accounts"), token: v.string(), expectedPasswordHash: v.optional(v.string()) },
  handler: async (ctx, { accountId, token, expectedPasswordHash }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.blockedAt != null || account.emailVerificationRequired && !account.emailVerifiedAt ||
        expectedPasswordHash !== undefined && account.hash !== expectedPasswordHash)
      throw new ConvexError(expectedPasswordHash !== undefined
        ? accountAuthError("INVALID_CREDENTIALS")
        : accountAuthError(account?.blockedAt != null ? "ACCOUNT_BLOCKED" : "EMAIL_VERIFICATION_REQUIRED"));
    const now = Date.now();
    await ctx.db.patch(accountId, { passwordSignInWindowStartedAt: undefined, passwordSignInAttemptCount: undefined });
    await ctx.db.insert("sessions", { token, accountId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  },
});

/** Reserve one of eight password checks per account in a 15-minute fixed
 * window. The counter lives on the account row, so arbitrary emails cannot
 * create an unbounded number of limiter rows. The window expires lazily on the
 * next attempt; success and password changes clear it. Convex actions do not
 * expose the source IP, so this is keyed by the normalized account email. */
export const _reservePasswordSignInAttempt = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (!validAccountEmail(email) || email !== email.trim().toLowerCase()) return null;
    const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", email)).first();
    if (!account || account.blockedAt != null || account.emailVerificationRequired && !account.emailVerifiedAt ||
        !account.hash || !account.salt) return null;

    const now = Date.now();
    let windowStartedAt = account.passwordSignInWindowStartedAt;
    let attempts = account.passwordSignInAttemptCount ?? 0;
    if (!Number.isSafeInteger(windowStartedAt) || windowStartedAt! > now || now - windowStartedAt! >= PASSWORD_SIGNIN_WINDOW_MS ||
        !Number.isSafeInteger(attempts) || attempts < 0) {
      windowStartedAt = now;
      attempts = 0;
    }
    if (attempts >= PASSWORD_SIGNIN_ATTEMPT_LIMIT) return { throttled: true as const };

    await ctx.db.patch(account._id, {
      passwordSignInWindowStartedAt: windowStartedAt,
      passwordSignInAttemptCount: attempts + 1,
    });
    return { accountId: account._id, salt: account.salt, hash: account.hash, throttled: false as const };
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

/** Remove the account-level Didit reuse grant once its 90-day window ends.
 * Rental-level verification state is deliberately untouched, so an already
 * confirmed or active booking keeps its original approval. The nested-field
 * index and page cap keep the cleanup bounded as the account table grows. */
export const purgeExpiredRentalVerification = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query("accounts")
      .withIndex("by_rental_verification_expiry", q => q.lte("rentalVerification.expiresAt", now))
      .order("asc")
      .paginate({ cursor: cursor ?? null, numItems: 50, maximumRowsRead: 50 });
    let cleared = 0;
    for (const candidate of page.page) {
      const account = await ctx.db.get(candidate._id);
      const record = account?.rentalVerification;
      const indexedRecord = candidate.rentalVerification;
      if (!account || !record || !indexedRecord ||
        !Number.isSafeInteger(record.expiresAt) || record.expiresAt > now ||
        record.sourceBookingId !== indexedRecord.sourceBookingId ||
        record.verifiedAt !== indexedRecord.verifiedAt ||
        record.expiresAt !== indexedRecord.expiresAt) continue;
      await ctx.db.patch(account._id, { rentalVerification: undefined, idVerified: false });
      cleared++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.accounts.purgeExpiredRentalVerification, { cursor: page.continueCursor });
    return { cleared, hasMore: !page.isDone };
  },
});

// ── public actions ───────────────────────────────────────────────
export const signUp = action({
  args: { email: v.string(), password: v.string(), name: v.optional(v.string()), next: v.optional(v.union(v.literal("chat"),v.literal("review"))), bookingId: v.optional(v.id("bookings")), termsAndPrivacyAcknowledged: v.boolean(), termsVersion: v.string(), privacyNoticeVersion: v.string() },
  handler: async (ctx, { email, password, name, next, bookingId, termsAndPrivacyAcknowledged, termsVersion, privacyNoticeVersion }): Promise<{ token: string }> => {
    const e = email.trim().toLowerCase();
    if (!validAccountEmail(e) || password.length < 8 || password.length > 256)
      throw new ConvexError(accountAuthError("SIGNUP_INVALID_INPUT"));
    if (!termsAndPrivacyAcknowledged)
      throw new ConvexError(accountAuthError("SIGNUP_TERMS_REQUIRED"));
    const policy = await ctx.runQuery(api.settings.get, {});
    const currentTermsVersion = legalVersionForPolicy(policy);
    if (termsVersion !== currentTermsVersion || privacyNoticeVersion !== CURRENT_PRIVACY_NOTICE_VERSION)
      throw new ConvexError(accountAuthError("SIGNUP_TERMS_UPDATED"));
    const existing = await ctx.runQuery(internal.accounts._byEmail, { email: e });
    if (existing) throw new ConvexError(accountAuthError("ACCOUNT_EXISTS"));
    const salt = randomHex(16);
    const hash = await pbkdf2(password, salt);
    const token = randomHex(24);
    const acceptedAt = Date.now();
    await ctx.runMutation(internal.accounts._create, {
      email: e, salt, hash, name, token, pendingEmailVerification: true,
      accountTermsVersion: currentTermsVersion, accountTermsAcceptedAt: acceptedAt,
      privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION, privacyNoticeAcknowledgedAt: acceptedAt,
    });
    await ctx.scheduler.runAfter(0,internal.accountAccess.sendForSignup,{email:e,credentialHash:hash,next,bookingId});
    return { token: "" };
  },
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ token: string }> => {
    const e = email.trim().toLowerCase();
    if (!validAccountEmail(e) || !password || password.length > 256)
      throw new ConvexError(accountAuthError("INVALID_INPUT"));
    const attempt: any = await ctx.runMutation(internal.accounts._reservePasswordSignInAttempt, { email: e });
    if (!attempt || attempt.throttled) {
      await pbkdf2(password, DUMMY_PASSWORD_SALT_HEX);
      throw new ConvexError(accountAuthError("INVALID_CREDENTIALS"));
    }
    const hash = await pbkdf2(password, attempt.salt);
    if (hash !== attempt.hash) throw new ConvexError(accountAuthError("INVALID_CREDENTIALS"));
    const token = randomHex(24);
    await ctx.runMutation(internal.accounts._session, { accountId: attempt.accountId, token, expectedPasswordHash: attempt.hash });
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

export const _billingPortalTarget = internalQuery({args:{token:v.string()},handler:async(ctx,{token})=>{
  const account=await resolve(ctx,token);
  if(!account?.stripeCustomerId)return null;
  return {accountId:account._id,customerId:account.stripeCustomerId,subscriptionId:account.stripeSubscriptionId??null};
}});

export const checkoutVerification = query({
  args: { token:v.string(), name:v.string(), address:v.string(), starts:v.array(v.number()) },
  handler: async (ctx,{token,name,address,starts}) => {
    if(name.length>200||address.length>1000)return null;
    return accountVerificationReady(ctx,await resolve(ctx,token),name,address,starts);
  },
});

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) return null;
    const loyalty = await loyaltyProgress(ctx,a);
    const verification=await accountVerificationReady(ctx,a);
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
      avatarUrl: a.avatarStorageId && a.avatarStorageId === a.avatarOwnedStorageId ? await ctx.storage.getUrl(a.avatarStorageId) : (a.googleAvatarUrl ?? null),
      idVerified: !!verification,
      verificationValidUntil: verification?.expiresAt ?? null,
      verificationReadyUntil: verification?.proofExpiresAt ?? null,
      hasPassword: !!a.hash,
      membershipTier: membershipTierFor(a) ?? null,
      membershipAdminGranted: !!a.adminMembershipTier && a.adminMembershipTier !== "standard",
      membershipBillingTier: a.stripeSubscriptionId ? a.membershipTier ?? null : null,
      membershipHasBillingSubscription: !!a.stripeSubscriptionId,
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
    if (!a || a.membershipActive || a.stripeSubscriptionId) return;
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
      const [linked, linkedPending, legacy, legacyPending] = await Promise.all([
        ctx.db.query("bookings").withIndex("by_account_status", q => q.eq("accountId", a._id).eq("status", "confirmed")).take(101),
        ctx.db.query("bookings").withIndex("by_account_status", q => q.eq("accountId", a._id).eq("status", "pending_verification")).take(101),
        ctx.db.query("bookings").withIndex("by_guestEmail_status", q => q.eq("guestEmail", a.email).eq("status", "confirmed")).take(101),
        ctx.db.query("bookings").withIndex("by_guestEmail_status", q => q.eq("guestEmail", a.email).eq("status", "pending_verification")).take(101),
      ]);
      if ([linked, linkedPending, legacy, legacyPending].some(rows => rows.length > 100)) throw Error("Too many open rentals to update this profile automatically. Contact the team.");
      const bookings = [...new Map([...linked, ...linkedPending, ...legacy, ...legacyPending].filter(b => belongsToRentalAccount(b, a)).map(b => [b._id, b])).values()];
      for (const b of bookings) if (["confirmed", "pending_verification"].includes(b.status) && b.verificationReusedFrom) { await retainVerificationArchiveLink(ctx,b); await ctx.db.patch(b._id, {
        idVerifyStatus: "requires_input", verificationReusedFrom: undefined, verificationExpiresAt: undefined,
        verificationNote: "Your account details changed. Complete a new identity and address check before handover.",
      }); await verificationUpdateMessage(ctx, b._id, b.idVerifyStatus, "requires_input"); await queueRmv2Sync(ctx, b._id); }
    }
    return { ok: true };
  },
});

export const generateAvatarUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    throw new Error("Please refresh the page to upload a photo securely.");
  },
});

/** Set (or clear, when avatarStorageId is omitted) the account profile photo. Kept separate
 * from updateProfile so a normal profile save can never accidentally wipe the avatar. */
export const setAvatar = mutation({
  args: { token: v.string(), avatarStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { token, avatarStorageId }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    if (avatarStorageId) throw new Error("Please upload your photo again.");
    if (a.avatarStorageId && a.avatarStorageId === a.avatarOwnedStorageId) await ctx.storage.delete(a.avatarStorageId);
    await ctx.db.patch(a._id, { avatarStorageId: undefined, avatarOwnedStorageId: undefined, googleAvatarUrl: undefined, googleAvatarRemoved: true, avatarBoundDigest: undefined, avatarUploadRevision: (a.avatarUploadRevision ?? 0) + 1 });
    return { ok: true };
  },
});

export const reserveAvatarUpload = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await resolve(ctx, token);
    if (!account) throw new Error("unauthorized");
    const now = Date.now();
    const recent = (account.avatarUploadTimes ?? []).filter((time: number) => time > now - 60_000 && time <= now);
    if (recent.length >= 6) throw new Error("Please wait before uploading another photo.");
    const revision = (account.avatarUploadRevision ?? 0) + 1;
    await ctx.db.patch(account._id, { avatarUploadTimes: [...recent, now], avatarUploadRevision: revision });
    return { accountId: account._id, revision };
  },
});

export const commitAvatarUpload = internalMutation({
  args: { token: v.string(), accountId: v.id("accounts"), revision: v.number(), contentType: v.string(), digest: v.string(), chunks: v.array(v.bytes()) },
  handler: async (ctx, args) => {
    const account = await resolve(ctx, args.token);
    if (!account || account._id !== args.accountId || account.avatarUploadRevision !== args.revision) throw Error("Invalid upload.");
    if (!/^[a-f0-9]{64}$/.test(args.digest) || args.chunks.length < 1 || args.chunks.length > 10 || args.chunks.some(chunk => chunk.byteLength < 1 || chunk.byteLength > 512 * 1024)) throw Error("Invalid upload.");
    const size = args.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    if (size > 5 * 1024 * 1024) throw Error("Invalid upload.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of args.chunks) { bytes.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
    const type = droneDocumentType(bytes, args.contentType);
    if (!type.startsWith("image/")) throw Error("Invalid upload.");
    const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    if (digest !== args.digest) throw Error("Invalid upload.");
    if (account.avatarBoundRevision === args.revision) {
      if (account.avatarBoundDigest === digest && account.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId) return { ok: true };
      throw Error("Photo upload already completed.");
    }
    const storageId = await ctx.storage.store(new Blob([bytes], { type }));
    if (account.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId) await deletePrivateFile(ctx, account.avatarStorageId);
    await ctx.db.patch(account._id, { avatarStorageId: storageId, avatarOwnedStorageId: storageId, avatarBoundRevision: args.revision, avatarBoundDigest: digest });
    return { ok: true };
  },
});

export const recordAvatarUpload = internalMutation({
  args: { token: v.string(), accountId: v.id("accounts"), storageId: v.id("_storage"), revision: v.number(), uploadKey: v.string() },
  handler: async (ctx, args) => {
    const account = await resolve(ctx, args.token);
    if (!account || account._id !== args.accountId || account.avatarUploadRevision !== args.revision || !/^[a-f0-9-]{36}$/.test(args.uploadKey)) throw Error("Invalid upload.");
    const previous = await ctx.db.query("avatar_upload_ledger").withIndex("by_storage", q => q.eq("storageId", args.storageId)).unique();
    if (previous) {
      if (previous.accountId !== args.accountId || previous.revision !== args.revision || previous.uploadKey !== args.uploadKey) throw Error("Invalid upload.");
      return;
    }
    await ctx.db.insert("avatar_upload_ledger", { accountId: args.accountId, storageId: args.storageId, revision: args.revision, uploadKey: args.uploadKey, dueAt: Date.now() + 24 * 60 * 60_000 });
  },
});

export const bindAvatarUpload = internalMutation({
  args: { token: v.string(), accountId: v.id("accounts"), storageId: v.id("_storage"), revision: v.number(), uploadKey: v.string() },
  handler: async (ctx, { token, accountId, storageId, revision, uploadKey }) => {
    const account = await resolve(ctx, token);
    if (!account || account._id !== accountId || account.avatarUploadRevision !== revision) throw new Error("unauthorized");
    if (account.avatarBoundRevision === revision) {
      if (account.avatarStorageId === storageId && account.avatarOwnedStorageId === storageId) return { ok: true };
      throw new Error("Photo upload already completed.");
    }
    const upload = await ctx.db.query("avatar_upload_ledger").withIndex("by_storage", q => q.eq("storageId", storageId)).unique();
    if (!upload || upload.accountId !== accountId || upload.revision !== revision || upload.uploadKey !== uploadKey) throw Error("Invalid upload.");
    if (account.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId)
      await ctx.storage.delete(account.avatarStorageId);
    await ctx.db.patch(accountId, { avatarStorageId: storageId, avatarOwnedStorageId: storageId, avatarBoundRevision: revision, avatarBoundDigest: undefined });
    await ctx.db.delete(upload._id);
    return { ok: true };
  },
});

export const sweepAvatarUploads = internalMutation({ args: {}, handler: async ctx => {
  const now = Date.now();
  const due = await ctx.db.query("avatar_upload_ledger").withIndex("by_due", q => q.lte("dueAt", now)).take(10);
  for (const upload of due) {
    const account = await ctx.db.get(upload.accountId);
    const current = await ctx.db.query("accounts").withIndex("by_avatar", q => q.eq("avatarStorageId", upload.storageId)).first();
    const owned = await ctx.db.query("accounts").withIndex("by_owned_avatar", q => q.eq("avatarOwnedStorageId", upload.storageId)).first();
    if (current || owned) { await ctx.db.delete(upload._id); continue; }
    if (!account?.email) { await ctx.db.patch(upload._id, { dueAt: now + 24 * 60 * 60_000 }); continue; }
    const cases = await ctx.db.query("rental_damage_cases").withIndex("by_account", q => q.eq("accountId", account._id)).first();
    const linked = await ctx.db.query("bookings").withIndex("by_account", q => q.eq("accountId", account._id)).take(51);
    const legacy = await ctx.db.query("bookings").withIndex("by_guestEmail", q => q.eq("guestEmail", account.email.trim().toLowerCase())).filter(q => q.eq(q.field("accountId"), undefined)).take(51);
    let retained = !!cases || linked.length > 50 || legacy.length > 50;
    for (const booking of [...linked, ...legacy]) {
      if (retained) break;
      retained = !!(await ctx.db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", booking._id)).first());
    }
    if (retained) { await ctx.db.patch(upload._id, { dueAt: now + 24 * 60 * 60_000 }); continue; }
    await deletePrivateFile(ctx, upload.storageId);
    await ctx.db.delete(upload._id);
  }
} });

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
      const imgs = listingRentalImages(l);
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
          returnTime: li.returnTime ?? null,
          slug: (l as any)?.slug ?? null,
          heroImage: heroOf(l),
          imageSources: listingRentalImages(l),
          category: (l as any)?.category ?? null,
          tip: (l as any)?.knowledge?.summary ?? null,
        });
      }
      const starts = b.lineItems.map((li: any) => li.start);
      const ends = b.lineItems.map((li: any) => li.end);
      const verificationExpiresAt = verificationValidUntil(b);
      // Keep this projection aligned with the renter chat gate: confirmed,
      // paid, and all required checks approved by the recorded Didit result.
      const handoverReady = renterRentalActionReady(b);
      out.push({
        _id: b._id,
        status: b.status,
        idVerifyStatus: b.idVerifyStatus ?? "required",
        paidConfirmedAt: b.paidConfirmedAt ?? null,
        verificationExpiresAt,
        handoverDetails: handoverReady ? {
          phone: LEO_SUPPORT_PHONE,
          pickupAddress: b.fulfilment === "delivery" ? (typeof b.address === "string" ? b.address : null) : TRAFALGAR_PICKUP_ADDRESS,
          returnAddress: b.fulfilment === "delivery" && b.deliveryLegs !== "one_way"
            ? (typeof b.address === "string" ? b.address : null)
            : TRAFALGAR_PICKUP_ADDRESS,
          pickupInstructions: b.fulfilment === "pickup" || b.deliveryLegs === "one_way" ? TRAFALGAR_PICKUP_INSTRUCTIONS : null,
          fulfilment: b.fulfilment,
        } : null,
        lineItems: lines,
        total: b.total,
        subtotal: b.subtotal,
        discount: b.discount,
        deliveryFee: b.deliveryFee ?? 0,
        creditApplied: b.creditApplied ?? 0,
        depositAmount: b.depositAmount,
        depositHoldAmount: b.depositHoldAmount ?? 0,
        depositHoldStatus: b.depositHoldStatus ?? null,
        securityPolicyVersion: b.securityPolicyVersion ?? null,
        savedCardStatus: b.savedCardStatus ?? null,
        savedCardLimit: b.savedCardLimit ?? null,
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
        verificationNote: renterVerificationNote(b.verificationNote),
        verificationArchiveReady,
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
    await ctx.db.patch(accountId, { salt, hash, passwordSignInWindowStartedAt: undefined, passwordSignInAttemptCount: undefined });
  },
});

export const changePassword = action({
  args: { token: v.string(), oldPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, oldPassword, newPassword }) => {
    if (newPassword.length < 8 || newPassword.length > 256) throw new Error("New password must be 8 to 256 characters.");
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
    if (a.stripeSubscriptionId) throw new Error("Please contact the team to request deletion. Your subscription needs to be checked and cancelled first so billing does not continue.");
    if (a.membershipActive) throw new Error("Please contact the team to request deletion so we can review your membership and account records.");
    if (a.lastRestrictedAt != null) throw new Error("Please contact the team to request deletion so we can review your account records.");
    const [booking, guestBooking, archive, credit, thread, rentalCase, attachment, adminNote, adminChange] = await Promise.all([
      ctx.db.query("bookings").withIndex("by_account", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("bookings").withIndex("by_guestEmail_status", q => q.eq("guestEmail", a.email.trim().toLowerCase())).first(),
      ctx.db.query("verification_archives").withIndex("by_account", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("credits").withIndex("by_account", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("chat_threads").withIndex("by_account_updated", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("rental_damage_cases").withIndex("by_account", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("chat_attachment_attempts").withIndex("by_account_created", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("account_admin_notes").withIndex("by_account", q => q.eq("accountId", a._id)).first(),
      ctx.db.query("account_admin_changes").withIndex("by_account", q => q.eq("accountId", a._id)).first(),
    ]);
    if (booking || guestBooking || archive || credit || thread || rentalCase || attachment || adminNote || adminChange || a.stripeCustomerId) throw new Error("Please contact the team to request deletion. We'll review your rental and billing records and any applicable retention requirements.");
    const pendingAvatar = await ctx.db.query("avatar_upload_ledger").withIndex("by_account", q => q.eq("accountId", a._id)).first();
    if (pendingAvatar) throw new Error("Your photo is still being processed. Please try again later, or contact the team to request deletion.");
    if (a.avatarStorageId && a.avatarStorageId === a.avatarOwnedStorageId) {
      const [current, owned] = await Promise.all([
        ctx.db.query("accounts").withIndex("by_avatar", q => q.eq("avatarStorageId", a.avatarStorageId)).take(2),
        ctx.db.query("accounts").withIndex("by_owned_avatar", q => q.eq("avatarOwnedStorageId", a.avatarStorageId)).take(2),
      ]);
      if ([...current, ...owned].some(account => account._id !== a._id)) throw new Error("Please contact the team to request deletion so we can safely review your profile photo.");
    }
    const [sessions, links, devices] = await Promise.all([
      ctx.db.query("sessions").withIndex("by_account", q => q.eq("accountId", a._id)).take(101),
      ctx.db.query("account_access_links").withIndex("by_account", q => q.eq("accountId", a._id)).take(101),
      ctx.db.query("renter_push_subscriptions").withIndex("by_account_enabled", q => q.eq("accountId", a._id)).take(101),
    ]);
    if (sessions.length > 100 || links.length > 100 || devices.length > 100) throw new Error("Please contact the team to request deletion so we can safely review your account.");
    for (const device of devices) await ctx.db.delete(device._id);
    for (const session of sessions) await ctx.db.delete(session._id);
    for (const link of links) await ctx.db.delete(link._id);
    if (a.avatarStorageId && a.avatarStorageId === a.avatarOwnedStorageId) await deletePrivateFile(ctx, a.avatarStorageId);
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
  args: { accountId: v.id("accounts"), subscriptionId: v.string(), active: v.boolean(), tier: v.optional(v.string()) },
  handler: async (ctx, { accountId, subscriptionId, active, tier }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.stripeSubscriptionId !== subscriptionId) return false;
    const patch: Record<string, unknown> = { membershipActive: active, ...(!active ? { membershipStatus: "provider_missing", membershipPaidThrough: undefined } : {}) };
    if (tier) patch.membershipTier = tier;
    await ctx.db.patch(accountId, patch);
    return true;
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
