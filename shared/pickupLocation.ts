export const TRAFALGAR_PICKUP_ADDRESS = "The Grand Building, Trafalgar Square, London, WC2N 5EJ";
export const TRAFALGAR_PICKUP_INSTRUCTIONS = "Please meet us at the confirmed time outside the Waterstones bookstore at Trafalgar Square.";
// Public checkout and signed pre-verification particulars disclose the area
// only. The exact address/instructions stay behind the paid + verified +
// confirmed handover gate.
export const TRAFALGAR_PICKUP_AREA = "Trafalgar Square";
export const LEO_SUPPORT_PHONE = "+44 7933 019849";

export function gafferPickupDisclosureInstruction(pickupArea: unknown, exactAddress: unknown): string {
  const area = typeof pickupArea === "string" && pickupArea.trim() ? pickupArea.trim() : TRAFALGAR_PICKUP_AREA;
  const exact = typeof exactAddress === "string" ? exactAddress.replace(/[\r\n\u0000-\u001f]+/g, " ").trim() : "";
  if (!exact) {
    return `Public pickup area: in ${area}. You may share this general area before a booking is paid, verified and confirmed. Until all three gates pass, do not disclose any exact address, postcode, specific meeting landmark, directions link or contact number; say the exact meeting point follows payment, verification and booking confirmation.`;
  }
  return `Public pickup area: in ${area}. This rental has passed payment, verification and booking confirmation. Its exact pickup details are: ${exact}. Share them only for this renter's own rental when relevant; never disclose a home or delivery address.`;
}

export function redactPickupDisclosureText(value: unknown, privateAddress?: unknown): string {
  if (typeof value !== "string") return "";
  let safe = value
    .replace(/\s*Location:\s*[^\n]*/gi, " Exact pickup details will appear after payment, verification and booking confirmation.")
    .replace(/(?:pickup|return|delivery|collection|meeting)\s+(?:address|location|point|instructions?)\s*:\s*[^\n\r]+/gi, "[Exact handover details hidden until the rental is ready]")
    .replace(/https:\/\/www\.google\.com\/maps\/search\/[^\s)]+/gi, "[Pickup directions hidden until the rental is ready]")
    .replace(/(?:(?:\+?44|0044)[\s().-]*(?:\(0\)|0)?|0)[\s().-]*7933[\s().-]*019849/gi, "[Support number hidden until the rental is ready]")
    .replace(/(?:please\s+)?meet(?:ing)?\s+(?:us\s+)?(?:at|outside)\s+(?:the\s+)?waterstones[^.!?\n]*(?:[.!?]?)/gi, "[Exact meeting instructions hidden until the rental is ready]")
    .replace(/\bwaterstones\b/gi, "[Exact meeting landmark hidden until the rental is ready]")
    .replace(/\b(?:the\s+)?grand\s+building\b/gi, "[Exact pickup address hidden until the rental is ready]")
    .replace(/\bwc2n\s*5ej\b/gi, "[Exact postcode hidden until the rental is ready]");
  for (const address of [TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS, privateAddress]) {
    if (typeof address !== "string" || !address.trim()) continue;
    const pattern = address.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    safe = safe.replace(new RegExp(pattern, "gi"), "[Exact handover details hidden until the rental is ready]");
  }
  return safe.trim();
}

export function pickupMapAvailable(address: unknown): boolean {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().replace(/\s+/g, " ");
  return normalized.includes("grand building") && normalized.includes("trafalgar square") && /\bwc2n\s*5ej\b/i.test(normalized);
}
