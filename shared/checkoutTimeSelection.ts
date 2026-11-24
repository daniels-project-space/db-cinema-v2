import { dayMs } from "../src/lib/dates";
import { rentalPricingDays } from "./rentalDuration";

export type SharedTimePair = { pickupTime: string; returnTime: string };
export type SharedTimeLine = {
  key: string;
  listingId: string;
  start: string;
  end: string;
  days: number;
  perDay: number;
  total: number;
  pickupTime?: string;
  returnTime?: string;
  offerType?: string;
  [key: string]: unknown;
};

export function selectSharedTimePair(pairs: SharedTimePair[], pickupTime?: string, returnTime?: string, prefer: "pickup" | "return" = "pickup"): SharedTimePair | null {
  if (!pairs.length) return null;
  if (pickupTime && returnTime) {
    const exact = pairs.find(pair => pair.pickupTime === pickupTime && pair.returnTime === returnTime);
    if (exact) return exact;
  }
  if (prefer === "pickup" && pickupTime) {
    const matchingPickup = pairs.find(pair => pair.pickupTime === pickupTime);
    if (matchingPickup) return matchingPickup;
  }
  if (prefer === "return" && returnTime) {
    const matchingReturn = pairs.find(pair => pair.returnTime === returnTime);
    if (matchingReturn) return matchingReturn;
  }
  if (pickupTime) {
    const matchingPickup = pairs.find(pair => pair.pickupTime === pickupTime);
    if (matchingPickup) return matchingPickup;
  }
  if (returnTime) {
    const matchingReturn = pairs.find(pair => pair.returnTime === returnTime);
    if (matchingReturn) return matchingReturn;
  }
  return pairs[0];
}

export function applySharedTimePair<T extends SharedTimeLine>(items: T[], totals: number[], pickupTime: string, returnTime: string): T[] {
  if (!items.length || totals.length !== items.length) throw new Error("Your kit changed while checking times. Refresh and try again.");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(pickupTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(returnTime)) throw new Error("Choose valid collection times for your kit.");
  const keys = new Set<string>();
  return items.map((item, index) => {
    const total = totals[index];
    if (!Number.isFinite(total) || total < 0) throw new Error("The updated price could not be verified. Please try again.");
    const days = rentalPricingDays(dayMs(item.start), dayMs(item.end), pickupTime, returnTime);
    const baseKey = `${item.listingId}|${item.start}|${days}|${item.offerType ?? ""}|${pickupTime}|${returnTime}`;
    let key = baseKey, suffix = 1;
    while (keys.has(key)) key = `${baseKey}|${suffix++}`;
    keys.add(key);
    return { ...item, key, pickupTime, returnTime, days, total, perDay: Math.round(total / days * 100) / 100 };
  });
}
