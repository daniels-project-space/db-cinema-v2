import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Read-only check for use inside `query` handlers. Neither this check nor
 *  `assertAdmin` rate-limits failed attempts. See docs/ADMIN_AUTH_SECURITY.md. */
export function checkAdminToken(token: string): boolean {
  const secret = process.env.ADMIN_TOKEN;
  if (secret && token.length > 4096 && token.length !== secret.length) return false;
  return !!secret && timingSafeEqual(token, secret);
}

/** Token check for server code that lives *outside* Convex — specifically the
 *  Next route that proxies ElevenLabs. Keeps ADMIN_TOKEN in exactly one place
 *  (the Convex env) rather than duplicating the secret into Vercel's env too.
 *  This endpoint does not rate-limit attempts. */
export const verify = query({
  args: { token: v.string() },
  handler: async (_ctx, { token }) => ({ ok: checkAdminToken(token) }),
});

/** For mutation handlers: reject a bad token and audit successful mutations.
 * A failed mutation rolls back its writes, so failed attempts cannot be audited
 * or rate-limited by writing here. The audit also rolls back if the caller fails. */
export async function assertAdmin(ctx: MutationCtx, token: string, fn: string): Promise<void> {
  const ok = checkAdminToken(token);
  if (ok) {
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn });
    return;
  }
  throw new Error("unauthorized");
}

/** Internal-mutation wrapper around `assertAdmin`, for `action` handlers (e.g.
 *  checkout.markReturned) that have no `ctx.db` of their own and must reach it
 *  via `ctx.runMutation`. Successful calls are audited. Failed calls are not. */
export const assertAdminInternal = internalMutation({
  args: { token: v.string(), fn: v.string() },
  handler: async (ctx, { token, fn }) => {
    await assertAdmin(ctx, token, fn);
  },
});
