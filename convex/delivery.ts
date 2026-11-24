import { action, internalAction, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Delivery-zone pricing starts from the agreed Trafalgar Square collection area.
// These coordinates are a pricing origin, not a promise of a precise meeting pin.
const ORIGIN = { lat: 51.5095, lng: -0.1281 };
const MAX_KM = 30;

// v1 zone × vehicle ONE-WAY bands (£ min/max).
const PRICING: Record<string, [number, number][]> = {
  // index by zone: 0:core 1:central 2:inner 3:mid 4:outer 5:greater
  motorcycle: [[15, 20], [20, 27], [28, 38], [35, 48], [42, 55], [50, 68]],
  car: [[21, 28], [28, 38], [39, 53], [49, 67], [59, 77], [70, 95]],
  van: [[45, 65], [55, 75], [70, 95], [80, 105], [90, 115], [105, 140]],
};
const ZONE_MAX = [3, 5, 10, 15, 20, 30];
// load span per vehicle for interpolating WITHIN the band (light→full)
const LOAD_SPAN: Record<string, [number, number]> = {
  motorcycle: [1, 6],
  car: [3, 16],
  van: [8, 42],
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function priceDeliveryLoad(groupSpecs: { sizeScore: number; weightKg: number; itemType: string }[], zoneIdx: number, marginPct: number) {
  if (!groupSpecs.length || !Number.isSafeInteger(zoneIdx) || zoneIdx < 0 || zoneIdx >= ZONE_MAX.length || !Number.isFinite(marginPct) ||
      groupSpecs.some(spec => !Number.isFinite(spec.sizeScore) || spec.sizeScore < 0 || !Number.isFinite(spec.weightKg) || spec.weightKg < 0))
    throw Error("Delivery equipment details need a fresh check.");
  const totalScore = groupSpecs.reduce((n, spec) => n + spec.sizeScore, 0);
  const totalWeight = groupSpecs.reduce((n, spec) => n + spec.weightKg, 0);
  const maxScore = Math.max(1, ...groupSpecs.map(spec => spec.sizeScore));
  const bigItems = groupSpecs.filter(spec => spec.sizeScore >= 4 || spec.weightKg >= 5).length;
  const hasDJ = groupSpecs.some(spec => spec.itemType === "dj-deck");
  const hasSpeaker = groupSpecs.some(spec => spec.itemType === "speaker");
  const vehicle = (hasDJ && hasSpeaker) || bigItems >= 2 || totalWeight > 20 || totalScore >= 10 ? "van"
    : maxScore <= 2 && bigItems === 0 && totalWeight <= 8 && groupSpecs.length <= 3 ? "motorcycle" : "car";
  const vehicleLabel = vehicle === "van" ? "Large van" : vehicle === "car" ? "Small car courier" : "Motorcycle courier";
  const [lo, hi] = PRICING[vehicle][zoneIdx];
  const load = totalScore + totalWeight * 0.25;
  const [ls, le] = LOAD_SPAN[vehicle];
  const oneWay = Math.round(lo + (hi - lo) * clamp01((load - ls) / (le - ls)));
  const margin = 1 + marginPct / 100;
  return { oneWay, oneWayFee: Math.round(oneWay * margin), roundTripFee: Math.round(oneWay * 2 * margin), vehicle, vehicleLabel, load: Math.round(load) };
}

export const specsFor = internalQuery({
  args: { ids: v.array(v.id("listings")) },
  handler: async (ctx, { ids }) => {
    const out = [];
    for (const id of ids) {
      const l = await ctx.db.get(id);
      if (l)
        out.push({
          listingId: l._id,
          sizeScore: l.sizeScore ?? 2,
          weightKg: l.weightKg ?? 1,
          itemType: l.itemType ?? "accessory",
        });
    }
    return out;
  },
});

const deliveryArgs = { postcode: v.string(), groups: v.array(v.object({ start: v.number(), end: v.number(), listingIds: v.array(v.id("listings")) })), deliveryLegs: v.optional(v.union(v.literal("one_way"), v.literal("round_trip"))) };

async function quoteDelivery(
    ctx: any,
    { postcode, groups, deliveryLegs = "round_trip" }: { postcode: string; groups: { start: number; end: number; listingIds: Id<"listings">[] }[]; deliveryLegs?: "one_way" | "round_trip" },
    overrides: {groupIndex:number;itemIndex:number;sizeScore:number;weightKg:number;itemType:string}[] = [],
  ): Promise<
    | { ok: true; fee: number; deliveryLegs: "one_way" | "round_trip"; oneWay: number; vehicle: string; vehicleLabel: string; km: number; load: number; isLondon: boolean; pricingSettings: {marginPct:number;maxKm:number}; groups: Array<{ start: number; end: number; fee: number; oneWayFee: number; roundTripFee: number; oneWay: number; vehicle: string; vehicleLabel: string; km: number; load: number }> }
    | { ok: false; reason: string }
  > {
    if (!groups.length || groups.some(group => !group.listingIds.length || group.end < group.start))
      return { ok: false, reason: "Add valid rental dates and equipment before quoting delivery." };
    const pc = postcode.replace(/\s+/g, "").toUpperCase();
    if (pc.length < 5) return { ok: false, reason: "Enter a full UK postcode" };
    let res: any;
    try {
      const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      if (!r.ok) return { ok: false, reason: "We couldn't find that postcode" };
      res = (await r.json())?.result;
    } catch {
      return { ok: false, reason: "Postcode lookup failed, try again" };
    }
    if (!res?.latitude) return { ok: false, reason: "We couldn't find that postcode" };

    const cfg: any = await ctx.runQuery(api.settings.get, {});
    const maxKm = cfg.deliveryMaxKm ?? MAX_KM;
    const km = haversineKm(ORIGIN, { lat: res.latitude, lng: res.longitude });
    if (km > maxKm)
      return {
        ok: false,
        reason: `That's ~${Math.round(km)}km from us — beyond our ${maxKm}km delivery range. Please choose pickup.`,
      };

    const ids = [...new Set(groups.flatMap(group => group.listingIds))];
    const specs: any[] = await ctx.runQuery(internal.delivery.specsFor, { ids });
    const specsById = new Map(specs.map(spec => [String(spec.listingId), spec]));
    if (specsById.size !== ids.length) return { ok: false, reason: "We couldn't calculate delivery for every item. Please refresh your basket." };
    const zoneIdx = ZONE_MAX.findIndex((m) => km <= m);
    if (zoneIdx < 0) return { ok: false, reason: "Delivery is outside the available pricing zones. Please choose pickup." };

    if (overrides.length > 100 || overrides.some(row => !Number.isSafeInteger(row.groupIndex) || !Number.isSafeInteger(row.itemIndex) || row.groupIndex < 0 || row.itemIndex < 0 || row.groupIndex >= groups.length || row.itemIndex >= groups[row.groupIndex].listingIds.length) ||
        new Set(overrides.map(row => `${row.groupIndex}:${row.itemIndex}`)).size !== overrides.length)
      return { ok: false, reason: "Delivery equipment details need a fresh check." };
    const pricedGroups = groups.map((group, groupIndex) => {
      const groupSpecs = group.listingIds.map((id, itemIndex) => overrides.find(row => row.groupIndex === groupIndex && row.itemIndex === itemIndex) ?? specsById.get(String(id))!);
      const {oneWay, oneWayFee, roundTripFee, vehicle, vehicleLabel, load} = priceDeliveryLoad(groupSpecs, zoneIdx, cfg.deliveryMarginPct ?? 10);
      const fee = deliveryLegs === "one_way" ? oneWayFee : roundTripFee;
      return { start: group.start, end: group.end, fee, oneWayFee, roundTripFee, oneWay, vehicle, vehicleLabel, km: Math.round(km * 10) / 10, load };
    });
    const first = pricedGroups[0];
    return {
      ok: true,
      fee: pricedGroups.reduce((total, group) => total + group.fee, 0),
      deliveryLegs,
      oneWay: first.oneWay,
      vehicle: first.vehicle,
      vehicleLabel: first.vehicleLabel,
      isLondon: res.region === "London",
      pricingSettings: { marginPct: cfg.deliveryMarginPct ?? 10, maxKm },
      km: first.km,
      load: first.load,
      groups: pricedGroups,
    };
}

export const quote = action({
  args: deliveryArgs,
  handler: (ctx, args) => quoteDelivery(ctx, args),
});

export const quoteResolved = internalAction({
  args: { ...deliveryArgs, overrides: v.array(v.object({ groupIndex: v.number(), itemIndex: v.number(), sizeScore: v.number(), weightKg: v.number(), itemType: v.string() })) },
  handler: (ctx, { overrides, ...args }) => quoteDelivery(ctx, args, overrides),
});
