import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { checkAdminToken } from "./adminAuth";

function assertWorkerSecret(secret: string) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) throw new Error("unauthorized");
  const received = new TextEncoder().encode(secret);
  const configured = new TextEncoder().encode(expected);
  let difference = received.length === configured.length ? 0 : 1;
  for (let index = 0; index < Math.max(received.length, configured.length); index++) difference |= (received[index] ?? 0) ^ (configured[index] ?? 0);
  if (difference) throw new Error("unauthorized");
}

export const status = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, connected: false as const, email: undefined, connectedAt: undefined, lastSyncAt: undefined, lastSyncError: undefined, oauthConfigured: false };
    const row = await ctx.db.query("gmail_connections").first();
    return {
      authorized: true as const,
      connected: Boolean(row),
      email: row?.email,
      connectedAt: row?.connectedAt,
      lastSyncAt: row?.lastSyncAt,
      lastSyncError: row?.lastSyncError,
      oauthConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GMAIL_TOKEN_ENCRYPTION_KEY),
    };
  },
});

/** OAuth callback only: store the refresh token after the Next server encrypts it. */
export const completeOAuth = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    encryptedRefreshToken: v.string(),
    historyId: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    const email = args.email.trim().toLowerCase();
    if (email !== "info@dbcinemarentals.com") throw new Error("Only the DB Cinema business Gmail account can be connected");
    if (!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{20,4096}$/.test(args.encryptedRefreshToken)) throw new Error("Invalid encrypted Gmail credential");
    if (!/^\d{1,30}$/.test(args.historyId)) throw new Error("Invalid Gmail history checkpoint");
    const now = Date.now();
    const existing = await ctx.db.query("gmail_connections").first();
    const values = { email, encryptedRefreshToken: args.encryptedRefreshToken, historyId: args.historyId, connectedAt: existing?.connectedAt ?? now, updatedAt: now, lastSyncAt: undefined, lastSyncError: undefined, syncLeaseUntil: undefined, syncStartHistoryId: undefined, syncPageToken: undefined, syncPendingMessageIds: undefined, syncTargetHistoryId: undefined, syncFailures: undefined, syncRetryAt: undefined };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("gmail_connections", values);
    return { ok: true };
  },
});

export const getForWorker = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("gmail_connections").first(),
});

export const hasConnectedMailbox = internalQuery({
  args: {},
  handler: async (ctx) => Boolean(await ctx.db.query("gmail_connections").first()),
});

export const removeConnection = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ ok: true }> => {
    const row = await ctx.db.query("gmail_connections").first();
    if (row) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

export const claimSync = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("gmail_connections").first();
    if (!row || (row.syncLeaseUntil ?? 0) > Date.now() || (row.syncRetryAt ?? 0) > Date.now() || row.lastSyncError?.startsWith("History checkpoint expired")) return null;
    await ctx.db.patch(row._id, { syncLeaseUntil: Date.now() + 10 * 60_000 });
    return {
      historyId: row.historyId,
      syncStartHistoryId: row.syncStartHistoryId,
      syncPageToken: row.syncPageToken,
      syncPendingMessageIds: row.syncPendingMessageIds,
      syncTargetHistoryId: row.syncTargetHistoryId,
    };
  },
});

export const saveSyncBatch = internalMutation({
  args: {
    startHistoryId: v.string(),
    pageToken: v.optional(v.string()),
    pendingMessageIds: v.array(v.string()),
    targetHistoryId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("gmail_connections").first();
    if (!row) return false;
    await ctx.db.patch(row._id, {
      syncStartHistoryId: args.startHistoryId,
      syncPageToken: args.pageToken,
      syncPendingMessageIds: args.pendingMessageIds,
      syncTargetHistoryId: args.targetHistoryId,
    });
    return true;
  },
});

export const acknowledgeSyncMessage = internalMutation({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    const row = await ctx.db.query("gmail_connections").first();
    if (!row) return false;
    const pending = row.syncPendingMessageIds ?? [];
    if (pending[0] === messageId) await ctx.db.patch(row._id, { syncPendingMessageIds: pending.slice(1) });
    else if (pending.includes(messageId)) await ctx.db.patch(row._id, { syncPendingMessageIds: pending.filter((id) => id !== messageId) });
    return true;
  },
});

export const finishSync = internalMutation({
  args: { historyId: v.optional(v.string()), error: v.optional(v.string()), keepPage: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("gmail_connections").first();
    if (!row) return false;
    const now = Date.now();
    const failures = args.error ? (row.syncFailures ?? 0) + 1 : 0;
    await ctx.db.patch(row._id, {
      ...(args.historyId ? { historyId: args.historyId } : {}),
      lastSyncAt: now,
      lastSyncError: args.error?.slice(0, 300),
      syncLeaseUntil: undefined,
      syncFailures: failures || undefined,
      syncRetryAt: args.error ? now + Math.min(60, 2 ** Math.min(failures, 6)) * 60_000 : undefined,
      ...(!args.keepPage && !args.error ? { syncStartHistoryId: undefined, syncPageToken: undefined, syncPendingMessageIds: undefined, syncTargetHistoryId: undefined } : {}),
    });
    return true;
  },
});

export const disconnect = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ ok: true; revoked: boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "gmailConnection.disconnect" });
    const revocation: { revoked: boolean } = await ctx.runAction(internal.gmailTransport.revoke, {});
    await ctx.runMutation(internal.gmailConnection.removeConnection, {});
    return { ok: true, revoked: revocation.revoked };
  },
});
