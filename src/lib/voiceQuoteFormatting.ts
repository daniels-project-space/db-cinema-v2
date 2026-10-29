import { equipmentModelTokens, equipmentOfferLabel, normalizeEquipmentName } from "../../shared/equipmentIdentity";

function quantityWord(quantity: number): string {
  return ({ 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" } as Record<number, string>)[quantity] ?? String(quantity);
}

function pluralize(part: string): string {
  if (/[^aeiou]y$/i.test(part)) return part.slice(0, -1) + "ies";
  return /s$/i.test(part) ? part : part + "s";
}

function list(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Read out the number of requested rental units a listing actually supplies. */
export function spokenRentalItem(requestName: string, title: string, listingQuantity: number, providedUnits: number): string {
  const count = Number.isSafeInteger(providedUnits) && providedUnits > 0 ? providedUnits : listingQuantity;
  const listingCount = Number.isSafeInteger(listingQuantity) && listingQuantity > 0 ? listingQuantity : 1;
  if (count > listingCount) {
    const rode = title.match(/\bR[ØO]DE\s+Wireless\s+PRO\b/i)?.[0];
    const source = rode ? `the ${rode} bundle` : `one ${equipmentOfferLabel(title)} listing`;
    return `${quantityWord(count)} ${requestName} from ${source}`;
  }
  const requestedModels = equipmentModelTokens(requestName);
  const offeredModels = equipmentModelTokens(title);
  if (/\b(?:camera\s+body|body\s+only|camera\s+only)\b/i.test(requestName) &&
      requestedModels.length === 1 && offeredModels.includes(requestedModels[0])) {
    const brand = requestName.match(/\b(Sony|Canon|Nikon|Panasonic|Blackmagic)\b/i)?.[1] ??
      title.match(/\b(Sony|Canon|Nikon|Panasonic|Blackmagic)\b/i)?.[1];
    let concise = requestName
      .replace(/\b(?:only|no|without)\b/gi, " ")
      .replace(/\b(?:lens(?:es)?|gimbals?|accessories?|extras?|cards?|media|cages?|bundles?|kits?)\b/gi, " ")
      .replace(/\b(?:or|and)\b/gi, " ")
      .replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
    concise = concise.replace(/\bcamera\s+only\b/i, "camera body");
    if (!/\bcamera\s+body\b/i.test(concise)) concise += " camera body";
    if (brand && !new RegExp(`\\b${brand}\\b`, "i").test(concise)) concise = `${brand} ${concise}`;
    return `${quantityWord(listingCount)} ${equipmentOfferLabel(concise)}`;
  }
  return `${quantityWord(listingCount)} ${equipmentOfferLabel(title)}`;
}

/** Speak the verified inventory contents and separate them from unverified seller extras. */
export function spokenPackingReview(title: string, verifiedContents: string[] = []): string {
  const cleanTitle = equipmentOfferLabel(title);
  const normalizedTitle = normalizeEquipmentName(cleanTitle);
  const details = verifiedContents.flatMap(part => {
    const raw = String(part ?? "").trim();
    const match = raw.match(/^\s*(\d+)\s*[x×]\s*(.+?)\s*$/i);
    if (!match) return raw ? [raw] : [];
    const quantity = Number(match[1]);
    const name = match[2].trim();
    const normalizedName = normalizeEquipmentName(name);
    if (/\bwireless\b/i.test(name) && normalizedTitle.includes(normalizedName)) return [];
    return [`${quantityWord(quantity)} ${quantity === 1 ? name : pluralize(name)}`];
  });
  return details.length
    ? `${cleanTitle} has owner-confirmed contents of ${list(details)}. Other seller-listed accessories are not confirmed.`
    : `I haven't confirmed the included contents of ${cleanTitle} yet.`;
}
