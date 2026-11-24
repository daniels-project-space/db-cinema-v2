import { roundGbp } from "../../shared/rentalPricing";
export { buildTiers, quote, type Pricing, type Tier, type Quote, type NextTier } from "../../shared/rentalPricing";

export const toPence = (gbp: number) => Math.round(roundGbp(gbp) * 100);

// ── Protection model: ID+insurance (small damage hold) vs full deposit ──
import type { Protection } from "../../shared/rentalSecurity";
export { depositFor, depositChargeFor, smallDamageHold, type Protection } from "../../shared/rentalSecurity";

export const PROTECTION_LABEL: Record<Protection, string> = {
  verify: "Refundable damage hold (covers minor damage)",
  deposit: "Refundable security deposit",
};
