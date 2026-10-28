/** Normalise known equipment model spacing before tokenisation or catalogue lookup.
 * Keep model numbers whole: FX3 is never an alias for FX30.
 */
export function normalizeEquipmentName(value: string): string {
  return String(value ?? "").replace(/ø/gi, "o").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fx|fs|a|rs|rsc|gh|bmpcc|pxw|eos|c|r|z)[\s-]+(\d+[a-z]*)\b/g, "$1$2")
    .replace(/\b([a-z]+\d+[a-z]*)\s+(iii|ii|iv|vii|vi|v)\b/g, "$1$2");
}

export function equipmentModelTokens(value: string): string[] {
  return normalizeEquipmentName(value).match(/\b[a-z]+\d+[a-z0-9]*\b/g)?.filter(token => !/^[ft]\d/.test(token)) ?? [];
}

/** Explicit model identities are constraints, not partial substring scores. */
export function equipmentModelsMatch(query: string, title: string): boolean {
  const identity = title.replace(/\((?:like|such as|similar to|comparable to|vs\.?|alternative to)[^)]*\)/gi, " ");
  const tokens = new Set(normalizeEquipmentName(identity).match(/[a-z0-9]+/g) ?? []);
  return equipmentModelTokens(query).every(model => tokens.has(model));
}
