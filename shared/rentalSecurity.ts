/** Canonical security amounts, based on combined catalog replacement value. */
export type Protection = "verify" | "deposit";
export const SECURITY_POLICY_VERSION = "2026-10-ten-percent-hold-v2";

/** Retain the agreed security policy for additions to older bookings. */
export function legacyDepositFor(protection: Protection, replacementSum: number): number {
  return protection === "deposit" ? replacementSum : Math.max(50, Math.min(200, Math.round(replacementSum * 0.05)));
}

export function valueBandSecurity(protection: Protection, replacementSum: number) {
  if (!Number.isFinite(replacementSum) || replacementSum < 0) throw Error("Invalid equipment replacement value.");
  if (replacementSum < 300) return { deposit: 100, hold: 0 };
  if (replacementSum < 1000) return { deposit: 100, hold: 100 };
  const hold = legacyDepositFor(protection, replacementSum);
  return { deposit: Math.round(hold * 50) / 100, hold };
}

/** New card authorisations are 10% of authoritative equipment value, in pence.
 * The standard upfront payment is a separate amount and keeps its prior rule. */
export function rentalSecurity(_protection: Protection, replacementSum: number) {
  const previous = valueBandSecurity("verify", replacementSum);
  return { deposit: previous.deposit, hold: Math.round(replacementSum * 10) / 100 };
}

export function securityForPolicy(version: string | undefined, protection: Protection, value: number) {
  if (version === SECURITY_POLICY_VERSION) return rentalSecurity(protection, value);
  if (version === "2026-10-value-bands-v1") return valueBandSecurity(protection, value);
  const hold = legacyDepositFor(protection, value);
  return { hold, deposit: Math.round(hold * 50) / 100 };
}

export const depositFor = (protection: Protection, replacementSum: number) => rentalSecurity(protection, replacementSum).hold;
export const depositChargeFor = (protection: Protection, replacementSum: number) => rentalSecurity(protection, replacementSum).deposit;
export const smallDamageHold = (replacementSum: number) => depositFor("verify", replacementSum);
