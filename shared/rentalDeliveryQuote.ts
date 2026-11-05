export type DeliveryQuoteLeg = { oneWay: number; fee: number };
export const CHAT_DELIVERY_TERMS_VERSION = "2026-11-chat-delivery-v1";

export function deliveryQuoteTermsVersion(baseVersion: string) {
  return `${baseVersion}+${CHAT_DELIVERY_TERMS_VERSION}`;
}

export function rentalDeliveryBookingFingerprint(b: any) {
  return JSON.stringify({
    id: String(b._id),
    status: b.status,
    fulfilment: b.fulfilment,
    lineItems: b.lineItems.map((line: any) => ({ listingId: String(line.listingId), title: line.title, start: line.start, end: line.end, qty: line.qty })),
  });
}

export function deliveryAmountPence(legs: DeliveryQuoteLeg[], deliveryLegs: "one_way" | "round_trip", marginPct: number) {
  if (!legs.length || !Number.isFinite(marginPct) || marginPct < 0 || marginPct > 1000) throw Error("Delivery price is unavailable.");
  const amount = legs.reduce((sum, leg) => {
    if (!Number.isFinite(leg.oneWay) || leg.oneWay < 0 || !Number.isFinite(leg.fee) || leg.fee < 0) throw Error("Delivery price is unavailable.");
    const groupAmount = deliveryLegs === "round_trip" ? leg.fee : Math.round(leg.oneWay * (1 + marginPct / 100));
    return sum + Math.round(groupAmount * 100);
  }, 0);
  if (!Number.isSafeInteger(amount)) throw Error("Delivery price is unavailable.");
  return amount;
}

export function deliveryDiscountPence(amountPence: number, discountPct: number) {
  if (!Number.isSafeInteger(amountPence) || amountPence < 0 || !Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) throw Error("Delivery discount is invalid.");
  return Math.min(amountPence, Math.round(amountPence * discountPct / 100));
}

export function deliveryQuoteTerms(baseText: string, deliveryLegs: "one_way" | "round_trip") {
  const legs = deliveryLegs === "one_way"
    ? "This quote covers delivery to your address only. You must return the equipment at the agreed return time to The Grand Building, Trafalgar Square, London, WC2N 5EJ. Please meet us outside the Waterstones bookstore at Trafalgar Square at the confirmed time."
    : "This quote covers courier delivery to your address and courier collection at the agreed return time.";
  return `${baseText} ${legs}`;
}
