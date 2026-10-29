/** Normalise known equipment model spacing before tokenisation or catalogue lookup.
 * Keep model numbers whole: FX3 is never an alias for FX30.
 */
export function normalizeEquipmentName(value: string): string {
  return String(value ?? "").replace(/ø/gi, "o").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[×✕]/g, "x")
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

/**
 * A short, customer-facing name for the product they asked for. Listing titles
 * can include bundle extras; those belong on the quoted line, not in the
 * requested-item summary.
 */
export function equipmentRequestLabel(title: string, itemType: string): string {
  if (itemType === "camera-body" || itemType === "camera") {
    const clean = String(title ?? "").replace(/\s+/g, " ").trim();
    // Keep the quoted listing's real contents visible. This helper is used for
    // the customer-facing offer line, so shortening an FX3 body kit to "camera
    // body" would hide the cage/media bundle the customer is actually renting.
    const hasPackageContents = /\b(?:kit|set|bundle|package|cage|cfexpress|xqd|sd(?:xc|hc)?|cards?|media|lens|gimbal|tripod|monitor|microphones?|mics?|audio|rig|v-?mount|batter(?:y|ies)|charger|handle)\b|\b\d{2,4}\s*(?:gb|tb)\b/i.test(clean);
    if (hasPackageContents) return equipmentOfferLabel(clean);
    const brand = clean.match(/\b(Sony|Canon|Nikon|Panasonic|Blackmagic)\b/i);
    if (brand) {
      const afterBrand = clean.slice((brand.index ?? 0) + brand[0].length, (brand.index ?? 0) + brand[0].length + 48);
      const model = afterBrand.match(/^\s*((?:EOS\s+)?[A-Za-z]{1,6}\s*-?\s*\d+[A-Za-z0-9]*(?:\s+(?:VII|VI|IV|III|II|V))?)/i)?.[1];
      if (model) return equipmentOfferLabel(`${brand[1]} ${model} camera body`);
    }
  }
  return equipmentOfferLabel(title);
}

/** Keep the requested camera identity separate from the listing's bundled title. */
export function equipmentRequestDisplayLabel(request: string, listingTitle: string, itemType: string): string {
  if (itemType !== "camera-body") return equipmentRequestLabel(listingTitle, itemType);
  const requested = String(request ?? "").replace(/\s+/g, " ").trim();
  const requestedModels = equipmentModelTokens(requested);
  const offeredModels = equipmentModelTokens(listingTitle);
  if (requestedModels.length !== 1 || !offeredModels.includes(requestedModels[0])) {
    return equipmentRequestLabel(listingTitle, itemType);
  }

  const brand = requested.match(/\b(Sony|Canon|Nikon|Panasonic|Blackmagic)\b/i)?.[1] ??
    listingTitle.match(/\b(Sony|Canon|Nikon|Panasonic|Blackmagic)\b/i)?.[1];
  const titleWords = String(listingTitle ?? "").match(/[A-Za-z0-9]+/g) ?? [];
  let displayModel = "";
  for (let start = 0; start < titleWords.length && !displayModel; start++) {
    for (let width = 1; width <= 3 && start + width <= titleWords.length; width++) {
      const candidate = titleWords.slice(start, start + width).join(" ");
      if (equipmentModelTokens(candidate).includes(requestedModels[0])) {
        displayModel = candidate;
        break;
      }
    }
  }
  displayModel ||= requestedModels[0].toUpperCase();
  if (brand) displayModel = displayModel.replace(new RegExp(`^${brand}\\s+`, "i"), "");
  return equipmentOfferLabel(`${brand ? `${brand} ` : ""}${displayModel} camera body`);
}

/** Read a leading equipment count, never a focal range or model generation. */
export function equipmentRequest(value: string): { subject: string; quantity: number; explicit: boolean } {
  const words = ["one","two","three","four","five","six","seven","eight","nine","ten"];
  const match = value.match(/^\s*(?:(\d{1,2})(?:\s*[x×]\s*|\s+)|(one|two|three|four|five|six|seven|eight|nine|ten)\s+)/i);
  return { subject: (match ? value.slice(match[0].length) : value).replace(/^complete\s+/i, "").trim(),
    quantity: match ? Number(match[1] ?? words.indexOf(match[2].toLowerCase()) + 1) : 1, explicit: !!match };
}
