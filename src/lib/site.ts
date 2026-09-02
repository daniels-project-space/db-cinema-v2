/** Single source of truth for brand/site facts that used to be scattered
 * as string literals across pages, prompts and metadata. Live business
 * settings (address, phone) still come from Convex `settings`. */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dbcinemarentals.com";
export const SITE_NAME = "Db Cinema Rentals";
export const AREA = "London, United Kingdom";

/** The public contact address. Convex keeps its own copy (it can't import from
 * src/) — see OWNER_EMAIL there; change both, or neither. */
export const CONTACT_EMAIL = "dbcinemarentals@gmail.com";

/** Pickup/return/delivery windows. Slots are derived from the windows. */
export const HOURS_WINDOWS: readonly { opens: string; closes: string }[] = [
  { opens: "09:00", closes: "22:00" },
];
export const HOURS_LABEL = "09:00–22:00, daily";
export const HOURS_SENTENCE = "09:00–22:00, every day";
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
