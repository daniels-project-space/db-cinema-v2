/**
 * repairTaxonomy — GATED, ADDITIVE taxonomy data-repair for the `listings`
 * table (prod = veracious-wombat-196). Wave: branch fix/data-repair.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  THIS HAS NOT BEEN RUN AGAINST PROD. It is intentionally gated:
 *    - `repairTaxonomyDryRun` is a read-only QUERY (default entry point).
 *    - `repairTaxonomy` is an internalMutation that REFUSES to write unless
 *      called with `{ apply: true }`. With `apply:false` (default) it returns
 *      the same diff the dry-run query produces and writes nothing.
 *    - MANUAL-flagged slugs (service/hire, multi-brand, "PL-from-arri" guesses)
 *      are NEVER auto-applied unless `includeManual:true` AND each slug is in
 *      `confirmedManualSlugs` (human sign-off, one by one).
 *  Apply only after Daniel reviews DATA_REPAIR_DRYRUN.md.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * EXACT command to APPLY (do NOT run without sign-off; prod alias below):
 *
 *   # 1. (safety) export the listings table first
 *   npx convex export --path /tmp/listings-backup.zip   # full snapshot
 *   # 2. preview (writes nothing) — same as the dry-run query
 *   npx convex run migrations/repairTaxonomy:repairTaxonomy '{"apply":false}'
 *   # 3. APPLY the 78 non-manual changes (gated):
 *   npx convex run migrations/repairTaxonomy:repairTaxonomy '{"apply":true}'
 *   # 4. (optional) apply specific MANUAL items after review:
 *   npx convex run migrations/repairTaxonomy:repairTaxonomy \
 *     '{"apply":true,"includeManual":true,"confirmedManualSlugs":["<slug>", ...]}'
 *
 * The additive policy here is byte-identical to the offline dry-run that
 * produced DATA_REPAIR_DRYRUN.md (same deriveItemType / mountOf / deriveSpecs /
 * deriveCategory). Re-running the dry-run query before applying is recommended,
 * since the live table may have drifted from the snapshot.
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { deriveItemType, deriveSpecs, mountOf } from "../lib/taxonomy";

// Kept in sync with convex/sync.ts deriveCategory (display category layer).
const CATEGORY_RULES: [string, RegExp][] = [
  ["Cameras", /\b(camera|bmpcc|fx3|fx6|fx30|a7|a7s|a7iv|alexa|red\b|ursa|c70|c300|c200|pocket cinema|gh5|gh6|gh7|komodo|raptor|z\s?cam|s5|s1h|zv-?e)\b/i],
  ["Lenses", /\b(lens|lenses|sigma|samyang|tamron|rokinon|24-70|70-200|16-35|14-24|12-24|50mm|35mm|85mm|24mm|18-?35|prime|zoom lens|ef\b|rf\b|e-?mount|cine lens|dzo|vespid|blazar|atlas|sirui|great ?joy|laowa|gm\b|g ?master|gmaster|anamorphic)\b/i],
  ["Lighting", /\b(aputure|godox|nanlite|amaran|led panel|softbox|hmi|fresnel|600d|300d|120d|forza|light panel|key light|fill light)\b/i],
  ["Audio", /\b(mic|microphone|rode|røde|sennheiser|zoom h\d|recorder|wireless go|lav|lavalier|boom|deity|tascam|ntg|shotgun|speaker|partybox)\b/i],
  ["Drones", /\b(drone|mavic|mini\s?\d|air\s?\d|fpv|avata|dji (air|mini|neo))\b/i],
  ["Stabilizers", /\b(gimbal|ronin|crane|stabilizer|dji rs|rs\s?\d|rsc|moza|zhiyun)\b/i],
  ["Monitors", /\b(monitor|atomos|ninja|shinobi|smallhd|director|feelworld)\b/i],
  ["Power", /\b(battery|batteries|v-?mount|v-?lock|charger|np-?f|d-?tap)\b/i],
  ["Grip", /\b(tripod|slider|dolly|clamp|magic arm|c-?stand|sandbag|cage|rig|matte box|follow focus)\b/i],
];
function deriveCategory(name: string): string {
  if (CATEGORY_RULES[0][1].test(name) && /(\bset\b|\bkit\b|bundle|package|\+|operator|\d{2}-\d{2,3}\s?mm)/i.test(name)) return "Packages";
  for (const [cat, re] of CATEGORY_RULES) if (re.test(name)) return cat;
  return "Accessories";
}

const MANUAL_MULTIBRAND = /compatible with[^]*?(sony|canon|nikon|leica|fuji)[^]*?(canon|nikon|leica|fuji|sony)/i;
const SERVICE = /operator ?dp|\bdop\b|for hire/i;

type Plan = {
  slug: string;
  patch: Record<string, unknown>;
  changes: string[];
  manual: boolean;
  manualReasons: string[];
};

/**
 * Pure planner — given a listing doc, return the ADDITIVE patch (or null when no
 * change). Never overwrites a non-null mount/tier with null or a weaker guess.
 */
function planFor(l: {
  slug: string;
  title: string;
  category?: string | null;
  itemType?: string | null;
  specs?: Record<string, unknown> | null;
}): Plan | null {
  const title = l.title;
  const curCat = l.category ?? null;
  const curIt = l.itemType ?? null;
  const curSpecs = (l.specs ?? {}) as Record<string, unknown>;
  const curMount = (curSpecs.mount as string | undefined) ?? null;
  const curTier = (curSpecs.tier as string | undefined) ?? null;

  const newIt = deriveItemType(title);
  const newCat = deriveCategory(title);
  const isCamOrLens = newIt === "camera-body" || newIt === "lens";
  const derMount = isCamOrLens ? mountOf(title) : null;

  // additive mount
  let proposedMount = curMount;
  let mountReason = "";
  if (isCamOrLens) {
    if (!curMount && derMount) {
      proposedMount = derMount;
      mountReason = "backfill-null";
    } else if (curMount && derMount && curMount !== derMount && derMount.includes("/") && !curMount.includes("/")) {
      proposedMount = derMount;
      mountReason = "upgrade-to-compound";
    }
  } else if (curMount) {
    proposedMount = null;
    mountReason = "clear-mount(non-cam/lens)";
  }

  // additive tier
  const newTier = newIt === "lens" ? deriveSpecs(title, "lens").tier : null;
  let proposedTier = curTier;
  if (newIt === "lens" && !curTier && newTier) proposedTier = newTier;
  if (newIt !== "lens" && curTier) proposedTier = null;

  const changes: string[] = [];
  const patch: Record<string, unknown> = {};
  if (curCat !== newCat) {
    patch.category = newCat;
    changes.push(`category ${curCat}->${newCat}`);
  }
  if (curIt !== newIt) {
    patch.itemType = newIt;
    changes.push(`itemType ${curIt}->${newIt}`);
  }
  if ((curMount ?? null) !== (proposedMount ?? null) || (curTier ?? null) !== (proposedTier ?? null)) {
    // rebuild specs object additively (preserve all other spec fields)
    const nextSpecs: Record<string, unknown> = { ...curSpecs };
    if ((curMount ?? null) !== (proposedMount ?? null)) {
      if (proposedMount == null) delete nextSpecs.mount;
      else nextSpecs.mount = proposedMount;
      changes.push(`mount ${curMount ?? "∅"}->${proposedMount ?? "∅"} (${mountReason})`);
    }
    if ((curTier ?? null) !== (proposedTier ?? null)) {
      if (proposedTier == null) delete nextSpecs.tier;
      else nextSpecs.tier = proposedTier;
      changes.push(`tier ${curTier ?? "∅"}->${proposedTier ?? "∅"}`);
    }
    patch.specs = nextSpecs;
  }

  if (changes.length === 0) return null;

  const manualReasons: string[] = [];
  if (MANUAL_MULTIBRAND.test(title)) manualReasons.push("multi-brand-compat");
  if (SERVICE.test(title)) manualReasons.push("service/hire");
  if (mountReason === "backfill-null" && proposedMount === "PL" && /arri/i.test(title) && !/pl mount|pl native/i.test(title.toLowerCase()))
    manualReasons.push("PL-from-arri-guess");

  return { slug: l.slug, patch, changes, manual: manualReasons.length > 0, manualReasons };
}

/** READ-ONLY dry run. Returns the full diff; writes nothing. */
export const repairTaxonomyDryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db.query("listings").collect();
    const plans = ls.map(planFor).filter((p): p is Plan => p !== null);
    const auto = plans.filter((p) => !p.manual);
    const manual = plans.filter((p) => p.manual);
    return {
      total: ls.length,
      wouldChange: plans.length,
      autoApply: auto.length,
      manualHeld: manual.length,
      auto,
      manual,
    };
  },
});

/**
 * GATED apply. With apply:false (default) writes NOTHING (returns the plan).
 * With apply:true, applies only NON-manual plans, plus any manual plan whose
 * slug is explicitly confirmed.
 */
export const repairTaxonomy = internalMutation({
  args: {
    apply: v.optional(v.boolean()),
    includeManual: v.optional(v.boolean()),
    confirmedManualSlugs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { apply = false, includeManual = false, confirmedManualSlugs = [] }) => {
    const ls = await ctx.db.query("listings").collect();
    const confirmed = new Set(confirmedManualSlugs);
    let applied = 0;
    const skippedManual: string[] = [];
    const toApply: Plan[] = [];

    for (const l of ls) {
      const plan = planFor(l);
      if (!plan) continue;
      if (plan.manual && !(includeManual && confirmed.has(plan.slug))) {
        skippedManual.push(plan.slug);
        continue;
      }
      toApply.push(plan);
      if (apply) {
        await ctx.db.patch(l._id, plan.patch);
        applied++;
      }
    }

    return {
      dryRun: !apply,
      total: ls.length,
      planned: toApply.length,
      applied,
      skippedManual,
      // when dryRun, surface the planned patches for inspection
      plans: apply ? undefined : toApply,
    };
  },
});
