import { agreementRequestFingerprint } from "./rentalAgreement";

export function replacementStockFingerprint(stockInput: unknown, resolved: { basePricePence: number; allocation: unknown; componentNames?: unknown; physicalDemands: unknown; deliverySpec: unknown }) {
  return agreementRequestFingerprint({ stockInput, basePricePence: resolved.basePricePence, allocation: resolved.allocation, componentNames: resolved.componentNames, physicalDemands: resolved.physicalDemands, deliverySpec: resolved.deliverySpec });
}

export function replacementCatalogFingerprint(items: unknown, prices: any[]) {
  return agreementRequestFingerprint({ items, prices: prices.map(row => row ? { title: row.title, total: row.total, deposit: row.deposit, dailyRate: row.dailyRate, weekendSaving: row.weekendSaving, sizeScore: row.sizeScore, weightKg: row.weightKg, itemType: row.catalogItemType ?? "accessory" } : null) });
}
