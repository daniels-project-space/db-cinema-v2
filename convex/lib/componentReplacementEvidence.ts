type SourceComponent = { masterItemId: string; qty: number };

export function validatedComponentReplacementEvidence(value: any, components: SourceComponent[]) {
  if (!value || value.version !== 1 || value.checkoutAvailable !== false || !Array.isArray(value.reviewedSubstitutions) || value.reviewedSubstitutions.length > 25) return undefined;
  const quantities = new Map<string, number>();
  for (const component of components) {
    if (typeof component.masterItemId !== "string" || !component.masterItemId || !Number.isSafeInteger(component.qty) || component.qty < 1) return undefined;
    const total = (quantities.get(component.masterItemId) ?? 0) + component.qty;
    if (!Number.isSafeInteger(total)) return undefined;
    quantities.set(component.masterItemId, total);
  }
  const pairs = new Set<string>();
  for (const rule of value.reviewedSubstitutions) {
    const missing = rule?.declaredMissingOriginal;
    const declared = missing && /^declared:[a-z0-9][a-z0-9_-]{0,100}$/.test(missing.descriptorId) && missing.descriptorId === rule.originalMasterItemId &&
      typeof missing.label === "string" && missing.label.trim().length > 1 && missing.label.length <= 200 && Number.isSafeInteger(missing.quantityPerKit) && missing.quantityPerKit === rule.quantityPerKit &&
      typeof missing.sourceUrl === "string" && /^https:\/\/[^\s]+$/i.test(missing.sourceUrl) && missing.sourceUrl.length <= 1000 && typeof missing.sourceExcerpt === "string" && missing.sourceExcerpt.trim().length >= 10 && missing.sourceExcerpt.length <= 1000 && !quantities.has(missing.descriptorId);
    if (!rule || typeof rule.originalMasterItemId !== "string" || typeof rule.replacementMasterItemId !== "string" || !rule.replacementMasterItemId || rule.originalMasterItemId === rule.replacementMasterItemId ||
        !Number.isSafeInteger(rule.quantityPerKit) || rule.quantityPerKit < 1 || (missing ? !declared : rule.quantityPerKit > (quantities.get(rule.originalMasterItemId) ?? 0)) ||
        !Number.isSafeInteger(rule.priceAdjustmentPence) || (rule.extensionAdjustmentPence !== undefined && (!Array.isArray(rule.extensionAdjustmentPence) || rule.extensionAdjustmentPence.length !== 30 || rule.extensionAdjustmentPence.some((amount: any) => !Number.isSafeInteger(amount) || Math.abs(amount) > 100000000))) || !Number.isSafeInteger(rule.replacementSizeScore) || rule.replacementSizeScore < 1 || rule.replacementSizeScore > 5 || !Number.isSafeInteger(rule.reviewedAt) || rule.reviewedAt < 1 || !Array.isArray(rule.weights) ||
        rule.replacementInventory?.masterItemId !== rule.replacementMasterItemId || rule.replacementInventory?.active !== true ||
        !Number.isSafeInteger(rule.replacementInventory?.quantityOwned) || rule.replacementInventory.quantityOwned < rule.quantityPerKit ||
        !Number.isFinite(rule.replacementInventory?.replacementCost) || rule.replacementInventory.replacementCost <= 0) return undefined;
    const key = JSON.stringify([rule.originalMasterItemId, rule.replacementMasterItemId]);
    if (pairs.has(key)) return undefined;
    pairs.add(key);
    const required = new Set([...quantities.keys(), rule.replacementMasterItemId]);
    if (rule.weights.length !== required.size || new Set(rule.weights.map((weight: any) => weight?.masterItemId)).size !== required.size ||
        rule.weights.some((weight: any) => !required.has(weight?.masterItemId) || !Number.isSafeInteger(weight.weightGrams) || weight.weightGrams < 1)) return undefined;
  }
  return { version: 1 as const, checkoutAvailable: false as const, reviewedSubstitutions: value.reviewedSubstitutions.map((rule: any) => ({
    originalMasterItemId: rule.originalMasterItemId, replacementMasterItemId: rule.replacementMasterItemId,
    ...(rule.declaredMissingOriginal ? { declaredMissingOriginal: { descriptorId: rule.declaredMissingOriginal.descriptorId, label: rule.declaredMissingOriginal.label, quantityPerKit: rule.declaredMissingOriginal.quantityPerKit, sourceUrl: rule.declaredMissingOriginal.sourceUrl, sourceExcerpt: rule.declaredMissingOriginal.sourceExcerpt } } : {}),
    quantityPerKit: rule.quantityPerKit, priceAdjustmentPence: rule.priceAdjustmentPence, replacementSizeScore: rule.replacementSizeScore, reviewedAt: rule.reviewedAt,
    ...(rule.extensionAdjustmentPence ? { extensionAdjustmentPence: rule.extensionAdjustmentPence } : {}),
    replacementInventory: { masterItemId: rule.replacementInventory.masterItemId, active: true as const, quantityOwned: rule.replacementInventory.quantityOwned, replacementCost: rule.replacementInventory.replacementCost },
    weights: rule.weights.map((weight: any) => ({ masterItemId: weight.masterItemId, weightGrams: weight.weightGrams })),
  })) };
}
