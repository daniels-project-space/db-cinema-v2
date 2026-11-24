import { equipmentModelTokens, equipmentModelsMatch } from "./equipmentIdentity";
import { alreadySupplied, rentableCandidate, type RecommendationItem } from "./recommendationPolicy";

export const CHECKOUT_ACCESSORY_OFFER = "checkout-accessory-v1";
export const CHECKOUT_ACCESSORY_OFFER_LIMIT = 3;
export const CHECKOUT_ACCESSORY_MINIMUM_BASKET = 150;
export const CHECKOUT_ACCESSORY_MAXIMUM_BASKET = 400;

const OFFERABLE_TYPES = new Set(["accessory"]);

export type CheckoutAccessoryListing = RecommendationItem & {
  _id?: string;
  listingId?: string;
  slug?: string;
  title?: string;
  itemType?: string | null;
  catalogItemType?: string | null;
  components?: { inventoryUnitId: string; qty: number }[];
};

export function checkoutAccessoryPercent(basketValue: number): number | null {
  if (!Number.isFinite(basketValue) || basketValue < CHECKOUT_ACCESSORY_MINIMUM_BASKET ||
      !Number.isSafeInteger(Math.round(basketValue * 100))) return null;
  const basketPence = Math.round(basketValue * 100);
  if (basketPence >= 35_000) return 50;
  if (basketPence >= 25_000) return 40;
  return 30;
}

export function isCheckoutAccessory(listing: CheckoutAccessoryListing): boolean {
  const declaredType = listing.catalogItemType !== undefined ? listing.catalogItemType : listing.itemType;
  return OFFERABLE_TYPES.has(declaredType ?? "");
}

export function checkoutAccessoryCompatible(
  candidate: CheckoutAccessoryListing,
  basket: CheckoutAccessoryListing[],
  evidence: RecommendationItem[] = [],
): boolean {
  if (!isCheckoutAccessory(candidate)) return false;
  const compatibleTargets = basket.filter(item => item.itemType === "camera-body" || item.itemType === "lens");
  return compatibleTargets.some(item =>
    !!item.title && !!candidate.title && equipmentModelTokens(item.title).length > 0 && equipmentModelsMatch(item.title, candidate.title) ||
    sharesVerifiedKitComponents(candidate.components, item.components, evidence),
  );
}

function sharesVerifiedKitComponents(
  candidateComponents: CheckoutAccessoryListing["components"],
  targetComponents: CheckoutAccessoryListing["components"],
  evidence: RecommendationItem[],
): boolean {
  if (!candidateComponents?.length || !targetComponents?.length) return false;
  const componentsCovered = (required: NonNullable<CheckoutAccessoryListing["components"]>,
    kit: NonNullable<RecommendationItem["components"]>) => {
    const quantities = new Map<string, number>();
    for (const component of kit) {
      if (!component.inventoryUnitId || !Number.isSafeInteger(component.qty) || component.qty < 1) continue;
      quantities.set(component.inventoryUnitId, (quantities.get(component.inventoryUnitId) ?? 0) + component.qty);
    }
    return required.every(component => !!component.inventoryUnitId && Number.isSafeInteger(component.qty) && component.qty > 0 &&
      (quantities.get(component.inventoryUnitId) ?? 0) >= component.qty);
  };
  return evidence.some(kit => !!kit.components?.length &&
    componentsCovered(candidateComponents, kit.components) && componentsCovered(targetComponents, kit.components));
}

export function checkoutAccessoryWindowMatches(
  candidate: { start: number; end: number; pickupTime?: string; returnTime?: string },
  compatibleBaseItems: { start: number; end: number; pickupTime?: string; returnTime?: string }[],
): boolean {
  return compatibleBaseItems.some(item => item.start === candidate.start && item.end === candidate.end &&
    item.pickupTime === candidate.pickupTime && item.returnTime === candidate.returnTime);
}

export function checkoutAccessoryTotals(originalTotal: number, percent: number) {
  if (!Number.isSafeInteger(Math.round(originalTotal * 100)) || originalTotal < 0 ||
      !Number.isSafeInteger(percent) || percent < 30 || percent > 50)
    throw new Error("Invalid checkout accessory offer.");
  const originalPence = Math.round(originalTotal * 100);
  const savingPence = Math.min(originalPence, Math.round(originalPence * percent / 100));
  return { originalTotal: originalPence / 100, saving: savingPence / 100, total: (originalPence - savingPence) / 100 };
}

export function validateCheckoutAccessoryOfferSet(
  items: { listingId: string; start: number; end: number; pickupTime?: string; returnTime?: string; offerType?: string }[],
  canonical: (CheckoutAccessoryListing & { total: number })[],
  evidence: RecommendationItem[] = [],
) {
  const offerIndexes = items.flatMap((item, index) => item.offerType === CHECKOUT_ACCESSORY_OFFER ? [index] : []);
  if (offerIndexes.length > CHECKOUT_ACCESSORY_OFFER_LIMIT) throw new Error("Choose up to three checkout accessories.");
  if (!offerIndexes.length) return { offerIndexes, baseSubtotal: canonical.reduce((sum, row) => sum + row.total, 0), percent: null, savings: new Map<number, number>() };
  if (canonical.length !== items.length) throw new Error("Refresh your basket before applying the accessory offer.");

  const offerIndexSet = new Set(offerIndexes);
  const baseLines = items.flatMap((item, index) => offerIndexSet.has(index) ? [] : [{ item, listing: canonical[index] }]);
  const baseSubtotal = baseLines.reduce((sum, row) => sum + row.listing.total, 0);
  const percent = checkoutAccessoryPercent(baseSubtotal);
  if (!baseLines.length || percent === null)
    throw new Error("Checkout accessories need at least £150 of compatible equipment in your basket.");

  const seenListings = new Set<string>();
  const savings = new Map<number, number>();
  for (const index of offerIndexes) {
    const item = items[index];
    const candidate = canonical[index];
    const listingId = String(item.listingId);
    if (seenListings.has(listingId) || !isCheckoutAccessory(candidate) || !rentableCandidate(candidate) ||
        candidate.marketingOnly || candidate.displayOnly ||
        (candidate.stockMappingStatus !== undefined && candidate.stockMappingStatus !== "complete") ||
        baseLines.some(row => String(row.item.listingId) === listingId) || alreadySupplied(candidate, baseLines.map(row => row.listing)))
      throw new Error("One of the selected accessories no longer qualifies. Remove it and choose a checked offer.");
    seenListings.add(listingId);

    const compatibleBaseLines = baseLines.filter(row => checkoutAccessoryCompatible(candidate, [row.listing], evidence));
    if (!checkoutAccessoryWindowMatches(item, compatibleBaseLines.map(row => row.item)))
      throw new Error("A selected accessory does not match the equipment or rental times in your basket.");
    savings.set(index, checkoutAccessoryTotals(candidate.total, percent).saving);
  }
  return { offerIndexes, baseSubtotal, percent, savings };
}
