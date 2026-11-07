import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { authorizeSessionInTransaction } from "./adminSessionsV2";

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function adminSessionMigrationReady(): boolean {
  return false;
}

export async function assignedIdentityDigest(ctx: QueryCtx): Promise<string> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.tokenIdentifier !== "string" || identity.tokenIdentifier.length > 512) throw new Error("unauthorized");
    const configuration = process.env.ADMIN_SESSION_SCOPES_V2;
    if (!configuration || configuration.length > 16_384) throw new Error("unauthorized");
    let assignments: unknown;
    try { assignments = JSON.parse(configuration); } catch { throw new Error("unauthorized"); }
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments) ||
        !Object.prototype.hasOwnProperty.call(assignments, identity.tokenIdentifier)) throw new Error("unauthorized");
    const scopes = (assignments as Record<string, unknown>)[identity.tokenIdentifier];
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every(scope => typeof scope === "string")) throw new Error("unauthorized");
    return await digest(identity.tokenIdentifier);
}

export const gatewayIdentityDigest = query({
  args: {},
  handler: async ctx => {
    if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
    return assignedIdentityDigest(ctx);
  },
});

export async function revokeOwnSessionInTransaction(ctx: MutationCtx, sessionToken: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(sessionToken)) throw new Error("unauthorized");
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity.tokenIdentifier !== "string" || identity.tokenIdentifier.length > 512)
    throw new Error("unauthorized");
  const tokenDigest = await digest(sessionToken);
  const session = await ctx.db.query("admin_sessions_v2")
    .withIndex("by_token_digest", q => q.eq("tokenDigest", tokenDigest)).unique();
  if (!session || session.principalId !== `admin:${await digest(identity.tokenIdentifier)}`)
    throw new Error("unauthorized");
  if (session.revokedAt === undefined) await ctx.db.patch(session._id, { revokedAt: Date.now() });
}

export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
    await revokeOwnSessionInTransaction(ctx, token);
  },
});

export async function assertAdminScopeSession(ctx: QueryCtx | MutationCtx, sessionToken: string, scope: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(sessionToken))
      throw new Error("unauthorized");
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.tokenIdentifier !== "string" || identity.tokenIdentifier.length > 512)
      throw new Error("unauthorized");
    const configuration = process.env.ADMIN_SESSION_SCOPES_V2;
    if (!configuration || configuration.length > 16_384) throw new Error("unauthorized");
    let assignments: unknown;
    try { assignments = JSON.parse(configuration); } catch { throw new Error("unauthorized"); }
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments) ||
        !Object.prototype.hasOwnProperty.call(assignments, identity.tokenIdentifier)) throw new Error("unauthorized");
    const assignedScopes = (assignments as Record<string, unknown>)[identity.tokenIdentifier];
    if (!Array.isArray(assignedScopes) || !assignedScopes.every(item => typeof item === "string") || !assignedScopes.includes(scope))
      throw new Error("unauthorized");
    const session = await authorizeSessionInTransaction(ctx, await digest(sessionToken), scope);
    if (!session || session.principalId !== `admin:${await digest(identity.tokenIdentifier)}`)
      throw new Error("unauthorized");
}

export async function assertCustomerWriteSession(ctx: MutationCtx, sessionToken: string): Promise<void> {
  await assertAdminScopeSession(ctx, sessionToken, "customers:write");
}

export async function assertCustomerReadSession(ctx: QueryCtx, sessionToken: string): Promise<void> {
  await assertAdminScopeSession(ctx, sessionToken, "customers:read");
}

export const checkSession = query({
  args: { token: v.string(), scope: v.string() },
  handler: async (ctx, { token, scope }) => {
    if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, scope);
    return { ok: true as const };
  },
});

export const authorizeDiditReview = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!adminSessionMigrationReady()) throw new Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, "verification:write");
  },
});
