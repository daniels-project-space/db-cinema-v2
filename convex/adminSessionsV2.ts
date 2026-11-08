import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const ALLOWED_SCOPES = new Set([
  "customers:read",
  "customers:write",
  "rentals:read",
  "rentals:write",
  "payments:read",
  "payments:write",
  "verification:read",
  "verification:write",
  "settings:read",
  "settings:write",
]);

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validSession(args: { tokenDigest: string; principalId: string; scopes: string[]; expiresAt: number }, now: number): boolean {
  return validDigest(args.tokenDigest) && /^[A-Za-z0-9:_-]{1,128}$/.test(args.principalId) &&
    args.scopes.length > 0 && args.scopes.length <= ALLOWED_SCOPES.size &&
    new Set(args.scopes).size === args.scopes.length && args.scopes.every(scope => ALLOWED_SCOPES.has(scope)) &&
    Number.isSafeInteger(args.expiresAt) && args.expiresAt > now && args.expiresAt <= now + MAX_SESSION_MS;
}

export const consumeLoginAttempt = internalMutation({
  args: { trustedClientDigest: v.string() },
  handler: async (ctx, { trustedClientDigest }) => {
    if (!validDigest(trustedClientDigest)) throw new Error("Invalid trusted client digest");
    const now = Date.now();
    const row = await ctx.db.query("admin_login_attempt_windows_v2")
      .withIndex("by_client_digest", q => q.eq("clientDigest", trustedClientDigest)).unique();
    if (!row) {
      await ctx.db.insert("admin_login_attempt_windows_v2", {
        clientDigest: trustedClientDigest, windowStart: now, expiresAt: now + WINDOW_MS, count: 1,
      });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (now >= row.expiresAt) {
      await ctx.db.patch(row._id, { windowStart: now, expiresAt: now + WINDOW_MS, count: 1 });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (row.count >= MAX_ATTEMPTS) return { allowed: false, retryAfterMs: row.expiresAt - now };
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return { allowed: true, retryAfterMs: 0 };
  },
});

export const createSession = internalMutation({
  args: { tokenDigest: v.string(), principalId: v.string(), scopes: v.array(v.string()), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!validSession(args, now)) {
      throw new Error("Invalid session parameters");
    }
    const existing = await ctx.db.query("admin_sessions_v2")
      .withIndex("by_token_digest", q => q.eq("tokenDigest", args.tokenDigest)).unique();
    if (existing) throw new Error("Session digest already exists");
    await ctx.db.insert("admin_sessions_v2", { ...args, createdAt: now });
  },
});

export const admitAndCreateSession = internalMutation({
  args: {
    clientDigest: v.string(), nonceDigest: v.string(), issuedAt: v.number(),
    tokenDigest: v.string(), principalId: v.string(), scopes: v.array(v.string()), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!validDigest(args.clientDigest) || !validDigest(args.nonceDigest) ||
        !Number.isSafeInteger(args.issuedAt) || args.issuedAt > now + 30_000 || args.issuedAt <= now - 120_000 ||
        !validSession(args, now)) return false;
    const nonce = await ctx.db.query("admin_login_attestation_nonces_v2")
      .withIndex("by_nonce_digest", q => q.eq("nonceDigest", args.nonceDigest)).unique();
    if (nonce) return false;
    const collision = await ctx.db.query("admin_sessions_v2")
      .withIndex("by_token_digest", q => q.eq("tokenDigest", args.tokenDigest)).unique();
    if (collision) return false;
    const window = await ctx.db.query("admin_login_attempt_windows_v2")
      .withIndex("by_client_digest", q => q.eq("clientDigest", args.clientDigest)).unique();
    if (window && now < window.expiresAt && window.count >= MAX_ATTEMPTS) return false;
    await ctx.db.insert("admin_login_attestation_nonces_v2", { nonceDigest: args.nonceDigest, expiresAt: args.issuedAt + 150_000 });
    if (!window) await ctx.db.insert("admin_login_attempt_windows_v2", {
      clientDigest: args.clientDigest, windowStart: now, expiresAt: now + WINDOW_MS, count: 1,
    });
    else if (now >= window.expiresAt) await ctx.db.patch(window._id, { windowStart: now, expiresAt: now + WINDOW_MS, count: 1 });
    else await ctx.db.patch(window._id, { count: window.count + 1 });
    await ctx.db.insert("admin_sessions_v2", {
      tokenDigest: args.tokenDigest, principalId: args.principalId, scopes: args.scopes, createdAt: now, expiresAt: args.expiresAt,
    });
    return true;
  },
});

export async function authorizeSessionInTransaction(ctx: QueryCtx | MutationCtx, tokenDigest: string, scope: string) {
  if (!validDigest(tokenDigest) || !ALLOWED_SCOPES.has(scope)) return null;
  const row = await ctx.db.query("admin_sessions_v2")
    .withIndex("by_token_digest", q => q.eq("tokenDigest", tokenDigest)).unique();
  if (!row || row.revokedAt !== undefined || row.expiresAt <= Date.now() || !row.scopes.includes(scope)) return null;
  return { principalId: row.principalId };
}

export const authorize = internalQuery({
  args: { tokenDigest: v.string(), scope: v.string() },
  handler: async (ctx, { tokenDigest, scope }) => authorizeSessionInTransaction(ctx, tokenDigest, scope),
});

export const revoke = internalMutation({
  args: { tokenDigest: v.string() },
  handler: async (ctx, { tokenDigest }) => {
    if (!validDigest(tokenDigest)) return false;
    const row = await ctx.db.query("admin_sessions_v2")
      .withIndex("by_token_digest", q => q.eq("tokenDigest", tokenDigest)).unique();
    if (!row) return false;
    if (row.revokedAt === undefined) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return true;
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    const sessions = await ctx.db.query("admin_sessions_v2")
      .withIndex("by_expiry", q => q.lte("expiresAt", now)).take(100);
    const windows = await ctx.db.query("admin_login_attempt_windows_v2")
      .withIndex("by_expiry", q => q.lte("expiresAt", now)).take(100);
    const nonces = await ctx.db.query("admin_login_attestation_nonces_v2")
      .withIndex("by_expiry", q => q.lte("expiresAt", now)).take(100);
    for (const row of [...sessions, ...windows, ...nonces]) await ctx.db.delete(row._id);
    return { sessions: sessions.length, windows: windows.length, nonces: nonces.length };
  },
});
