export type RentalKitItem = {
  listingId?: string; title: string; qty?: number; heroImage?: string | null;
  imageSources?: string[]; lineTotal?: number; start?: number; end?: number;
};
/** Presentation only: preserve separate rental periods and every charged unit. */
export function groupRentalKit(items: RentalKitItem[]): RentalKitItem[] {
  const groups = new Map<string, RentalKitItem>();
  for (const item of items) {
    const key = JSON.stringify([item.listingId ?? item.title, item.start, item.end]);
    const prior = groups.get(key);
    if (prior) {
      prior.qty = (prior.qty ?? 1) + (item.qty ?? 1);
      if (item.lineTotal != null) prior.lineTotal = (prior.lineTotal ?? 0) + item.lineTotal;
      prior.imageSources = [...new Set([...(prior.imageSources ?? []), ...(item.imageSources ?? [])])];
    } else groups.set(key, { ...item });
  }
  return [...groups.values()];
}
export function uniqueKitPhotos(items: RentalKitItem[]): RentalKitItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const image = item.heroImage || item.imageSources?.[0];
    const key = image ? image.split("?")[0] : item.listingId ?? item.title;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
