/** Camera-mount ↔ lens-mount compatibility — the one rule, shared by the
 * bot API and the assembly UI (they had drifted copies). */
export function lensFits(lensMount: string | null | undefined, camMounts: string[]) {
  if (!lensMount || camMounts.length === 0) return true;
  if (camMounts.every((m) => m === "fixed")) return false;
  return camMounts.some(
    (m) =>
      m === "any" ||
      lensMount === "any" ||
      m === lensMount ||
      (lensMount === "EF" && (m === "E" || m === "RF")),
  );
}
