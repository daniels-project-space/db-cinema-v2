export type KitComponent = { unitId: string; quantity: number };
export type ComponentFacts = { unitId: string; replacementValuePence: number; weightGrams: number };
export type ReviewedComponentReplacement = {
  id: string;
  listingId: string;
  originalUnitId: string;
  replacementUnitId: string;
  quantityPerKit: number;
  priceAdjustmentPence: number;
  extensionAdjustmentPence?: number[];
  catalogueRevision: string;
  active: boolean;
  declaredMissingOriginal?: { descriptorId: string; quantityPerKit: number };
};

export type EffectiveComponentAllocation = {
  version: "component-allocation-v1";
  listingId: string;
  catalogueRevision: string;
  replacementId: string;
  originalUnitId: string;
  replacementUnitId: string;
  quantityPerKit: number;
  kitQuantity: number;
  priceAdjustmentPence: number;
  extensionAdjustmentPence?: number[];
  replacementValuePence: number;
  weightGrams: number;
  components: KitComponent[];
};

function identifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
}

function checkedInteger(value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw Error("Invalid component replacement data.");
  return value;
}

function add(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw Error("Invalid component replacement data.");
  return result;
}

function multiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw Error("Invalid component replacement data.");
  return result;
}

export function buildEffectiveComponentAllocation(input: {
  listingId: string;
  catalogueRevision: string;
  components: KitComponent[];
  facts: ComponentFacts[];
  replacement: ReviewedComponentReplacement;
  kitQuantity: number;
  basePricePence: number;
}): EffectiveComponentAllocation {
  const { listingId, catalogueRevision, replacement } = input;
  if (![listingId, replacement.id, replacement.listingId, replacement.originalUnitId, replacement.replacementUnitId].every(identifier) ||
      typeof catalogueRevision !== "string" || !catalogueRevision.length || catalogueRevision.length > 65536 ||
      replacement.active !== true || replacement.listingId !== listingId || replacement.catalogueRevision !== catalogueRevision ||
      replacement.originalUnitId === replacement.replacementUnitId) throw Error("Component replacement is not approved for this kit.");
  const kitQuantity = checkedInteger(input.kitQuantity, 1);
  const quantityPerKit = checkedInteger(replacement.quantityPerKit, 1);
  const basePrice = checkedInteger(input.basePricePence, 0);
  if (!Number.isSafeInteger(replacement.priceAdjustmentPence)) throw Error("Invalid component replacement data.");
  if (replacement.extensionAdjustmentPence !== undefined && (!Array.isArray(replacement.extensionAdjustmentPence) || replacement.extensionAdjustmentPence.length !== 30 || replacement.extensionAdjustmentPence.some(amount => !Number.isSafeInteger(amount) || Math.abs(amount) > 100000000))) throw Error("Invalid component replacement extension rates.");
  const priceAdjustmentPence = multiply(replacement.priceAdjustmentPence, kitQuantity);
  if (add(basePrice, priceAdjustmentPence) < 0) throw Error("Invalid component replacement price.");
  if (!Array.isArray(input.components) || !input.components.length || input.components.length > 100 || !Array.isArray(input.facts) || input.facts.length > 101)
    throw Error("Invalid component replacement data.");
  const counts = new Map<string, number>();
  for (const component of input.components) {
    if (!identifier(component.unitId)) throw Error("Invalid component replacement data.");
    counts.set(component.unitId, add(counts.get(component.unitId) ?? 0, checkedInteger(component.quantity, 1)));
  }
  const originalCount = counts.get(replacement.originalUnitId) ?? 0;
  if (replacement.declaredMissingOriginal) {
    const declared = replacement.declaredMissingOriginal;
    if (!identifier(declared.descriptorId) || !declared.descriptorId.startsWith("declared:") || declared.descriptorId !== replacement.originalUnitId ||
        checkedInteger(declared.quantityPerKit, 1) !== quantityPerKit || originalCount !== 0)
      throw Error("The declared missing component evidence is invalid.");
  } else {
    if (originalCount < quantityPerKit) throw Error("The original component is not present in the requested quantity.");
    if (originalCount === quantityPerKit) counts.delete(replacement.originalUnitId);
    else counts.set(replacement.originalUnitId, originalCount - quantityPerKit);
  }
  counts.set(replacement.replacementUnitId, add(counts.get(replacement.replacementUnitId) ?? 0, quantityPerKit));
  const facts = new Map<string, ComponentFacts>();
  for (const fact of input.facts) {
    if (!identifier(fact.unitId) || facts.has(fact.unitId)) throw Error("Invalid component replacement data.");
    checkedInteger(fact.replacementValuePence, 0);
    checkedInteger(fact.weightGrams, 0);
    facts.set(fact.unitId, fact);
  }
  let replacementValuePence = 0, weightGrams = 0;
  const components = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([unitId, count]) => {
    const fact = facts.get(unitId);
    if (!fact) throw Error("Verified component value and weight are required.");
    const quantity = multiply(count, kitQuantity);
    replacementValuePence = add(replacementValuePence, multiply(fact.replacementValuePence, quantity));
    weightGrams = add(weightGrams, multiply(fact.weightGrams, quantity));
    return { unitId, quantity };
  });
  return { version: "component-allocation-v1", listingId, catalogueRevision, replacementId: replacement.id,
    originalUnitId: replacement.originalUnitId, replacementUnitId: replacement.replacementUnitId, quantityPerKit,
    kitQuantity, priceAdjustmentPence, ...(replacement.extensionAdjustmentPence ? { extensionAdjustmentPence: [...replacement.extensionAdjustmentPence] } : {}), replacementValuePence, weightGrams, components };
}
