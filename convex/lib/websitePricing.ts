export const WEBSITE_PRICE_INCREASE = 1.227;

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

function factorFromVisibleRate(sourceRate: number, visibleRate: number): number {
  const targetRate = roundPenny(visibleRate * WEBSITE_PRICE_INCREASE);
  return sourceRate > 0
    ? Math.round((targetRate / sourceRate) * 1_000_000_000_000) / 1_000_000_000_000
    : WEBSITE_PRICE_INCREASE;
}

export function websitePriceFactors(
  source: WebsitePriceLadder,
  savedFactors?: WebsitePriceFactors,
  legacyQuietDeal?: number,
  visibleBaseline: WebsitePriceLadder = source,
): WebsitePriceFactors {
  const factors: WebsitePriceFactors = {};
  const discount = Number.isFinite(legacyQuietDeal)
    ? Math.max(0, Math.min(100, legacyQuietDeal!))
    : 0;

  for (const key of WEBSITE_PRICE_KEYS) {
    const sourceRate = source[key];
    if (sourceRate === undefined) continue;
    if (!Number.isFinite(sourceRate) || sourceRate < 0) throw new Error(`Invalid ${key} source price`);
    const saved = savedFactors?.[key];
    if (saved !== undefined && (!Number.isFinite(saved) || saved <= 0)) {
      throw new Error(`Invalid stored website ${key} price factor`);
    }
    const priorRate = visibleBaseline[key] ?? sourceRate;
    if (!Number.isFinite(priorRate) || priorRate < 0) throw new Error(`Invalid ${key} visible baseline`);
    const visibleRate = Math.round(priorRate * (1 - discount / 100));
    factors[key] = saved ?? factorFromVisibleRate(sourceRate, visibleRate);
  }

  return factors;
}

export function applyWebsitePriceFactors(
  source: WebsitePriceLadder,
  factors: WebsitePriceFactors,
): WebsitePriceLadder {
  const result: Partial<WebsitePriceLadder> = {};
  for (const key of WEBSITE_PRICE_KEYS) {
    const sourceRate = source[key];
    if (sourceRate === undefined) continue;
    const factor = factors[key];
    if (factor === undefined || !Number.isFinite(factor) || factor <= 0) {
      throw new Error(`Missing website price factor for ${key}`);
    }
    result[key] = roundPenny(sourceRate * factor);
  }
  return result as WebsitePriceLadder;
}
