/**
 * Multi-day rental pricing engine.
 *
 * Hygglo supplies per-day rates at 1 / 3 / 7 / 30 days. We expose a 5-rung
 * ladder — Daily · 3-Day · Weekly · 2-Week · Monthly — synthesising any missing
 * rung (typically the 14-day) with a discount off the daily rate, then clamping
 * so each longer tier is always cheaper per-day than the shorter one (a ladder
 * that never inverts). The best tier for the chosen duration is auto-applied.
 */

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
  perDay: number;
  synthetic: boolean;
};

export type Quote = {
  days: number;
  tier: Tier;
  perDay: number;
  total: number;
  dailyBaseline: number; // days × daily rate (the "no discount" cost)
  saved: number; // dailyBaseline − total
  savedPct: number;
  ladder: Tier[];
  next: NextTier | null;
};

export type NextTier = {
  tier: Tier;
  daysToNext: number;
  total: number; // cost at the next tier's day count
  perDay: number;
  saved: number; // saved vs daily baseline at that day count
  progress: number; // 0..1 between current tier threshold and next
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => Math.round(n); // whole-pound display

// fallback discounts off the daily rate when a rung isn't supplied by Hygglo
const SYNTH_DISCOUNT: Record<number, number> = {
  3: 0.1,
  7: 0.18,
  14: 0.27,
  30: 0.38,
};

const RUNGS: { days: number; label: string; key: keyof Pricing }[] = [
  { days: 1, label: "Daily", key: "daily" },
  { days: 3, label: "3-Day", key: "day3" },
  { days: 7, label: "Weekly", key: "day7" },
  { days: 14, label: "2-Week", key: "day14" },
  { days: 30, label: "Monthly", key: "day30" },
];

export function buildTiers(p: Pricing): Tier[] {
  const daily = p.daily || 0;
  const tiers: Tier[] = [];
  let prev = Infinity;
  for (const rung of RUNGS) {
    const raw = p[rung.key];
    let perDay: number;
    let synthetic = false;
    if (typeof raw === "number" && raw > 0) {
      perDay = raw;
    } else if (rung.days === 1) {
      perDay = daily;
    } else {
      perDay = daily * (1 - (SYNTH_DISCOUNT[rung.days] ?? 0));
      synthetic = true;
    }
    // never more expensive per-day than a shorter tier; synthetic rungs must be
    // at least 1% cheaper so the ladder visibly progresses
    if (perDay > prev) perDay = prev;
    if (rung.days !== 1) perDay = Math.min(perDay, prev * 0.99);
    perDay = round2(perDay);
    tiers.push({ days: rung.days, label: rung.label, perDay, synthetic });
    prev = perDay;
  }
  return tiers;
}

export function quote(p: Pricing, days: number): Quote {
  const ladder = buildTiers(p);
  const safeDays = Math.max(1, Math.floor(days || 1));

  let tier = ladder[0];
  for (const t of ladder) if (safeDays >= t.days) tier = t;

  const perDay = tier.perDay;
  const total = money(perDay * safeDays);
  const dailyBaseline = money(ladder[0].perDay * safeDays);
  const saved = Math.max(0, dailyBaseline - total);
  const savedPct = dailyBaseline > 0 ? Math.round((saved / dailyBaseline) * 100) : 0;

  const nextRung = ladder.find((t) => t.days > safeDays) ?? null;
  let next: NextTier | null = null;
  if (nextRung) {
    const nTotal = money(nextRung.perDay * nextRung.days);
    const nBaseline = money(ladder[0].perDay * nextRung.days);
    const span = nextRung.days - tier.days;
    next = {
      tier: nextRung,
      daysToNext: nextRung.days - safeDays,
      total: nTotal,
      perDay: nextRung.perDay,
      saved: Math.max(0, nBaseline - nTotal),
      progress: span > 0 ? Math.min(1, (safeDays - tier.days) / span) : 1,
    };
  }

  return {
    days: safeDays,
    tier,
    perDay,
    total,
    dailyBaseline,
    saved,
    savedPct,
    ladder,
    next,
  };
}

// ── Protection model: ID+insurance (small damage hold) vs full deposit ──
export type Protection = "verify" | "deposit";

export function smallDamageHold(replacementSum: number): number {
  return Math.max(50, Math.min(200, Math.round(replacementSum * 0.05)));
}

export function depositFor(protection: Protection, replacementSum: number): number {
  return protection === "deposit" ? replacementSum : smallDamageHold(replacementSum);
}

export const PROTECTION_LABEL: Record<Protection, string> = {
  verify: "Refundable damage hold (covers minor damage)",
  deposit: "Refundable security deposit",
};
