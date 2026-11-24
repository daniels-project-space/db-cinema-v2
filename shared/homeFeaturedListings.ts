type ListingDescriptor = {
  title: string;
  category?: string | null;
  itemType?: string | null;
};

const isCamera = (listing: ListingDescriptor) =>
  listing.itemType === "camera-body" || listing.category === "Cameras" ||
  (listing.category === "Packages" && /camera|body|set|kit|komodo|venice|v-?raptor/i.test(listing.title));

const spotlightGroups = [
  { matches: (listing: ListingDescriptor) => /\bvenice\b/i.test(listing.title) && isCamera(listing), limit: 2 },
  { matches: (listing: ListingDescriptor) => /\borion\b/i.test(listing.title) && (listing.itemType === "lens" || listing.category === "Lenses"), limit: 2 },
  { matches: (listing: ListingDescriptor) => /\bred\b/i.test(listing.title) && isCamera(listing), limit: 2 },
] as const;

export function selectHomeFeaturedListings<T extends ListingDescriptor>(rankedListings: T[], limit: number): T[] {
  const maximum = Math.max(0, Math.trunc(limit));
  if (maximum === 0) return [];

  const selected = new Set<T>();
  const candidates = spotlightGroups.map(group => rankedListings.filter(group.matches).slice(0, group.limit));
  const maximumRounds = Math.max(0, ...candidates.map(group => group.length));
  for (let round = 0; round < maximumRounds && selected.size < maximum; round++) {
    for (const group of candidates) {
      const listing = group[round];
      if (listing && selected.size < maximum) selected.add(listing);
    }
  }
  for (const listing of rankedListings) {
    if (selected.size >= maximum) break;
    selected.add(listing);
  }
  return [...selected];
}
