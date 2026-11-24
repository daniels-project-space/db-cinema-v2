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

function extensionDurations(text: string): number[] {
  const normalized = String(text ?? "").toLowerCase().replace(/[’']/g, "'");
  const matches = [...normalized.matchAll(
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -]one|[ -]two|[ -]three|[ -]four|[ -]five|[ -]six|[ -]seven|[ -]eight|[ -]nine)?|thirty|\d{1,3})\s*(?:(?:more|extra|additional)\s+)?(days?|nights?|weeks?)\b/g,
  )];
  const durations = matches.map(match => {
    const count = numberValue(match[1]);
    return count === null ? null : count * (match[2].startsWith("week") ? 7 : 1);
  }).filter((count): count is number => count !== null);
  return durations;
}

/** Parse an explicit duration without guessing dates or rental-time changes. */
export function requestedExtensionDays(text: string): number | null {
  const durations = extensionDurations(text);
  return durations.length > 0 && durations.every(count => count === durations[0]) ? durations[0] : null;
}

export function isKeepRentalExtensionIntent(text: string): boolean {
  const value = String(text ?? "").toLowerCase();
  const keepMatch = /\b(?:keep|hold)\b/.exec(value);
  return !!keepMatch && extensionDurations(value.slice(keepMatch.index)).length > 0;
}

/** Only activate the extension workflow for rental-time language in a rental chat. */
export function parseRentalExtensionIntent(text: string, precedingAssistantText = ""): RentalExtensionIntent {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return { requested: false, extraDays: null };
  if (/\b(?:extension\s+(?:cords?|cables?|leads?|warranty|trial)|(?:cords?|cables?|leads?)\s+extension|(?:extend(?:s|ed|ing)?|extension)\s+(?:my\s+|the\s+)?subscription)\b/.test(value)) {
    return { requested: false, extraDays: null };
  }
  const durationPrompt = /\bhow many\b.{0,32}\b(?:extra\s+|more\s+|additional\s+)?(?:days?|nights?|weeks?)\b/i.test(precedingAssistantText);
  if (durationPrompt) {
    const explicitDays = requestedExtensionDays(value);
    const bareAnswer = /^(?:for\s+)?([a-z]+(?:[ -][a-z]+)?|\d{1,3})(?:\s+(?:please))?[.!]?$/.exec(value);
    const count = explicitDays ?? (bareAnswer ? numberValue(bareAnswer[1]) : null);
    if (count !== null && count > 0 && count <= 365) return { requested: true, extraDays: count };
  }
  const requested =
    /\bextend(?:s|ed|ing)?\b/.test(value) ||
    /\bextension\b/.test(value) ||
    /\b(?:extra|additional|another|more)\s+(?:\d+\s+)?(?:day|days|night|nights|time)\b/.test(value) ||
    /\b(?:keep|hold)\b.{0,45}\b(?:longer|until|through|another\s+day)\b/.test(value) ||
    isKeepRentalExtensionIntent(value) ||
    /\breturn\b.{0,35}\b(?:later|another\s+day|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(value) ||
    /\bmore\s+time\b.{0,35}\b(?:rental|booking|hire|camera|lens|kit|gear|items?)\b/.test(value);
  return { requested, extraDays: requested ? requestedExtensionDays(value) : null };
}

const ITEM_SCOPE_FILLER = new Set([
  "a", "an", "the", "my", "our", "your", "this", "that", "these", "those", "it", "them", "to", "next",
  "rental", "booking", "order", "kit", "gear", "equipment", "item", "items", "whole", "entire",
  "all", "both", "each", "every", "one", "another", "extra", "additional", "more", "day", "days",
  "night", "nights", "week", "weeks", "time", "times", "date", "dates", "later", "until", "through",
  "by", "for", "with", "and", "or", "but", "can", "could", "would", "please", "i", "we", "you",
  "want", "need", "like", "extend", "extends", "extended", "extending", "extension", "keep", "hold",
  "return", "check", "available", "availability", "maybe", "if", "possible", "fine", "just", "only",
]);

function itemScopeTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(token => !/^\d+$/.test(token) && !ITEM_SCOPE_FILLER.has(token));
}

export type RentalExtensionItemSelection =
  | { kind: "all" }
  | { kind: "selected"; lineIndexes: number[] }
  | { kind: "clarify"; titles: string[] };

/** Resolve a renter's named item(s) against the exact lines in the focused booking. */
export function rentalExtensionItemSelection(
  text: string,
  items: Array<{ index: number; title: string; slug?: string | null }>,
): RentalExtensionItemSelection {
  const clauses = text.split(/\s+and\s+/i);
  if (clauses.length > 1) {
    const groups = clauses.map(clause => {
      const tokens = new Set(itemScopeTokens(clause));
      const scores = items.map(item => ({ item, score: [...new Set([...itemScopeTokens(item.title), ...itemScopeTokens(item.slug ?? "")])].filter(token => tokens.has(token)).length }));
      const highest = Math.max(0, ...scores.map(row => row.score));
      return highest > 0 ? scores.filter(row => row.score === highest).map(row => row.item) : [];
    }).filter(group => group.length > 0);
    const matched = new Map(groups.flat().map(item => [item.index, item]));
    if (groups.length > 1 && matched.size > 1) {
      if (groups.some(group => group.length > 1)) return { kind: "clarify", titles: [...matched.values()].map(item => item.title) };
      return { kind: "selected", lineIndexes: [...matched.keys()].sort((first, second) => first - second) };
    }
  }
  const requestedTokens = new Set(itemScopeTokens(text));
  const scored = items.map(item => {
    const itemTokens = new Set([...itemScopeTokens(item.title), ...itemScopeTokens(item.slug ?? "")]);
    return { item, score: [...itemTokens].filter(token => requestedTokens.has(token)).length };
  });
  const highestScore = Math.max(0, ...scored.map(row => row.score));
  if (highestScore > 0) {
    const matches = scored.filter(row => row.score === highestScore);
    if (matches.length > 1 && !/\b(?:and|both|all|each|every|items|lenses|cameras)\b/i.test(text)) {
      return { kind: "clarify", titles: matches.map(row => row.item.title) };
    }
    return { kind: "selected", lineIndexes: matches.map(row => row.item.index).sort((a, b) => a - b) };
  }

  const target = /\b(?:extend(?:s|ed|ing)?|keep|hold)\s+(?:(?:only|just)\s+)?(?:(?:the|my|your)\s+)?([a-z][a-z0-9 -]{0,40})/i.exec(text)?.[1] ?? "";
  const targetBeforeDates = target.split(/\b(?:by|for|until|through|on|another|extra|additional|more|to)\b/i, 1)[0];
  if (itemScopeTokens(targetBeforeDates).length > 0) return { kind: "clarify", titles: [] };
  return { kind: "all" };
}
