/** Canonical security amounts, based on combined catalog replacement value. */
export type Protection = "verify" | "deposit";
export const SECURITY_POLICY_VERSION = "2026-10-saved-card-v1";
/** A separate immutable policy: never reinterpret an existing signed rental. */
export const REFUNDABLE_DEPOSIT_POLICY_VERSION = "2026-10-refundable-deposit-v1";
export const ASSESSMENT_SECURITY_POLICY_VERSION = "2026-10-refundable-assessment-v2";
export function hasCashDepositPolicy(version?:string|null){return version===REFUNDABLE_DEPOSIT_POLICY_VERSION || version===ASSESSMENT_SECURITY_POLICY_VERSION;}
export function assessmentDepositFor(value:number){return refundableDepositFor(value) || 20;}
export function cardLimitForPolicy(version:string|undefined,value:number){return version===ASSESSMENT_SECURITY_POLICY_VERSION ? 0 : savedCardChargeLimit(value);}
export function depositForBookingPolicy(b:any,value:number){
 if(b.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION)return b.securityWaiverReason ? 0 : assessmentDepositFor(value);
 return refundableDepositFor(value);
}
export function refundableDepositFor(replacementSum: number) {
  if (!Number.isFinite(replacementSum) || replacementSum < 0 || !Number.isSafeInteger(Math.round(replacementSum * 100)))
    throw Error("Invalid equipment replacement value.");
  const valuePence=Math.round(replacementSum*100);
  return valuePence < 100000 ? 0 : valuePence < 400000 ? 50 : 100;
}

export const LEGACY_TEN_PERCENT_HOLD_POLICY = "2026-10-ten-percent-hold-v2";
/** An agreed collection ceiling, not a bank authorisation or reserved balance. */
export function savedCardChargeLimit(replacementSum: number) {
  if (!Number.isFinite(replacementSum) || replacementSum < 0) throw Error("Invalid equipment replacement value.");
  return Math.round(replacementSum * 10) / 100;
}

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

/** Standard card authorisations are 10% of authoritative equipment value.
 * The optional full-value choice and separate upfront payments keep their prior rules. */
function tenPercentHoldSecurity(protection: Protection, replacementSum: number) {
  const previous = valueBandSecurity("verify", replacementSum);
  if (protection === "deposit" && replacementSum >= 1000) return valueBandSecurity("deposit", replacementSum);
  return { deposit: previous.deposit, hold: Math.round(replacementSum * 10) / 100 };
}

export function rentalSecurity(_protection: Protection, replacementSum: number) {
  savedCardChargeLimit(replacementSum);
  return { deposit: 0, hold: 0 };
}

export function securityForPolicy(version: string | undefined, protection: Protection, value: number) {
  if (version === ASSESSMENT_SECURITY_POLICY_VERSION) return { deposit:assessmentDepositFor(value),hold:0 };
  if (version === REFUNDABLE_DEPOSIT_POLICY_VERSION) return { deposit: refundableDepositFor(value), hold: 0 };
  if (version === SECURITY_POLICY_VERSION) return rentalSecurity(protection, value);
  if (version === LEGACY_TEN_PERCENT_HOLD_POLICY) return tenPercentHoldSecurity(protection, value);
  if (version === "2026-10-value-bands-v1") return valueBandSecurity(protection, value);
  const hold = legacyDepositFor(protection, value);
  return { hold, deposit: Math.round(hold * 50) / 100 };
}

export const depositFor = (protection: Protection, replacementSum: number) => rentalSecurity(protection, replacementSum).hold;
export const depositChargeFor = (protection: Protection, replacementSum: number) => rentalSecurity(protection, replacementSum).deposit;
export const smallDamageHold = (replacementSum: number) => depositFor("verify", replacementSum);
