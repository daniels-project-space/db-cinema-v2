import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";

/**
 * Diagnostics for the inbound phone path (SignalWire → ElevenLabs).
 *
 * `/api/swml/inbound` calls `record` on every fetch. SignalWire must fetch that
 * script to place a call, so these rows answer the one question the SIP logs
 * can't: did SignalWire run the script at all? No rows + no INVITE at
 * ElevenLabs means the failure is upstream of the SIP bridge entirely.
 *
 * Deliberately unauthenticated (SignalWire can't send our admin token) but
 * write-only and self-trimming, so it can't be used to read anything or grow
 * without bound.
 */
const KEEP = 50;

export const record = mutation({
  args: {
    method: v.string(),
    ip: v.optional(v.string()),
    ua: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("swml_hits", { at: Date.now(), ...args });
    // Keep only the most recent KEEP rows — this is a debugging aid, not a log.
    const all = await ctx.db.query("swml_hits").withIndex("by_at").order("desc").collect();
    for (const row of all.slice(KEEP)) await ctx.db.delete(row._id);
  },
});

export const recent = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, hits: [] };
    const hits = await ctx.db.query("swml_hits").withIndex("by_at").order("desc").take(25);
    return { authorized: true as const, hits };
  },
});
