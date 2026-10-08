/** Explicit marketing-only models from rental-manager's pricing-catalog.ts and
 * marketing-redirects.ts; verified against RMv2 items:listActive 2026-10-06.
 * hygglo_products.isMarketingOnly also marks owned kits, so cannot be used here.
 * The now-owned DZOFilm Vespid set supersedes its historical marketing redirect.
 * Storefront selection is deliberately independent of checkout eligibility.
 */
import { deriveItemType } from "./taxonomy";
const redirects: { match: RegExp; types: string[]; alternative: RegExp }[] = [
  { match: /\bx100\s*vi\b/i, types: ["camera-body", "accessory"], alternative: /\ba7[ -]?(v|5)\b/i },
  { match: /\bmackie\s*thump\s*go\b/i, types: ["speaker"], alternative: /\b(jbl|speaker)\b/i },
  { match: /\b(aputure\s*mc\s*pro|aputure\s*light\s*dome)\b/i, types: ["light"], alternative: /\b(tube|softbox)\b/i },
  { match: /\b7artisans\s*7[.,]5\s*mm\b|\bcanon\s*8[ -]?15.*fisheye/i, types: ["lens"], alternative: /\b11\s*mm\b/i },
  { match: /\bfx[ -]?6\b/i, types: ["camera-body"], alternative: /\bfx[ -]?3\b/i },
  { match: /\ba7s[ -]?(iii|3)\b/i, types: ["camera-body"], alternative: /\ba7[ -]?(v|5)\b/i },
  { match: /\bcan+on\s*(r5|c70)\b/i, types: ["camera-body"], alternative: /\b(fx[ -]?3|a7[ -]?(v|5))\b/i },
  { match: /\bkomodo\b|\bpyxis\b/i, types: ["camera-body"], alternative: /\b(bmpcc|blackmagic|pocket cinema).*6k/i },
  { match: /\bronin\s*4d\b/i, types: ["camera-body", "gimbal"], alternative: /\bfx[ -]?3\b/i },
  { match: /\bsony\s*a1\b|\bpanasonic\s*s5\s*(ii|2)\b/i, types: ["camera-body"], alternative: /\ba7[ -]?(v|5)\b/i },
  { match: /\b(venice|alexa|amira|fx[ -]?30|a7[ -]?(iv|4)|a7r\w*|x100\s*vi|bmpcc\s*4k|bmpcc4k)\b/i, types: ["camera-body"], alternative: /\bfx[ -]?3\b|\b(bmpcc|blackmagic).*6k/i },
  { match: /\b(air\s*3|inspire\s*3|mavic\s*4)\b/i, types: ["drone"], alternative: /\bmavic\s*3\s*pro\b/i },
  { match: /\b(aputure\b.{0,80}\b(?:600\s*[dxc]|300\s*[dx])|amaran\s*300c|(?:nanlite\s*)?(?:forza\s*)60c)\b/i, types: ["light"], alternative: /\bnanlite.*(forza\s*300|500b)\b/i },
  { match: /\b(rs[ -]?4\s*pro|tilta\s*float)\b/i, types: ["gimbal", "accessory"], alternative: /\brs[ -]?3\s*pro\b/i },
  { match: /\bsennheiser\s*ew\s*500\b|\brode\s*wireless\s*go\s*(ii|2)\b/i, types: ["wireless-mic"], alternative: /\brode.*(wireless|mic).*pro\b/i },
  { match: /\bntg[ -]?5\b/i, types: ["boom-mic"], alternative: /\bsennheiser\b/i },
  { match: /\bsigma\s*(?:art\s*)?24[ -]?70(?:\s*mm)?\b/i, types: ["lens"], alternative: /\bsony\b.*24[ -]?70/i },
  { match: /\b135\s*mm.*f\s*1[.,]8\b/i, types: ["lens"], alternative: /\b90\s*mm\b/i },
  { match: /\b50\s*mm.*f\s*1[.,]2\b|\b35\s*mm.*f\s*1[.,]4\b/i, types: ["lens"], alternative: /24[ -]?70/i },
  { match: /\b14\s*mm.*f\s*1[.,]8\b|\bsigma\s*14[ -]?24(?:\s*mm)?\b|\bsony\b.*12[ -]?24/i, types: ["lens"], alternative: /16[ -]?35/i },
  { match: /\b(great\s*joy|zeiss\s*prime)\b/i, types: ["lens"], alternative: /\b(blazar|remus)\b/i },
  { match: /\bcanon\s*rf\s*24[ -]?70/i, types: ["lens"], alternative: /\bcanon\s*ef\s*24[ -]?105/i },
  { match: /\bsmallhd\s*cine\s*7\b/i, types: ["monitor"], alternative: /\batomos\s*ninja\b/i },
  { match: /\bxdj[ -]?rx2\b/i, types: ["dj-deck"], alternative: /\brx3\b/i },
];
export function marketingRedirect(listing: { title: string; itemType?: string | null }) {
  if (!listing.title) return undefined;
  const type = listing.itemType ?? deriveItemType(listing.title);
  const title = listing.title.replace(/[–—−]/g, "-");
  // Owned Nanlite kits use competitor names in SEO comparison text. Their
  // advertised primary model, rather than a comparison, owns classification.
  if (type === "light" && /^(?:\d+\s*[x×]\s*)?nanlite\s*(?:forza\s*300\b|500\b|500b\b|pavotube\b)/i.test(title)) return undefined;
  const advertised = title.split(/\b(?:like|similar to|equivalent to|compatible with|same sensor as|same as)\b/i)[0];
  return redirects.find(r => r.types.includes(type) && r.match.test(advertised));
}
type MarketingListing = { title: string; itemType?: string | null; marketingOnly?: boolean; marketingOnlySource?: "auto" | "admin"; marketingOnlyUpdatedAt?: number };
export function isMarketingOnly(listing: MarketingListing) {
  if (listing.marketingOnlySource === "admin") return !!listing.marketingOnly;
  return !!listing.marketingOnly || !!marketingRedirect(listing);
}
/** Catalog imports classify new models without overwriting an owner's choice. */
export function automaticMarketingFields(listing: MarketingListing, existing?: MarketingListing | null) {
  if (existing?.marketingOnlySource === "admin") return {};
  const marketingOnly = !!marketingRedirect(listing);
  if (existing?.marketingOnlySource === "auto" && existing.marketingOnly === marketingOnly) return {};
  return { marketingOnly, marketingOnlySource: "auto" as const, marketingOnlyUpdatedAt: Math.max(Date.now(), (existing?.marketingOnlyUpdatedAt ?? 0) + 1) };
}
export function rentalUnavailable(listing: MarketingListing & { active?: boolean; suppressed?: boolean; stockMappingStatus?: string }) {
  return !listing.active || !!listing.suppressed || isMarketingOnly(listing) ||
    (listing.stockMappingStatus !== undefined && listing.stockMappingStatus !== "complete");
}
