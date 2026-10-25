import { effectiveLensSpecs, filterThreadsFor } from "./opticalFacts";
import { bestCompat, parseMounts } from "../convex/lib/mount";
import { deriveItemType } from "../convex/lib/taxonomy";

/** Catalogue evidence shared by the basket, assembler and complementary picks.
 * Physical components identify aliases across accounts; documented contents
 * identify included lenses even when the listing's primary type is a body.
 * Optional/excluded contents never count as supplied equipment.
 */
export type RecommendationItem = {
  _id?: string; listingId?: string; title?: string; itemType?: string | null;
  marketingOnly?: boolean; displayOnly?: boolean;
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

/** Another offer can sell the very same physical lens or a subset of a kit. */
export function alreadySupplied(candidate: RecommendationItem, selected: RecommendationItem[]): boolean {
  if (selected.some(item => id(candidate) && id(candidate) === id(item))) return true;
  const components = candidate.components ?? [];
  if (components.length && selected.some(item => components.every(c =>
    (item.components ?? []).some(i => i.inventoryUnitId === c.inventoryUnitId && i.qty >= c.qty)))) return true;
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
  return !item.marketingOnly && !item.displayOnly && item.inventoryFacts?.owned !== false;
}

export function automaticLens(candidate: RecommendationItem, selected: RecommendationItem[]): boolean {
  const supplied = new Set(selected.flatMap(includedLensFocals));
  return rentableCandidate(candidate) && !alreadySupplied(candidate, selected) && !lensFocals(candidate).some(f => supplied.has(f)) && lensFit(candidate, selected) === "native";
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
export function automaticRecommendation(candidate: RecommendationItem, selected: RecommendationItem[], evidence: RecommendationItem[] = []): boolean {
  if (!rentableCandidate(candidate) || alreadySupplied(candidate, selected)) return false;
  if (candidate.itemType === "gimbal") return verifiedGimbalPair(candidate, selected, evidence);
  if (candidate.itemType === "lens") return automaticLens(candidate, selected);
  if (candidate.itemType === "camera-body") {
    const lenses = selected.filter(i => i.itemType === "lens");
    const bundled = new Set(includedLensFocals(candidate));
    return lenses.every(lens => lensFit(lens, [candidate]) === "native" && !lensFocals(lens).some(f => bundled.has(f)));
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
