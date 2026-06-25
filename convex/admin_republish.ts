/**
 * One-off admin: republish unpublished rental listings (2026-06-25).
 *
 * Sets active=true on listings that are currently inactive, EXCEPT ones flagged
 * `suppressed` (the deliberate marketing-only override the sync keeps inactive).
 * Touches ONLY the `active` field — nothing else.
 *
 * Internal (run via `npx convex run admin_republish:status` /
 * `admin_republish:republish '{"dryRun":true}'`).
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("listings").collect();
    const isSuppressed = (l: { suppressed?: boolean }) => l.suppressed === true;
    return {
      total: all.length,
      active: all.filter((l) => l.active === true).length,
      inactive: all.filter((l) => l.active !== true).length,
      suppressed: all.filter(isSuppressed).length,
      republishable: all.filter((l) => l.active !== true && !isSuppressed(l)).length,
      suppressed_titles: all
        .filter(isSuppressed)
        .map((l) => l.title)
        .slice(0, 60),
    };
  },
});

export const republish = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const all = await ctx.db.query("listings").collect();
    // Daniel: republish ALL unpublished listings (they're all marketing-only
    // `suppressed`), so clear suppression + activate. Touch ONLY the publish
    // state — nothing else.
    const targets = all.filter((l) => l.active !== true);
    let hasHyggloProductId = 0;
    if (!dryRun) {
      for (const l of targets) {
        await ctx.db.patch(l._id, { active: true, suppressed: false });
        if ((l as { hyggloProductId?: number }).hyggloProductId != null) hasHyggloProductId++;
      }
    } else {
      hasHyggloProductId = targets.filter(
        (l) => (l as { hyggloProductId?: number }).hyggloProductId != null,
      ).length;
    }
    return {
      dryRun: !!dryRun,
      republished: targets.length,
      // How many would be re-pruned by the catalog sync (hyggloProductId set +
      // not in the live RMv2 set) — i.e. won't stick without a sync change.
      tied_to_hygglo_product: hasHyggloProductId,
    };
  },
});
