export const TRAFALGAR_PICKUP_ADDRESS = "The Grand Building, Trafalgar Square, London, WC2N 5EJ";
export const TRAFALGAR_PICKUP_INSTRUCTIONS = "Please meet us at the confirmed time outside the Waterstones bookstore at Trafalgar Square.";
// Public checkout and signed pre-verification particulars disclose the area
// only. The exact address/instructions stay behind the paid + verified +
// confirmed handover gate.
export const TRAFALGAR_PICKUP_AREA = "Trafalgar Square";
export const LEO_SUPPORT_PHONE = "+44 7933 019849";

export function pickupMapAvailable(address: unknown): boolean {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().replace(/\s+/g, " ");
  return normalized.includes("grand building") && normalized.includes("trafalgar square") && /\bwc2n\s*5ej\b/i.test(normalized);
}
