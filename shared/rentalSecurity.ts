/** Canonical security amounts, based on combined catalog replacement value. */
export type Protection = "verify" | "deposit";
export const SECURITY_POLICY_VERSION = "2026-10-value-bands-v1";

/** Retain the agreed security policy for additions to older bookings. */
export function legacyDepositFor(protection: Protection, replacementSum: number): number {
  return protection === "deposit" ? replacementSum : Math.max(50, Math.min(200, Math.round(replacementSum * 0.05)));
}

export function rentalSecurity(protection: Protection, replacementSum: number) {
  if (!Number.isFinite(replacementSum) || replacementSum < 0) throw Error("Invalid equipment replacement value.");
  if (replacementSum < 300) return { deposit: 100, hold: 0 };
  if (replacementSum < 1000) return { deposit: 100, hold: 100 };
  const hold = legacyDepositFor(protection, replacementSum);
  return { deposit: Math.round(hold * 50) / 100, hold };
}

export const depositFor = (protection: Protection, replacementSum: number) => rentalSecurity(protection, replacementSum).hold;
export const depositChargeFor = (protection: Protection, replacementSum: number) => rentalSecurity(protection, replacementSum).deposit;
export const smallDamageHold = (replacementSum: number) => depositFor("verify", replacementSum);
