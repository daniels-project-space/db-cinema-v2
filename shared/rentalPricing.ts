/** Shared rental price ladder used by the storefront and server quotes. */
export type Pricing = {
  daily: number;
  day3?: number;
  day7?: number;
  day14?: number;
  day30?: number;
};

export type Tier = {
  days: number;
  label: string;
  total: number;
  perDay: number;
  discountPercent: number;
  synthetic: boolean;
};

export type Quote = {
  days: number;
  tier: Tier;
  perDay: number;
  total: number;
  dailyBaseline: number;
  saved: number;
  savedPct: number;
  discountPercent: number;
  ladder: Tier[];
  next: NextTier | null;
};

export type NextTier = {
  tier: Tier;
  daysToNext: number;
  total: number;
  perDay: number;
  saved: number;
  progress: number;
};

export const roundGbp = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const ceilWholeGbp = (value: number) => Math.ceil(roundGbp(value));

const SYNTH_DISCOUNT: Record<number, number> = {
  3: 0.1,
  7: 0.3,
  14: 0.35,
  30: 0.4,
};

const RUNGS: { days: number; label: string; key: keyof Pricing }[] = [
  { days: 1, label: "Daily", key: "daily" },
  { days: 3, label: "3-Day", key: "day3" },
  { days: 7, label: "Weekly", key: "day7" },
  { days: 14, label: "2-Week", key: "day14" },
  { days: 30, label: "Monthly", key: "day30" },
];

export function buildTiers(pricing: Pricing): Tier[] {
  const daily = Math.ceil(roundGbp(pricing.daily || 0));
  const tiers: Tier[] = [];
  for (const rung of RUNGS) {
    const discount = SYNTH_DISCOUNT[rung.days] ?? 0;
    const total = ceilWholeGbp(daily * rung.days * (1 - discount));
    const perDay = roundGbp(total / rung.days);
    const synthetic = rung.days !== 1;
    tiers.push({ days: rung.days, label: rung.label, total, perDay, discountPercent: Math.round(discount * 100), synthetic });
  }
  return tiers;
}

export function quote(pricing: Pricing, days: number): Quote {
  const ladder = buildTiers(pricing);
  const safeDays = Math.max(1, Math.floor(days || 1));
  let tier = ladder[0];
  for (const candidate of ladder) if (safeDays >= candidate.days) tier = candidate;

  const total = ceilWholeGbp(ladder[0].perDay * safeDays * (1 - tier.discountPercent / 100));
  const perDay = roundGbp(total / safeDays);
  const dailyBaseline = roundGbp(ladder[0].perDay * safeDays);
  const saved = roundGbp(Math.max(0, dailyBaseline - total));
  const savedPct = dailyBaseline > 0 ? Math.round((saved / dailyBaseline) * 100) : 0;

  const nextRung = ladder.find(candidate => candidate.days > safeDays) ?? null;
  let next: NextTier | null = null;
  if (nextRung) {
    const nextTotal = nextRung.total;
    const nextBaseline = roundGbp(ladder[0].perDay * nextRung.days);
    const span = nextRung.days - tier.days;
    next = {
      tier: nextRung,
      daysToNext: nextRung.days - safeDays,
      total: nextTotal,
      perDay: nextRung.perDay,
      saved: roundGbp(Math.max(0, nextBaseline - nextTotal)),
      progress: span > 0 ? Math.min(1, (safeDays - tier.days) / span) : 1,
    };
  }

  return { days: safeDays, tier, perDay, total, dailyBaseline, saved, savedPct, discountPercent: tier.discountPercent, ladder, next };
}
