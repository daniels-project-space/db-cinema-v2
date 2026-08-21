import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { _applyPendingCollectiveGrant } from "./accounts";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — mirrors accounts.ts
const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

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
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", a.email))
      .first();
    if (!acct) {
      const id = await ctx.db.insert("accounts", {
        email: a.email,
        name: a.name,
        googleId: a.googleId,
        googleAvatarUrl: a.picture,
        createdAt: now,
      });
      await _applyPendingCollectiveGrant(ctx, id, a.email);
      await ctx.db.insert("sessions", {
        token: a.token,
        accountId: id,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (!acct.googleId) patch.googleId = a.googleId;
    if (!acct.name && a.name) patch.name = a.name;
    if (!acct.googleAvatarUrl && a.picture) patch.googleAvatarUrl = a.picture;
    if (Object.keys(patch).length) await ctx.db.patch(acct._id, patch);
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
  args: { credential: v.string() },
  handler: async (ctx, { credential }): Promise<{ token: string }> => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Google sign-in isn't configured yet.");
    const profile = await verifyGoogleIdToken(credential, clientId);
    const token = randomHex(24);
    await ctx.runMutation(internal.googleAuth._upsertGoogle, {
      email: profile.email,
      name: profile.name,
      googleId: profile.googleId,
      picture: profile.picture,
      token,
    });
    return { token };
  },
});
