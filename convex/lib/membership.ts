// Membership tiers.
//  - % off every rental (core perk, all tiers)
//  - 2 free accessories / month (all tiers, incl Plus)
//  - free delivery + EXCLUSIVE member offers (Pro & Studio only)
export type MemberTier = {
  key: string;
  name: string;
  monthlyGbp: number;
  pct: number;
  freeDelivery: boolean;
  freeAccessories: number; // free accessory rentals per calendar month
  exclusiveOffers: boolean; // access to the gold member-only offers
  perks: string[];
};

export const FREE_ACCESSORY_TYPES = ["tripod", "gimbal", "nd-filter", "battery"];

// tier ordering for "Pro and up" gating
export const TIER_RANK: Record<string, number> = { plus: 1, pro: 2, studio: 3 };
export const isProPlus = (tier?: string | null, active?: boolean) =>
  !!active && (TIER_RANK[tier ?? ""] ?? 0) >= TIER_RANK.pro;

export const TIERS: MemberTier[] = [
  {
    key: "plus",
    name: "Plus",
    monthlyGbp: 19,
    pct: 10,
    freeDelivery: false,
    freeAccessories: 0,
    exclusiveOffers: false,
    perks: ["10% off every rental", "Member-only rates", "Priority support"],
  },
  {
    key: "pro",
    name: "Pro",
    monthlyGbp: 49,
    pct: 20,
    freeDelivery: false,
    freeAccessories: 1,
    exclusiveOffers: true,
    perks: [
      "20% off every rental",
      "1 free accessory / month",
      "Exclusive member offers",
      "Priority availability",
    ],
  },
  {
    key: "studio",
    name: "Studio",
    monthlyGbp: 99,
    pct: 30,
    freeDelivery: true,
    freeAccessories: 2,
    exclusiveOffers: true,
    perks: [
      "30% off every rental",
      "2 free accessories / month",
      "Free local delivery",
      "Exclusive member offers",
      "For production teams",
      "Dedicated line",
    ],
  },
];

export const tierByKey = (k?: string | null) => TIERS.find((t) => t.key === k);
export const tierPct = (k?: string | null) => tierByKey(k)?.pct ?? 0;

// Rows for the comparison chart (true / number / false per tier).
export const BENEFITS: { label: string; get: (t: MemberTier) => boolean | string }[] = [
  { label: "Discount on every rental", get: (t) => `${t.pct}%` },
  { label: "Free accessories / month", get: (t) => (t.freeAccessories ? `${t.freeAccessories}` : false) },
  { label: "Free local delivery", get: (t) => t.freeDelivery },
  { label: "Exclusive member offers", get: (t) => t.exclusiveOffers },
  { label: "Priority availability", get: (t) => t.key !== "plus" },
  { label: "Priority / dedicated support", get: (t) => true },
];
