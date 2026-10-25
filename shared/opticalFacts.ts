/** Manufacturer facts checked 25 October 2026. Match actual supplied models,
 * not the camera brand or a generic focal-length-to-filter-size table.
 */
export const OPTICAL_SOURCES = {
  gm2470: "https://www.sony.co.uk/electronics/interchangeable-lenses/sel2470gm",
  gm1635: "https://www.sony.co.uk/electronics/support/lenses-e-mount-lenses/sel1635gm/specifications",
  gm70200: "https://www.sony.co.uk/electronics/interchangeable-lenses/sel70200gm/specifications",
  sony2870: "https://www.sony.co.uk/electronics/camera-lenses/sel2870",
  sony90: "https://www.sony.co.uk/electronics/support/lenses-e-mount-lenses/sel90m28g/specifications",
  canonEF: "https://www.canon.co.uk/store/buying-guides/how-to-read-canon-lens/",
  canon24105: "https://www.usa.canon.com/support/p/ef-24-105mm-f-4l-is-usm",
};
export type OpticalSpecs = {
  mount?: string | null; coverage?: string | null; filterThreadMm?: number | null;
  batteryType?: string | null; includesLens?: boolean | null; lensFocal?: string | null;
  tier?: string | null; lensClass?: string | null; hasAutofocus?: boolean | null;
};
type Item = { itemType?: string | null; title?: string | null; specs?: OpticalSpecs | null;
  inventoryFacts?: { contents?: string[] } | null; rentalContents?: { included?: string[] } | null };
type Fact = { mount: string; coverage: string; thread?: number };

export function opticalModels(item: Item): Fact[] {
  const current = item.inventoryFacts?.contents?.filter(text => /lens|\bgm\b|g[ -]?master|\bsony fe\b|\bcanon ef\b/i.test(text)) ?? [];
  const older = item.rentalContents?.included?.filter(text => /lens|\bgm\b|g[ -]?master|\bsony fe\b|\bcanon ef\b/i.test(text)) ?? [];
  const texts = current.length ? current : older.length ? older : item.itemType === "lens" ? [item.title ?? ""] : [];
  return texts.flatMap(text => {
    const value = text.toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ");
    const name = value.replace(/^\d+\s*[x×]?\s*/, "");
    const sonyFE = /^sony\s+(?:fe\b|.*\bg[ -]?master\b|.*\bgm\b)/.test(name);
    if (sonyFE && !/\bcanon\b|\bsigma\b|\btamron\b/.test(name)) {
      const gm = /\bgm\b|\bg[ -]?master\b/.test(name);
      // Owner records identify original GMs. New/unidentified generations do
      // not inherit a filter diameter just because they share a focal range.
      const original = /\boriginal\b|\bsel(?:2470|1635|70200)gm\b/.test(name) && !/\b(?:ii|iii|iv)\b|gm[234]\b/.test(name);
      const range = /\b(16-35|24-70|70-200)\s*mm\b/.exec(name)?.[1];
      if (gm && range) return [{ mount: "E", coverage: "ff", ...(original ? { thread: range === "70-200" ? 77 : 82 } : {}) }];
      if (/\b28-70\s*mm\b/.test(name) && /3\.5\s*-\s*5\.6/.test(name)) return [{ mount: "E", coverage: "ff", thread: 55 }];
      if (/\b90\s*mm\b/.test(name) && /\bmacro\b/.test(name) && /2\.8/.test(name)) return [{ mount: "E", coverage: "ff", thread: 62 }];
      return [{ mount: "E", coverage: "ff" }];
    }
    if (/^canon\s+ef\b/.test(name) && !/^canon\s+ef[- ]?[sm]\b/.test(name)) {
      const known24105 = /24-105\s*mm/.test(name) && /f\s*\/?\s*4\b/.test(name) && !/\b(?:iii|iv)\b/.test(name);
      return [{ mount: "EF", coverage: "ff", ...(known24105 ? { thread: 77 } : {}) }];
    }
    return [];
  });
}

export function filterThreadsFor(item: Item): number[] {
  if (item.itemType === "nd-filter") return item.specs?.filterThreadMm ? [item.specs.filterThreadMm] : [];
  const models = opticalModels(item);
  if (models.length) return [...new Set(models.flatMap(model => model.thread ? [model.thread] : []))];
  // An explicit filter-thread measurement is usable; a legacy generic prime/
  // GM heuristic is not. Unknown models remain selectable with a fit warning.
  const explicit = /\b(\d{2,3})\s*mm\s*(?:filter\s*thread|thread)\b/i.exec(item.title ?? "");
  return explicit ? [Number(explicit[1])] : [];
}

export function effectiveLensSpecs(item: Item): OpticalSpecs | null {
  if (item.itemType !== "lens") return item.specs ?? null;
  const models = opticalModels(item), threads = filterThreadsFor(item);
  const mounts = new Set(models.map(model => model.mount)), coverage = new Set(models.map(model => model.coverage));
  return { ...item.specs, ...(!item.specs?.mount && mounts.size === 1 ? { mount: [...mounts][0] } : {}),
    ...(!item.specs?.coverage && coverage.size === 1 ? { coverage: [...coverage][0] } : {}), filterThreadMm: threads.length === 1 ? threads[0] : null };
}
