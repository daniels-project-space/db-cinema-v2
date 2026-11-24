import { roundGbp } from "../../shared/rentalPricing";
export { buildTiers, quote, type Pricing, type Tier, type Quote, type NextTier } from "../../shared/rentalPricing";

export const money = (n: number) => Math.round(n); // whole-pound display
export const formatGbp = (n: number) => new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP"}).format(n);
export const formatRate = (n: number) => new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(Math.ceil(roundGbp(n)));

// Security amounts are separate from renter liability and company insurance.
import type { Protection } from "../../shared/rentalSecurity";
export { depositFor, depositChargeFor, smallDamageHold, type Protection } from "../../shared/rentalSecurity";

export const PROTECTION_LABEL: Record<Protection, string> = {
  verify: "Refundable security payment and any quoted card hold",
  deposit: "Refundable security deposit",
};
