/** Camera-mount ↔ lens-mount compatibility — the one rule, shared by the
 * bot API and the assembly UI (they had drifted copies).
 *
 * The real logic now lives in ./mount.ts (three-state native/adapter/
 * incompatible + scoring). This file re-exports so existing
 * `import { lensFits } from "@/lib/gear"` call-sites keep working without a
 * second divergent copy. Prefer importing from "@/lib/mount" in new code. */
export {
  lensFits,
  lensScore,
  parseMounts,
  normalizeMount,
  mountCompat,
  bestCompat,
} from "./mount";
export type { Mount, Compat, BestCompat } from "./mount";
