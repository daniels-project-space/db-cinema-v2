import { effectiveLensSpecs, filterThreadsFor } from "./opticalFacts";
import { bestCompat, parseMounts } from "../convex/lib/mount";
import { isMarketingOnly } from "../convex/lib/marketingInventory";
import { deriveItemType } from "../convex/lib/taxonomy";
import { equipmentModelsMatch, normalizeEquipmentName } from "./equipmentIdentity";

/** Catalogue evidence shared by the basket, assembler and complementary picks.
 * Physical components identify aliases across accounts; documented contents
 * identify included lenses even when the listing's primary type is a body.
 * Optional/excluded contents never count as supplied equipment.
 */
export type RecommendationItem = {
  _id?: string; listingId?: string; title?: string; itemType?: string | null;
  marketingOnly?: boolean; marketingOnlySource?: "auto" | "admin" | "rental_manager"; displayOnly?: boolean;
  stockMappingStatus?: string | null;
  specs?: { mount?: string | null; coverage?: string | null; includesLens?: boolean | null;
    lensFocal?: string | null; tier?: string | null; lensClass?: string | null; batteryType?: string | null; filterThreadMm?: number | null } | null;
  components?: { inventoryUnitId: string; qty: number }[];
  inventoryFacts?: { contents?: string[]; reviewRequired?: boolean; owned?: boolean | null } | null;
  rentalContents?: { included?: string[] } | null;
};

export function focalRanges(text?: string | null): string[] {
  const normalized = String(text ?? "").replace(/[–—−]/g, "-")
    .replace(/\b[ft]\s*\/?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?/gi, " ");
  return [...normalized.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)(?:\s*mm)?(?![\d.])|(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*mm\b/gi)]
    .map(m => m[3] ? `${Number(m[3])}` : `${Number(m[1])}-${Number(m[2])}`);
}

export function lensFocals(item: RecommendationItem): string[] {
  const value = item.specs?.lensFocal;
  // Structured lensFocal convention omits the mm suffix.
  return [...new Set([...focalRanges(item.title), ...focalRanges(value ? `${value}mm` : "")])];
}

/** Current owner facts override conflicting older packing descriptions for
 * the same type of equipment. Facts may be partial, so absence is unconfirmed. */
export function documentedContents(item: RecommendationItem): string[] {
  const current = item.inventoryFacts?.contents ?? [];
  const currentTypes = new Set<string>(current.map(deriveItemType).filter(type => type !== "accessory"));
  const older = (item.rentalContents?.included ?? []).filter(text => !currentTypes.has(deriveItemType(text)));
  return [...current, ...older];
}

export function includedLensFocals(item: RecommendationItem): string[] {
  if (item.itemType === "lens") return lensFocals(item);
  const documented = documentedContents(item).filter(s => /lens|\bgm\b|g\s*master|zoom|prime/i.test(s));
  const result = documented.flatMap(focalRanges);
  if (!documented.length && item.specs?.includesLens) result.push(...lensFocals(item));
  return [...new Set(result)];
}

function id(item: RecommendationItem) { return item._id ?? item.listingId; }
const AUDIO_SUPPLY_TYPES = new Set(["wireless-mic", "boom-mic", "recorder"]);

/** Another offer can sell the very same physical lens or a subset of a kit. */
export function alreadySupplied(candidate: RecommendationItem, selected: RecommendationItem[]): boolean {
  if (selected.some(item => id(candidate) && id(candidate) === id(item))) return true;
  const components = candidate.components ?? [];
  if (components.length && components.every(c => selected.reduce((quantity,item)=>quantity+
    (item.components??[]).filter(i=>i.inventoryUnitId===c.inventoryUnitId).reduce((sum,i)=>sum+i.qty,0),0)>=c.qty)) return true;
  if (candidate.itemType !== "lens") return false;
  const focals = lensFocals(candidate);
  if (!focals.length) return false;
  return selected.some(item => {
    const supplied = includedLensFocals(item);
    if (!focals.every(f => supplied.includes(f))) return false;
    // Bundled same-focal glass is not an automatic extra purchase. For two
    // separate lenses retain a genuine AF/cinema or standard/premium choice.
    if (item.itemType !== "lens") return true;
    return item.specs?.mount === candidate.specs?.mount &&
      item.specs?.lensClass === candidate.specs?.lensClass &&
      item.specs?.tier === candidate.specs?.tier;
  });
}

/** Types are derived from included component descriptions, never from a
 * package's marketing title or its optional extras. */
export function documentedIncludedTypes(item: RecommendationItem): string[] {
  const descriptions = documentedContents(item);
  const types = descriptions.map(deriveItemType).filter(type => type !== "accessory" && type !== item.itemType);
  if (includedLensFocals(item).length && item.itemType !== "lens") types.push("lens");
  return [...new Set(types)];
}

/** Keep a body request focused; included power, media and cages remain welcome.
 * This ranks configurations, never certifies stock or compatibility.
 */
export function unrequestedCameraExtras(item: RecommendationItem, request: string, strictConfiguration = false, onlyExplicit = false): number {
  if (!/^camera(?:-body)?$/.test(item.itemType ?? "")) return 0;
  const text = [item.title ?? "", ...(item.inventoryFacts?.contents ?? [])].join(" ");
  const included = new Set(documentedIncludedTypes(item));
  const extras: [string, RegExp, boolean][] = [
    ["lens", /\blens(?:es)?\b|\b\d+\s*[-–]\s*\d+\s*mm\b/i, false],
    ["gimbal", /\bgimbal\b|\brs\s*[234]\b/i, false],
    ["tripod", /\btripod\b/i, false],
    ["monitor", /\bmonitor\b/i, false],
    ["wireless-mic", /\bmic(?:rophone)?s?\b|\baudio\b/i, false],
    // A cage and recording card are part of some owner-listed camera-body offers.
    // Count them as a configuration conflict only when the renter explicitly excludes
    // accessories or names that item negatively; "camera only" still means no separate
    // lens, gimbal, tripod, monitor or audio listing.
    ["camera-cage", /\bcage\b|\bbase\s*plate\b|\btop\s+handle\b|\bside\s+handle\b/i, true],
    ["recording-media", /\b(?:cfexpress|xqd|sd(?:xc|hc)?|compact\s*flash)\b(?:\s+(?:type\s*[ab])?)?(?:\s+cards?)?\b|\b\d{2,4}\s*gb\b/i, true],
  ];
  const requestText = String(request ?? "");
  const refusesAllExtras = /\b(?:no|without|exclude|skip|omit|leave\s+out|don't|dont|do\s+not|not\s+include)\b.{0,32}\b(?:extras?|accessor(?:y|ies)|add[ -]?ons?)\b/i.test(requestText);
  const negates = (pattern: RegExp) => [...requestText.matchAll(new RegExp(pattern.source, "gi"))].some((match) => {
    const at = match.index ?? 0;
    const before = requestText.slice(Math.max(0, at - 52), at);
    const after = requestText.slice(at + match[0].length, at + match[0].length + 28);
    return /\b(?:no|without|exclude|excluding|skip|omit|leave\s+out|don't|dont|do\s+not|not\s+include|not\s+want|not\s+need)\b(?:\s+[\w-]+){0,3}\s*$/i.test(before) ||
      /^\s*(?:is\s+)?(?:not\s+wanted|excluded|left\s+out|not\s+included)\b/i.test(after);
  });
  return extras.filter(([type, pattern, standardAccessory]) => {
    const present = included.has(type) || pattern.test(text) || type === "lens" && item.specs?.includesLens === true;
    if (!present) return false;
    if (negates(pattern)) return true;
    if (onlyExplicit) return refusesAllExtras;
    if (standardAccessory) return strictConfiguration && refusesAllExtras;
    return !pattern.test(requestText);
  }).length;
}

/** Count documented camera bodies for configuration ranking, not stock capacity. */
export function cameraOfferUnits(item: RecommendationItem): number {
  if (item.itemType !== "camera-body") return 1;
  const counts = (item.inventoryFacts?.contents ?? []).flatMap(text => {
    const match = text.match(/^\s*(\d{1,2})\s*[x×]\s*(.+)$/i);
    return match && deriveItemType(match[2]) === "camera-body" ? [Number(match[1])] : [];
  });
  return Math.max(1, Math.min(100, counts.reduce((sum, count) => sum + count, 0)));
}

export type AssemblyCameraConstraint = { model: string; brief: string; strict: boolean; count: number; named?: AssemblyBriefConstraint | null; requiresLens?: boolean; requestedLens?: RecommendationItem | null };
export type AssemblyBriefConstraint = { tokens: string[] };
const ASSEMBLY_GENERIC_WORDS = new Set(["the", "and", "for", "with", "from", "need", "want", "please", "looking", "find", "include", "available", "availability", "good", "best", "great", "affordable", "cheap", "budget", "friendly", "portable", "handheld", "low", "interview", "documentary", "wedding", "music", "portrait", "portraits", "project", "camera", "cameras", "body", "lens", "lenses", "kit", "set", "package", "gear", "equipment", "hire", "rental", "shoot", "shooting", "filming", "video", "audio", "wireless", "microphone", "microphones", "mic", "mics", "light", "lighting", "gimbal", "tripod", "monitor", "small", "large", "crew", "only", "just", "film", "production", "full", "frame"]);
for (const word of ["today", "tomorrow", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december", "pickup", "collection", "return", "delivery", "time", "days"]) ASSEMBLY_GENERIC_WORDS.add(word);
const ASSEMBLY_NEGATION = /\b(?:no|without|exclude|excluding|skip|omit|leave\s+out|don't|dont)\b(?:(?!\b(?:but|however)\b)[^,;.!]){0,80}/gi;
const ASSEMBLY_STAGE_PATTERNS: Record<string, RegExp> = {
  camera: /\b(?:camera|body|camcorder)\b/i, lens: /\blens(?:es)?\b/i, gimbal: /\bgimbals?\b/i,
  tripod: /\btripods?\b/i, monitor: /\bmonitors?\b/i, light: /\blights?\b|\blighting\b/i,
  "wireless-mic": /\b(?:wireless\s+)?(?:mics?|microphones?)\b/i, "lav-mic": /\b(?:lav(?:alier)?s?|mics?|microphones?)\b/i,
  "shotgun-mic": /\b(?:shotgun|boom|mics?|microphones?)\b/i, drone: /\bdrones?\b/i, battery: /\bbatter(?:y|ies)\b/i,
  recorder: /\brecorders?\b/i, speaker: /\bspeakers?\b/i,
};

function assemblyIdentityTokens(text: string): string[] {
  const normalized = normalizeEquipmentName(text)
    .replace(/(\d{2,3})\s*[-–]\s*(\d{2,3})\s*(?:mm)?\b/g, "$1-$2mm")
    .replace(/(\d+)\s+(mm|watts?|hz)\b/g, "$1$2")
    .replace(/\b(?:mic|microphone)\s+(\d+[a-z]?)\b/g, "mic$1");
  return [...new Set((normalized.match(/[a-z]+[a-z0-9]*|\d+(?:-\d+)?[a-z]*/g) ?? [])
    .filter(token => !ASSEMBLY_GENERIC_WORDS.has(token) && (token.length >= 3 || ["pl", "ef", "rf"].includes(token)))
    .filter(token => !/^(?:\d+|\d+x|x\d+|[ft]\d+)$/.test(token)))];
}

/** Match explicit names or model/focal identifiers from the brief to real catalogue titles. */
export function assemblyPositiveBrief(brief: string): string {
  return brief.replace(ASSEMBLY_NEGATION, " ");
}

export function assemblyStageExcluded(brief: string, key: string): boolean {
  const pattern = ASSEMBLY_STAGE_PATTERNS[key];
  if (!pattern || key === "camera") return false;
  return [...brief.matchAll(ASSEMBLY_NEGATION)].some(match => pattern.test(match[0]) || /\b(?:extras?|accessor(?:y|ies)|add[ -]?ons?)\b/i.test(match[0]));
}

export function assemblyStageBrief(brief: string, key: string): string {
  const positive = assemblyPositiveBrief(brief);
  const match = ASSEMBLY_STAGE_PATTERNS[key]?.exec(positive);
  if (!match || match.index === undefined) return positive;
  const before = positive.slice(0, match.index).split(/[,;.!]|\b(?:and|plus|with)\b/i).pop() ?? "";
  const after = positive.slice(match.index + match[0].length).split(/[,;.!]|\b(?:and|plus|for)\b/i)[0] ?? "";
  return `${before} ${match[0]} ${after}`;
}

export function inferAssemblyBriefConstraint(brief: string, ignored: string[] = []): AssemblyBriefConstraint | null {
  const tokens = assemblyIdentityTokens(assemblyPositiveBrief(brief)).filter(token => !ignored.includes(token));
  const signal = tokens.some(token => !/^(?:4k|6k|8k|1080p)$/.test(token));
  return signal ? { tokens } : null;
}

export function matchesAssemblyBrief(item: RecommendationItem, constraint: AssemblyBriefConstraint): boolean {
  const tokens = new Set(assemblyIdentityTokens(`${item.title ?? ""} ${item.specs?.mount ?? ""}`));
  if (item.itemType === "wireless-mic" && item.inventoryFacts?.owned === true && item.inventoryFacts.reviewRequired === false &&
      item.inventoryFacts.contents?.some(part => /^\s*1\s*[x×]\s*DJI\s+Wireless\s+Mics?\s*$/i.test(part))) tokens.add("mic1");
  return constraint.tokens.length > 0 && constraint.tokens.every(token => tokens.has(token));
}

export function assemblyCameraOnly(brief: string): boolean {
  return /\b(?:camera|body)\s+only\b|\b(?:only|just)\s+(?:a\s+|the\s+)?(?:camera|body)\b/i.test(brief);
}

/** A named model and excluded accessories remain constraints after live stock refreshes. */
export function matchesAssemblyCamera(item: RecommendationItem, constraint: AssemblyCameraConstraint): boolean {
  if (constraint.model && !equipmentModelsMatch(constraint.model, item.title ?? "")) return false;
  if (constraint.named && !matchesAssemblyBrief(item, constraint.named)) return false;
  if (constraint.strict && unrequestedCameraExtras(item, constraint.brief, true, !assemblyCameraOnly(constraint.brief)) > 0) return false;
  if (constraint.requiresLens && (!constraint.requestedLens || !recommendationCompatible(item, [constraint.requestedLens]))) return false;
  return cameraOfferUnits(item) <= constraint.count;
}

export type LensFit = "native" | "adapter" | "unknown" | "incompatible" | "crop";
export function lensFit(candidate: RecommendationItem, selected: RecommendationItem[]): LensFit {
  const cameras = selected.filter(i => i.itemType === "camera-body");
  if (!cameras.length) return "unknown";
  const specs = effectiveLensSpecs(candidate);
  const lens = parseMounts(specs?.mount).filter(m => m !== "any");
  if (!lens.length) return "unknown";
  const sizes: Record<string, number> = { mft: 1, s35: 2, ff: 3 };
  const fits = cameras.map(camera => {
    const mounts = parseMounts(camera.specs?.mount).filter(m => m !== "any");
    if (!mounts.length) return "unknown" as LensFit;
    const fit = bestCompat(lens, mounts);
    if (fit === "incompatible" || fit === "unknown") return fit;
    const l = sizes[specs?.coverage ?? ""], c = sizes[camera.specs?.coverage ?? ""];
    if (l && c && l < c) return "crop" as LensFit;
    if (!l || !c) return "unknown" as LensFit;
    return fit;
  });
  // A multicamera kit may use different mounts: explain fit for a real body,
  // never imply it fits every camera just because one mount matches.
  return ["native", "adapter", "unknown", "crop", "incompatible"].find(f => fits.includes(f as LensFit)) as LensFit;
}

export function rentableCandidate(item: RecommendationItem): boolean {
  const marketingOnly = item.title
    ? isMarketingOnly({ ...item, title: item.title })
    : item.marketingOnly === true;
  return !marketingOnly && !item.displayOnly && item.inventoryFacts?.owned !== false &&
    (item.stockMappingStatus === undefined || item.stockMappingStatus === "complete");
}

/** A narrower zoom adds no focal coverage to an already supplied zoom.
 * Primes remain distinct creative choices; this is not a blanket overlap ban. */
function focalAlreadyCovered(focal: string, supplied: string[]): boolean {
  if (supplied.includes(focal)) return true;
  const range = focal.split("-").map(Number);
  return range.length === 2 && supplied.some(value => {
    const existing = value.split("-").map(Number);
    return existing.length === 2 && range[0] >= existing[0] && range[1] <= existing[1];
  });
}

export function automaticLens(candidate: RecommendationItem, selected: RecommendationItem[]): boolean {
  const supplied = new Set(selected.flatMap(includedLensFocals));
  return rentableCandidate(candidate) && !alreadySupplied(candidate, selected) && !lensFocals(candidate).some(f => focalAlreadyCovered(f, [...supplied])) && lensFit(candidate, selected) === "native";
}

/** A kit sold and owner-confirmed with these exact physical components is
 * affirmative pairing evidence. No name similarity or estimated delivery
 * weight can stand in for the camera/lens combination actually documented. */
export function verifiedGimbalPair(candidate: RecommendationItem, selected: RecommendationItem[], evidence: RecommendationItem[] = []): boolean {
  const cameras = selected.filter(i => i.itemType === "camera-body");
  const optics = selected.filter(i => i.itemType === "lens");
  if (!cameras.length || !candidate.components?.length) return false;
  const covered = (item: RecommendationItem, kit: RecommendationItem) => !!item.components?.length && item.components.every(c =>
    (kit.components ?? []).some(k => k.inventoryUnitId === c.inventoryUnitId && k.qty >= c.qty));
  return evidence.some(kit => covered(candidate, kit) && cameras.some(camera => covered(camera, kit)) && optics.every(lens => covered(lens, kit)));
}

/** Automatic additions require affirmative evidence in the relevant dimension.
 * Unknown fit remains a browsable choice, rather than a promised match. */
export function recommendationCompatible(candidate: RecommendationItem, selected: RecommendationItem[], evidence: RecommendationItem[] = []): boolean {
  if (alreadySupplied(candidate, selected)) return false;
  if (AUDIO_SUPPLY_TYPES.has(candidate.itemType ?? "") && selected.some(item =>
    documentedIncludedTypes(item).some(type => AUDIO_SUPPLY_TYPES.has(type)))) return false;
  if (candidate.itemType === "gimbal") return verifiedGimbalPair(candidate, selected, evidence);
  if (candidate.itemType === "lens") return automaticLens(candidate, selected);
  if (candidate.itemType === "camera-body") {
    const lenses = selected.filter(i => i.itemType === "lens");
    const bundled = new Set(includedLensFocals(candidate));
    return lenses.every(lens => lensFit(lens, [candidate]) === "native" && !lensFocals(lens).some(f => focalAlreadyCovered(f, [...bundled])));
  }
  if (candidate.itemType === "battery") {
    const families = (value?: string | null) => String(value ?? "").toLowerCase().split(/[\/,]/).map(s => s.replace(/[^a-z0-9]/g, "")).filter(Boolean);
    const battery = families(candidate.specs?.batteryType);
    return battery.length > 0 && selected.some(i => families(i.specs?.batteryType).some(f => battery.includes(f)));
  }
  if (candidate.itemType === "nd-filter") {
    const thread = candidate.specs?.filterThreadMm;
    return !!thread && selected.some(i => filterThreadsFor(i).includes(thread));
  }
  return true;
}

export function automaticRecommendation(candidate: RecommendationItem, selected: RecommendationItem[], evidence: RecommendationItem[] = []): boolean {
  return rentableCandidate(candidate) && recommendationCompatible(candidate, selected, evidence);
}

/** Only a separately priced, standard lens can be swapped. A bundled lens
 * has no separable price and removing its camera would remove the whole kit.
 */
export function lensUpgrade(candidate: RecommendationItem, selected: RecommendationItem[]): RecommendationItem | null {
  if (candidate.itemType !== "lens" || candidate.specs?.tier !== "premium") return null;
  // A two-lens offer at one focal is still two lenses, not a single swap.
  if ((candidate.components ?? []).some(c => c.qty > 1) || /\b[2-9]\d*\s*[x×]\s*|\bpair\b|\bdual\b|\btriple\b/i.test(candidate.title ?? "")) return null;
  const focal = lensFocals(candidate);
  if (focal.length !== 1) return null; // multi-lens sets are not a one-lens upgrade
  return selected.find(item => automaticLens(candidate, selected.filter(i => i !== item)) && item.itemType === "lens" && item.specs?.tier === "standard" &&
    lensFocals(item).length === 1 && lensFocals(item)[0] === focal[0] &&
    !!item.specs?.lensClass && item.specs.lensClass === candidate.specs?.lensClass) ?? null;
}
