export const WATERSTONES_MAP_URL = "https://www.google.com/maps/search/?api=1&query=Waterstones%20Trafalgar%20Square%2C%20The%20Grand%20Building%2C%20London%20WC2N%205EJ";

export function pickupMapAvailable(address: unknown): boolean {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().replace(/\s+/g, " ");
  return normalized.includes("grand building") && normalized.includes("trafalgar square") && /\bwc2n\s*5ej\b/i.test(normalized);
}
