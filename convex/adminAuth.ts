import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { bump } from "./rateLimit";

const WINDOW_MS = 5 * 60 * 1000;
const ATTEMPT_LIMIT = 8;
const RATE_KEY = "admin_token";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Read-only check for use inside `query` handlers. Convex queries can't write,
 *  so this alone cannot rate-limit or audit-log — pair with `assertAdmin` on the
 *  mutation side for real brute-force protection. */
export function checkAdminToken(token: string): boolean {
  const secret = process.env.ADMIN_TOKEN;
  return !!secret && timingSafeEqual(token, secret);
}

/** Token check for server code that lives *outside* Convex — specifically the
 *  Next route that proxies ElevenLabs. Keeps ADMIN_TOKEN in exactly one place
 *  (the Convex env) rather than duplicating the secret into Vercel's env too.
 *  Same read-only caveat as `checkAdminToken`: pair with `assertAdmin` for
 *  anything that writes. */
export const verify = query({
  args: { token: v.string() },
  handler: async (_ctx, { token }) => ({ ok: checkAdminToken(token) }),
});

/** For `mutation` handlers: throws on bad token; rate-limits + audit-logs failures.
 *  `fn` is a short label (e.g. "bookings.adminSetStatus") for the audit trail. */
export async function assertAdmin(ctx: MutationCtx, token: string, fn: string): Promise<void> {
  const ok = checkAdminToken(token);
  if (ok) {
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn });
    return;
  }
  const limited = await bump(ctx, RATE_KEY, ATTEMPT_LIMIT, WINDOW_MS);
  await ctx.db.insert("admin_audit_log", { at: Date.now(), success: false, limited: !limited.allowed, fn });
  if (!limited.allowed) throw new Error("Too many attempts. Try again in a few minutes.");
  throw new Error("unauthorized");
}

/** Internal-mutation wrapper around `assertAdmin`, for `action` handlers (e.g.
 *  checkout.markReturned) that have no `ctx.db` of their own and must reach it
 *  via `ctx.runMutation`. Keeps rate-limiting + audit-logging on that call site
 *  too, not just direct-mutation call sites. */
export const assertAdminInternal = internalMutation({
  args: { token: v.string(), fn: v.string() },
  handler: async (ctx, { token, fn }) => {
    await assertAdmin(ctx, token, fn);
  },
});
