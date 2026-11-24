import { buildTiers } from "../../shared/rentalPricing";

const LEGACY_WEBSITE_PRICE_INCREASE = 1.227;
export const WEBSITE_PRICE_POLICY_VERSION = 6;
const DAILY_PRICE_REDUCTION = 0.95;
export const WEBSITE_PRICE_DISCOUNTS = {
  daily: 0,
  day3: 0.10,
  day7: 0.30,
  day14: 0.35,
  day30: 0.40,
} as const;

export const WEBSITE_PRICE_KEYS = ["daily", "day3", "day7", "day14", "day30"] as const;
type PriceKey = (typeof WEBSITE_PRICE_KEYS)[number];

export type WebsitePriceLadder = {
  daily: number;
  day3?: number;
  day7?: number;
  day14?: number;
  day30?: number;
};

export type WebsitePriceFactors = Partial<Record<PriceKey, number>>;

const roundPenny = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const RUNG_DAYS: Record<PriceKey, number> = {
  daily: 1,
  day3: 3,
  day7: 7,
  day14: 14,
  day30: 30,
};

function effectiveRates(pricing: WebsitePriceLadder): Record<PriceKey, number> {
  const tiers = buildTiers(pricing);
  return Object.fromEntries(
    WEBSITE_PRICE_KEYS.map((key) => [
      key,
      pricing[key] ?? tiers.find((tier) => tier.days === RUNG_DAYS[key])!.perDay,
    ]),
  ) as Record<PriceKey, number>;
}

function factorFromVisibleRate(sourceRate: number, baselineRate: number): number {
  const visibleRate = Math.ceil(roundPenny(baselineRate));
  const targetRate = roundPenny(visibleRate * LEGACY_WEBSITE_PRICE_INCREASE);
  if (sourceRate > 0 && targetRate <= 0) {
    throw new Error("Cannot establish a positive website price from the displayed source rate");
  }
  return sourceRate > 0
    ? Math.round((targetRate / sourceRate) * 1_000_000_000_000) / 1_000_000_000_000
    : LEGACY_WEBSITE_PRICE_INCREASE;
}

export function websitePriceFactors(
  source: WebsitePriceLadder,
  savedFactors?: WebsitePriceFactors,
  visibleBaseline: WebsitePriceLadder = source,
): WebsitePriceFactors {
  const factors: WebsitePriceFactors = {};
  const sourceRates = effectiveRates(source);
  const baselineRates = effectiveRates(visibleBaseline);
  const sourceDaily = sourceRates.daily;
  const savedDaily = savedFactors?.daily;
  const dailyFactor = savedDaily ?? factorFromVisibleRate(sourceDaily, baselineRates.daily);
  const targetDaily = sourceDaily > 0
    ? Math.ceil(roundPenny(sourceDaily * dailyFactor))
    : 0;
  for (const key of WEBSITE_PRICE_KEYS) {
    const value = sourceRates[key];
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key} source price`);
    const saved = savedFactors?.[key];
    if (saved !== undefined && (!Number.isFinite(saved) || saved <= 0)) {
      throw new Error(`Invalid stored website ${key} price factor`);
    }
    const discount = WEBSITE_PRICE_DISCOUNTS[key];
    const targetRate = key === "daily"
      ? targetDaily
      : Math.ceil(roundPenny(targetDaily * (1 - discount)));
    factors[key] = key === "daily"
      ? dailyFactor
      : value > 0
        ? Math.round((targetRate / value) * 1_000_000_000_000) / 1_000_000_000_000
        : dailyFactor * (1 - discount);
  }
  return factors;
}

export function websitePriceFactorsForPolicy(
  source: WebsitePriceLadder,
  savedFactors?: WebsitePriceFactors,
  savedPolicyVersion?: number,
  currentVisiblePricing?: WebsitePriceLadder,
): WebsitePriceFactors {
  if (savedPolicyVersion === WEBSITE_PRICE_POLICY_VERSION) {
    if (!savedFactors || WEBSITE_PRICE_KEYS.some((key) => savedFactors[key] === undefined)) {
      throw new Error("Stored website price factors are incomplete for the active policy");
    }
    return websitePriceFactors(source, savedFactors);
  }

  if (savedPolicyVersion === 5) {
    throw new Error("Website price policy v5 needs provenance review before applying the daily reduction");
  }

  // A policy migration must not reapply a markup to existing catalog prices.
  // Version 4 already includes the daily reduction; older policies do not.
  if (currentVisiblePricing) {
    const sourceDaily = effectiveRates(source).daily;
    const visibleDaily = effectiveRates(currentVisiblePricing).daily;
    if (!Number.isFinite(sourceDaily) || sourceDaily < 0 || !Number.isFinite(visibleDaily) || visibleDaily < 0) {
      throw new Error("Invalid daily price while migrating website price policy");
    }
    const reducedDaily = visibleDaily * (savedPolicyVersion === 4 ? 1 : DAILY_PRICE_REDUCTION);
    const dailyFactor = sourceDaily > 0
      ? Math.round((reducedDaily / sourceDaily) * 1_000_000_000_000) / 1_000_000_000_000
      : LEGACY_WEBSITE_PRICE_INCREASE;
    return websitePriceFactors(source, { daily: dailyFactor }, currentVisiblePricing);
  }

  const previous = websitePriceFactors(source, savedFactors?.daily === undefined
    ? undefined
    : { daily: savedFactors.daily });
  const sourceDaily = effectiveRates(source).daily;
  const previousDaily = Math.ceil(roundPenny(sourceDaily * previous.daily!));
  const dailyFactor = sourceDaily > 0
    ? previousDaily * (savedPolicyVersion === 4 ? 1 : DAILY_PRICE_REDUCTION) / sourceDaily
    : previous.daily!;
  return websitePriceFactors(source, { daily: dailyFactor });
}

export function applyWebsitePriceFactors(
  source: WebsitePriceLadder,
  factors: WebsitePriceFactors,
): WebsitePriceLadder {
  const sourceRates = effectiveRates(source);
  const dailyFactor = factors.daily;
  if (dailyFactor === undefined || !Number.isFinite(dailyFactor) || dailyFactor <= 0) {
    throw new Error("Missing website daily price factor");
  }
  const daily = Math.ceil(roundPenny(sourceRates.daily * dailyFactor));
  const result: Partial<WebsitePriceLadder> = { daily };
  for (const key of WEBSITE_PRICE_KEYS) {
    const value = sourceRates[key];
    const factor = factors[key];
    if (factor === undefined || !Number.isFinite(factor) || factor <= 0) {
      throw new Error(`Missing website price factor for ${key}`);
    }
    if (key !== "daily") {
      result[key] = Math.ceil(roundPenny(daily * (1 - WEBSITE_PRICE_DISCOUNTS[key])));
    }
  }
  return result as WebsitePriceLadder;
}
