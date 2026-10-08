/** Missing, retired or malformed physical stock cannot supply rental units. */
export function inventoryCapacity(unit: { active?: boolean; quantityOwned?: number } | null | undefined): number | null {
  const quantity = unit?.quantityOwned;
  if (!unit || unit.active === false || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 0) return null;
  return quantity;
}
