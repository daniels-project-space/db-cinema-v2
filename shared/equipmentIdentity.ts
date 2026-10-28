/** Normalise known equipment model spacing before tokenisation or catalogue lookup.
 * Keep model numbers whole: FX3 is never an alias for FX30.
 */
export function normalizeEquipmentName(value: string): string {
  return String(value ?? "").replace(/ø/gi, "o").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\ba7[\s-]*([345])\b/g, (_, generation: string) => `a7${({3:"iii",4:"iv",5:"v"} as Record<string,string>)[generation]}`)
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

/** Remove advertising comparisons without hiding a package's real contents. */
export function equipmentOfferLabel(title: string): string {
  const clean = title.replace(/\(\s*(?:same sensor(?: as)?|like|such as|similar to|comparable to|vs\.?|alternative to)\b[^)]*(?:\)|$)/gi, " ")
    .replace(/\b(FX|FS|RS|GH|BMPCC)[\s-]+(\d+[a-z]*)\b/gi, "$1$2")
    .replace(/\s+/g, " ").replace(/[\s,+|]+$/, "").trim();
  const head = clean.match(/^(Sony|Canon|Nikon|Panasonic|Blackmagic)\s+([a-z]+\d+[a-z0-9]*(?:\s+(?:iii|ii|iv|vii|vi|v))?)\b/i);
  if (head && /\b(?:camera|mirrorless|body)\b/i.test(clean)) {
    const escaped = head[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const remainder = clean.slice(head[0].length).replace(new RegExp(escaped,"gi"), "")
      .replace(/\b(?:cinema|camera|full|frame|mirrorless|digital|body|4k|6k|8k)\b/gi, "").replace(/[\s,()–—-]/g, "");
    if (!remainder) return `${head[0]} camera body`;
  }
  return clean;
}

/** Read a leading equipment count, never a focal range or model generation. */
export function equipmentRequest(value: string): { subject: string; quantity: number; explicit: boolean } {
  const words = ["one","two","three","four","five","six","seven","eight","nine","ten"];
  const match = value.match(/^\s*(?:(\d{1,2})(?:\s*[x×]\s*|\s+)|(one|two|three|four|five|six|seven|eight|nine|ten)\s+)/i);
  return { subject: (match ? value.slice(match[0].length) : value).replace(/^complete\s+/i, "").trim(),
    quantity: match ? Number(match[1] ?? words.indexOf(match[2].toLowerCase()) + 1) : 1, explicit: !!match };
}
