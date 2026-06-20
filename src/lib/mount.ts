/**
 * mount.ts (Next layer) — re-exports the ONE canonical mount/compat matrix from
 * convex/lib/mount.ts so the bot (gaffer.ts), the assemble API + page and the
 * compat engine share the exact same rule the Convex functions
 * (recommendations.ts, sync.ts) use. No second copy, no drift.
 *
 * The real logic lives in @cvx/lib/mount — it is a pure, framework-free module
 * (no Convex runtime imports) so it bundles cleanly into the client too.
 */
export {
  normalizeMount,
  parseMounts,
  mountCompat,
  bestCompat,
  lensScore,
  lensFits,
} from "../../convex/lib/mount";
export type { Mount, Compat, BestCompat } from "../../convex/lib/mount";
