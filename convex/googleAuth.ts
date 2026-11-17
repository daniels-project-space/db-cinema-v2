import { ensureReferralCode } from "./lib/referrals";
import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { _applyPendingCollectiveGrant } from "./accounts";
import { ConvexError } from "convex/values";
import { accountAuthError } from "../shared/accountAuth";
import { CURRENT_PRIVACY_NOTICE_VERSION, legalVersionForPolicy } from "../shared/legalVersioning";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — mirrors accounts.ts
const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
// Google ID tokens are small JWTs. Bound the untrusted public action input
// before decoding or making a certificate request.
const MAX_GOOGLE_ID_TOKEN_LENGTH = 16 * 1024;

const toHex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
function randomHex(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
}

function b64urlBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlStr = (s: string) => new TextDecoder().decode(b64urlBytes(s));

/** Verify a Google ID token (the JWT the GIS button hands back) WITHOUT a client secret:
 *  check the RS256 signature against Google's published JWKS, then the standard claims.
 *  The audience must equal OUR OAuth client id, so a token minted for another site is rejected. */
async function verifyGoogleIdToken(idToken: string, clientId: string) {
  if (idToken.length > MAX_GOOGLE_ID_TOKEN_LENGTH)
    throw new Error("Google sign-in token is too large.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed Google token.");
  const [h, p, sig] = parts;
  const header = JSON.parse(b64urlStr(h));
  const payload = JSON.parse(b64urlStr(p));
  if (header.alg !== "RS256") throw new Error("Unexpected Google token algorithm.");

  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error("Couldn't reach Google to verify the sign-in.");
  const { keys } = await res.json();
  const jwk = (keys as any[]).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Google signing key not found — try again.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(sig) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`) as BufferSource,
  );
  if (!valid) throw new Error("Google token signature is invalid.");

  const iss = payload.iss;
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com")
    throw new Error("Unexpected Google token issuer.");
  if (payload.aud !== clientId)
    throw new Error("This Google sign-in wasn't issued for this site.");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now())
    throw new Error("Google sign-in expired — tap the button again.");
  if (payload.email_verified !== true && payload.email_verified !== "true")
    throw new Error("Your Google email isn't verified.");
  if (!payload.email) throw new Error("Google didn't share an email address.");

  return {
    email: String(payload.email).trim().toLowerCase(),
    name: payload.name ? String(payload.name) : undefined,
    googleId: String(payload.sub),
    picture: payload.picture ? String(payload.picture) : undefined,
  };
}

/** Find-or-create the account for a verified Google profile, then mint a session.
 *  Links Google onto an existing (e.g. password) account that shares the email, so a
 *  renter who signed up with a password can later just tap "Continue with Google". */
export const _upsertGoogle = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    googleId: v.string(),
    picture: v.optional(v.string()),
    token: v.string(),
    termsAndPrivacyAcknowledged: v.boolean(),
    accountTermsVersion: v.optional(v.string()),
    accountTermsAcceptedAt: v.optional(v.number()),
    privacyNoticeVersion: v.optional(v.string()),
    privacyNoticeAcknowledgedAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", a.email))
      .first();
    // The email on a Google profile can change while its stable OIDC `sub`
    // remains the same. Never create a second account for that identity or
    // link it to another email-matched account. Keep this check in the same
    // mutation as account creation/linking so concurrent sign-ins cannot race.
    const linkedAccounts = await ctx.db
      .query("accounts")
      .withIndex("by_google_id", (q) => q.eq("googleId", a.googleId))
      .take(2);
    if (linkedAccounts.length > 1)
      throw new Error("This Google identity is linked to multiple accounts. Contact the team.");
    const linkedAccount = linkedAccounts[0] ?? null;
    if (linkedAccount && linkedAccount._id !== acct?._id)
      throw new Error("This Google identity is already linked to a different account.");
    if (acct?.blockedAt != null) throw Error("This account is blocked. Contact DB Cinema Rentals.");
    if (!acct) {
      if (!a.termsAndPrivacyAcknowledged || !a.accountTermsVersion || !Number.isSafeInteger(a.accountTermsAcceptedAt) || !a.privacyNoticeVersion || !Number.isSafeInteger(a.privacyNoticeAcknowledgedAt))
        throw new ConvexError(accountAuthError("SIGNUP_TERMS_REQUIRED"));
      const id = await ctx.db.insert("accounts", {
        email: a.email,
        name: a.name,
        googleId: a.googleId,
        googleAvatarUrl: a.picture,
        emailVerifiedAt: now,
        emailVerificationRequired: false,
        accountTermsVersion: a.accountTermsVersion,
        accountTermsAcceptedAt: a.accountTermsAcceptedAt,
        privacyNoticeVersion: a.privacyNoticeVersion,
        privacyNoticeAcknowledgedAt: a.privacyNoticeAcknowledgedAt,
        createdAt: now,
      });
      await ensureReferralCode(ctx,id);
      await _applyPendingCollectiveGrant(ctx, id, a.email);
      await ctx.scheduler.runAfter(0,internal.verificationArchive.linkVerifiedAccount,{accountId:id,cursor:null});
      await ctx.db.insert("sessions", {
        token: a.token,
        accountId: id,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
      return;
    }
    // A verified email can establish the first Google link on a password
    // account, but it must never replace an identity already linked there.
    // Check before profile, verification, or session changes so a mismatch is
    // a no-op.
    if (acct.googleId && acct.googleId !== a.googleId)
      throw new Error("This Google account does not match the identity linked to this email.");
    if (!acct.googleId && (!acct.hash || !acct.salt))
      throw new Error("This account cannot be linked to Google using email alone.");
    const needsVerificationRecovery=!acct.emailVerifiedAt||acct.emailVerificationRequired;
    const patch: Record<string, unknown> = {emailVerifiedAt:now,emailVerificationRequired:false};
    if(acct.emailVerificationRequired&&!acct.emailVerifiedAt){
      patch.hash=undefined;patch.salt=undefined;
      const sessions=await ctx.db.query("sessions").withIndex("by_account",q=>q.eq("accountId",acct._id)).collect();for(const session of sessions)await ctx.db.delete(session._id);
    }
    if (!acct.googleId) patch.googleId = a.googleId;
    if (!acct.name && a.name) patch.name = a.name;
    if (!acct.googleAvatarRemoved && !acct.googleAvatarUrl && a.picture) patch.googleAvatarUrl = a.picture;
    if (Object.keys(patch).length) await ctx.db.patch(acct._id, patch);
    if(needsVerificationRecovery)await ctx.scheduler.runAfter(0,internal.verificationArchive.linkVerifiedAccount,{accountId:acct._id,cursor:null});
    await ctx.db.insert("sessions", {
      token: a.token,
      accountId: acct._id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
  },
});

/** Exchange a Google ID token for a Db Cinema session token. */
export const signInWithGoogle = action({
  args: { credential: v.string(), termsAndPrivacyAcknowledged: v.optional(v.boolean()), termsVersion: v.optional(v.string()), privacyNoticeVersion: v.optional(v.string()) },
  handler: async (ctx, { credential, termsAndPrivacyAcknowledged, termsVersion, privacyNoticeVersion }): Promise<{ token: string }> => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Google sign-in isn't configured yet.");
    const profile = await verifyGoogleIdToken(credential, clientId);
    const existing = await ctx.runQuery(internal.accounts._byEmail, { email: profile.email });
    let accepted: { termsAndPrivacyAcknowledged: boolean; accountTermsVersion?: string; accountTermsAcceptedAt?: number; privacyNoticeVersion?: string; privacyNoticeAcknowledgedAt?: number } = { termsAndPrivacyAcknowledged: false };
    if (!existing) {
      if (termsAndPrivacyAcknowledged !== true)
        throw new ConvexError(accountAuthError("SIGNUP_TERMS_REQUIRED"));
      const policy = await ctx.runQuery(api.settings.get, {});
      const currentTermsVersion = legalVersionForPolicy(policy);
      if (termsVersion !== currentTermsVersion || privacyNoticeVersion !== CURRENT_PRIVACY_NOTICE_VERSION)
        throw new ConvexError(accountAuthError("SIGNUP_TERMS_UPDATED"));
      const acceptedAt = Date.now();
      accepted = {
        termsAndPrivacyAcknowledged: true,
        accountTermsVersion: currentTermsVersion,
        accountTermsAcceptedAt: acceptedAt,
        privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
        privacyNoticeAcknowledgedAt: acceptedAt,
      };
    }
    const token = randomHex(24);
    await ctx.runMutation(internal.googleAuth._upsertGoogle, {
      email: profile.email,
      name: profile.name,
      googleId: profile.googleId,
      picture: profile.picture,
      token,
      ...accepted,
    });
    return { token };
  },
});
