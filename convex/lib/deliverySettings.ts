export function deliveryPricingSettings(row: any) {
  return { marginPct: row?.deliveryMarginPct ?? 10, maxKm: row?.deliveryMaxKm ?? 30 };
}
