// Membership tiers — core perk is % off every rental (higher tiers add free delivery).
export type MemberTier = {
  key: string;
  name: string;
  monthlyGbp: number;
  pct: number;
  freeDelivery: boolean;
  perks: string[];
};

export const TIERS: MemberTier[] = [
  {
    key: "plus",
    name: "Plus",
    monthlyGbp: 19,
    pct: 10,
    freeDelivery: false,
    perks: ["10% off every rental", "Member-only offers", "Priority support"],
  },
  {
    key: "pro",
    name: "Pro",
    monthlyGbp: 49,
    pct: 20,
    freeDelivery: true,
    perks: ["20% off every rental", "Free local delivery", "Priority availability"],
  },
  {
    key: "studio",
    name: "Studio",
    monthlyGbp: 99,
    pct: 30,
    freeDelivery: true,
    perks: ["30% off every rental", "Free local delivery", "For production teams", "Dedicated line"],
  },
];

export const tierByKey = (k?: string | null) => TIERS.find((t) => t.key === k);
export const tierPct = (k?: string | null) => tierByKey(k)?.pct ?? 0;
