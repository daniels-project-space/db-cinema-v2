import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Origin: 23 Whitcomb Street WC2H 7ER (Trafalgar Square) — v1 delivery base.
const ORIGIN = { lat: 51.5095, lng: -0.1283 };

// v1 zone pricing (one-way £ bands), max 30km. [lo, hi] per vehicle.
const ZONES: { max: number; motorcycle: [number, number]; car: [number, number]; van: [number, number] }[] = [
  { max: 3, motorcycle: [15, 20], car: [21, 27], van: [45, 65] },
  { max: 5, motorcycle: [20, 27], car: [27, 37], van: [55, 75] },
  { max: 10, motorcycle: [28, 38], car: [38, 52], van: [70, 95] },
  { max: 15, motorcycle: [35, 48], car: [48, 65], van: [80, 105] },
  { max: 20, motorcycle: [42, 55], car: [57, 75], van: [90, 115] },
  { max: 30, motorcycle: [50, 68], car: [68, 93], van: [105, 140] },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const specsFor = internalQuery({
  args: { ids: v.array(v.id("listings")) },
  handler: async (ctx, { ids }) => {
    const out = [];
    for (const id of ids) {
      const l = await ctx.db.get(id);
      if (l) out.push({ sizeScore: l.sizeScore ?? 2, weightKg: l.weightKg ?? 1, itemType: l.itemType ?? "accessory" });
    }
    return out;
  },
});

export const quote = action({
  args: { postcode: v.string(), listingIds: v.array(v.id("listings")) },
  handler: async (
    ctx,
    { postcode, listingIds },
  ): Promise<
    | { ok: true; fee: number; vehicle: string; km: number }
    | { ok: false; reason: string }
  > => {
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

    const km = haversineKm(ORIGIN, { lat: res.latitude, lng: res.longitude });
    if (km > 30)
      return {
        ok: false,
        reason: `That's ~${Math.round(km)}km from us — beyond our 30km delivery range. Please choose pickup.`,
      };

    const specs: any[] = await ctx.runQuery(internal.delivery.specsFor, { ids: listingIds });
    const maxScore = Math.max(1, ...specs.map((s) => s.sizeScore));
    const totalWeight = specs.reduce((n, s) => n + s.weightKg, 0);
    const heavyLarge = specs.filter((s) => s.sizeScore >= 4 || s.weightKg >= 5).length;
    const hasDJ = specs.some((s) => s.itemType === "dj-deck");
    const hasSpeaker = specs.some((s) => s.itemType === "speaker");

    let vehicle: "motorcycle" | "car" | "van";
    if ((hasDJ && hasSpeaker) || heavyLarge >= 3) vehicle = "van";
    else if (specs.length <= 2 && maxScore <= 3 && totalWeight <= 4) vehicle = "motorcycle";
    else vehicle = "car";

    const zone = ZONES.find((z) => km <= z.max)!;
    const band = zone[vehicle];
    const mid = (band[0] + band[1]) / 2;
    const fee = Math.round(mid * 1.1); // +10% margin

    return { ok: true, fee, vehicle, km: Math.round(km * 10) / 10 };
  },
});
