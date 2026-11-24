const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { buildEffectiveComponentAllocation } = load("shared/componentReplacement.ts");

const input = {
  listingId: "kit", catalogueRevision: "catalogue-7", kitQuantity: 2, basePricePence: 20000,
  components: [{ unitId: "body", quantity: 1 }, { unitId: "old-lens", quantity: 1 }],
  facts: [{ unitId: "body", replacementValuePence: 300000, weightGrams: 1000 }, { unitId: "new-lens", replacementValuePence: 200000, weightGrams: 800 }],
  replacement: { id: "upgrade-1", listingId: "kit", originalUnitId: "old-lens", replacementUnitId: "new-lens", quantityPerKit: 1, priceAdjustmentPence: 500, catalogueRevision: "catalogue-7", active: true },
};
const result = buildEffectiveComponentAllocation(input);
assert.deepEqual(result.components, [{ unitId: "body", quantity: 2 }, { unitId: "new-lens", quantity: 2 }]);
assert.equal(result.priceAdjustmentPence, 1000);
assert.equal(result.replacementValuePence, 1000000);
assert.equal(result.weightGrams, 3600);
const rates = Array.from({length:30}, (_, index) => (index + 1) * 125);
assert.deepEqual(buildEffectiveComponentAllocation({ ...input, replacement: { ...input.replacement, extensionAdjustmentPence: rates } }).extensionAdjustmentPence, rates);
assert.throws(() => buildEffectiveComponentAllocation({ ...input, replacement: { ...input.replacement, extensionAdjustmentPence: [100] } }), /extension rates/i);
assert.deepEqual(input.components, [{ unitId: "body", quantity: 1 }, { unitId: "old-lens", quantity: 1 }]);

const partial = buildEffectiveComponentAllocation({ ...input, kitQuantity: 1, components: [...input.components, { unitId: "old-lens", quantity: 1 }, { unitId: "new-lens", quantity: 1 }], facts: [...input.facts, { unitId: "old-lens", replacementValuePence: 100000, weightGrams: 600 }] });
assert.deepEqual(partial.components, [{ unitId: "body", quantity: 1 }, { unitId: "new-lens", quantity: 2 }, { unitId: "old-lens", quantity: 1 }]);
assert.equal(partial.replacementValuePence, 800000);
assert.equal(partial.weightGrams, 3200);
const declared = { ...input.replacement, originalUnitId: "declared:lens-f4", declaredMissingOriginal: { descriptorId: "declared:lens-f4", quantityPerKit: 1 } };
const declaredResult = buildEffectiveComponentAllocation({ ...input, components: [{ unitId: "body", quantity: 1 }], replacement: declared });
assert.deepEqual(declaredResult.components, [{ unitId: "body", quantity: 2 }, { unitId: "new-lens", quantity: 2 }]);
assert.equal(declaredResult.replacementValuePence, 1000000);
assert.equal(declaredResult.weightGrams, 3600);
assert.throws(() => buildEffectiveComponentAllocation({ ...input, replacement: { ...declared, declaredMissingOriginal: { descriptorId: "lens-f4", quantityPerKit: 1 } } }));
assert.throws(() => buildEffectiveComponentAllocation({ ...input, replacement: { ...declared, declaredMissingOriginal: { descriptorId: "declared:lens-f4", quantityPerKit: 2 } } }));
assert.throws(() => buildEffectiveComponentAllocation({ ...input, components: [...input.components, { unitId: "declared:lens-f4", quantity: 1 }], replacement: declared }));
for (const replacement of [
  { ...input.replacement, active: false }, { ...input.replacement, listingId: "another" },
  { ...input.replacement, catalogueRevision: "old" }, { ...input.replacement, replacementUnitId: "old-lens" },
  { ...input.replacement, quantityPerKit: 2 }, { ...input.replacement, quantityPerKit: 0 },
  { ...input.replacement, priceAdjustmentPence: -10001 },
]) assert.throws(() => buildEffectiveComponentAllocation({ ...input, replacement }));
assert.throws(() => buildEffectiveComponentAllocation({ ...input, facts: input.facts.slice(0, 1) }));
assert.throws(() => buildEffectiveComponentAllocation({ ...input, facts: [...input.facts, input.facts[0]] }));
assert.throws(() => buildEffectiveComponentAllocation({ ...input, kitQuantity: Number.MAX_SAFE_INTEGER }));
assert.throws(() => buildEffectiveComponentAllocation({ ...input, facts: input.facts.map(f => ({ ...f, weightGrams: -1 })) }));
console.log("PASS reviewed component replacement: effective units, value, weight and price; stale, malformed and overflow cases rejected");
