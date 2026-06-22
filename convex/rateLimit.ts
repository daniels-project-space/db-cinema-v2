import { mutation, internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/** Shared fixed-window limiter, usable inline from any mutation (e.g. contact spam guard).
 *  One row per key; resets when the window elapses. Atomic via Convex's serializable mutations. */
export async function bump(ctx: MutationCtx, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const row = await ctx.db.query("rate_limits").withIndex("by_key", (q) => q.eq("key", key)).first();
  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rate_limits", { key, windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (row.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - row.windowStart) };
  }
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return { allowed: true, remaining: limit - row.count - 1, retryAfterMs: 0 };
}

/** Public limiter used by the API routes (bot / assemble / compat / voice), keyed by client IP. */
export const hit = mutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, { key, limit, windowMs }) => bump(ctx, key, limit, windowMs),
});

/** Daily sweep: drop rate-limit rows whose window is long past. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("rate_limits").collect();
    let n = 0;
    for (const r of rows) if (r.windowStart < cutoff) { await ctx.db.delete(r._id); n++; }
    return { swept: n };
  },
});
