const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  twentyone: 21, twentytwo: 22, twentythree: 23, twentyfour: 24, twentyfive: 25,
  twentysix: 26, twentyseven: 27, twentyeight: 28, twentynine: 29, thirty: 30,
};

export type RentalExtensionIntent = {
  requested: boolean;
  extraDays: number | null;
};

function numberValue(value: string): number | null {
  const normalized = value.toLowerCase().replace(/[ -]/g, "");
  if (/^\d{1,3}$/.test(normalized)) return Number(normalized);
  return NUMBER_WORDS[normalized] ?? null;
}

/** Parse an explicit duration without guessing dates or rental-time changes. */
export function requestedExtensionDays(text: string): number | null {
  const normalized = String(text ?? "").toLowerCase().replace(/[’']/g, "'");
  const match = normalized.match(
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -]one|[ -]two|[ -]three|[ -]four|[ -]five|[ -]six|[ -]seven|[ -]eight|[ -]nine)?|thirty|\d{1,3})\s*(?:(?:more|extra|additional)\s+)?(days?|nights?|weeks?)\b/,
  );
  if (!match) return null;
  const count = numberValue(match[1]);
  if (count === null) return null;
  return count * (match[2].startsWith("week") ? 7 : 1);
}

/** Only activate the extension workflow for rental-time language in a rental chat. */
export function parseRentalExtensionIntent(text: string): RentalExtensionIntent {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return { requested: false, extraDays: null };
  if (/\b(?:extension\s+(?:cords?|cables?|leads?|warranty|trial)|(?:cords?|cables?|leads?)\s+extension|(?:extend(?:s|ed|ing)?|extension)\s+(?:my\s+|the\s+)?subscription)\b/.test(value)) {
    return { requested: false, extraDays: null };
  }
  const requested =
    /\bextend(?:s|ed|ing)?\b/.test(value) ||
    /\bextension\b/.test(value) ||
    /\b(?:extra|additional|another|more)\s+(?:\d+\s+)?(?:day|days|night|nights|time)\b/.test(value) ||
    /\b(?:keep|hold)\b.{0,45}\b(?:longer|until|through|another\s+day)\b/.test(value) ||
    /\breturn\b.{0,35}\b(?:later|another\s+day|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(value) ||
    /\bmore\s+time\b.{0,35}\b(?:rental|booking|hire|camera|lens|kit|gear|items?)\b/.test(value);
  return { requested, extraDays: requested ? requestedExtensionDays(value) : null };
}
