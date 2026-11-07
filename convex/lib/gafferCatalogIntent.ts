const categories: Array<[RegExp, string]> = [
  [/\b(?:camera|cameras|camera body|bodies)\b/i, "Cameras"],
  [/\b(?:lens|lenses|glass)\b/i, "Lenses"],
  [/\b(?:light|lights|lighting)\b/i, "Lighting"],
  [/\b(?:microphone|microphones|mic|mics|audio)\b/i, "Audio"],
  [/\b(?:drone|drones)\b/i, "Drones"],
  [/\b(?:gimbal|gimbals|stabiliser|stabilizer)\b/i, "Stabilizers"],
  [/\b(?:tripod|tripods|grip)\b/i, "Grip"],
  [/\b(?:battery|batteries|charger)\b/i, "Power"],
  [/\b(?:monitor|monitors)\b/i, "Monitors"],
];
const modelWord = /\b(?:fx\s?3|fx\s?6|a7\s?s?\s?(?:iii|iv|v|3|4|5)|bmpcc\s?6k|komodo|pyxis|ronin|rs\s?[34]|pavotube)\b/i;
const brandWord = /\b(?:nanlite|aputure|amaran|blackmagic|canon|sony|sigma|dji|rode)\b/i;
const ask = /\b(?:available|availability|stock|hire|rent|renting|rental|book|booking|price|cost|recommend|suggest|options|range|catalogue|catalog|equipment|gear|what|which|do you (?:have|carry)|have you got)\b/i;

export function gafferCatalogIntent(message: string): { category?: string; search?: string } | null {
  const text = message.trim().slice(0, 1200);
  if (!ask.test(text)) return null;
  const category = categories.find(([pattern]) => pattern.test(text))?.[1];
  const search = (text.match(modelWord)?.[0] ?? text.match(brandWord)?.[0])?.replace(/\s+/g, "").toLowerCase();
  if (!category && !search) return null;
  return { ...(category ? { category } : {}), ...(search ? { search } : {}) };
}
