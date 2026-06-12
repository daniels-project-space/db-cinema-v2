/** Single source of truth for brand/site facts that used to be scattered
 * as string literals across pages, prompts and metadata. Live business
 * settings (address, phone) still come from Convex `settings`. */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dbcinemarentals.com";
export const SITE_NAME = "Db Cinema Rentals";
export const AREA = "London, United Kingdom";

/** Pickup/return/delivery windows. Slots are derived from the windows. */
export const HOURS_WINDOWS: readonly { opens: string; closes: string }[] = [
  { opens: "10:00", closes: "12:00" },
  { opens: "19:00", closes: "21:00" },
];
export const HOURS_LABEL = "10:00–12:00 & 19:00–21:00, daily";
export const HOURS_SENTENCE = "10:00–12:00 and 19:00–21:00, every day";
export const PICKUP_SLOTS = HOURS_WINDOWS.flatMap(({ opens, closes }) => {
  const out: string[] = [];
  for (let h = Number(opens.slice(0, 2)); h <= Number(closes.slice(0, 2)); h++)
    out.push(`${String(h).padStart(2, "0")}:00`);
  return out;
});

export const BRANDS = [
  "SONY", "CANON", "RED", "BLACKMAGIC", "SIGMA",
  "DZOFILM", "APUTURE", "DJI", "SENNHEISER", "SMALLHD",
];
