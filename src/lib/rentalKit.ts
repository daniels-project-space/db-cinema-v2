export type RentalKitItem = {
  listingId?: string; title: string; qty?: number; heroImage?: string | null;
  imageSources?: string[]; lineTotal?: number; start?: number; end?: number;
  pickupTime?: string | null; returnTime?: string | null;
};
/** Presentation only: preserve separate rental periods and every charged unit. */
export function groupRentalKit(items: RentalKitItem[]): RentalKitItem[] {
  const groups = new Map<string, RentalKitItem>();
  for (const item of items) {
    const key = JSON.stringify([item.listingId ?? item.title, item.start, item.end, item.pickupTime ?? null, item.returnTime ?? null]);
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
    const key = JSON.stringify([item.listingId ?? item.title, item.start, item.end, item.pickupTime ?? null, item.returnTime ?? null]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** One photo per catalogue listing in booking summaries, regardless of how
 * many separate rental periods the same listing has. Detailed rows still use
 * groupRentalKit so their independent dates, times and prices remain intact. */
export function groupRentalKitPhotos(items: RentalKitItem[]): RentalKitItem[] {
  const photos = new Map<string, RentalKitItem>();
  for (const item of groupRentalKit(items)) {
    const key = item.listingId ?? item.title;
    const prior = photos.get(key);
    if (!prior) {
      photos.set(key, { ...item });
      continue;
    }
    prior.qty = Math.max(prior.qty ?? 1, item.qty ?? 1);
    if (item.lineTotal != null) prior.lineTotal = (prior.lineTotal ?? 0) + item.lineTotal;
    prior.heroImage ??= item.heroImage;
    prior.imageSources = [...new Set([...(prior.imageSources ?? []), ...(item.imageSources ?? [])])];
  }
  return [...photos.values()];
}
