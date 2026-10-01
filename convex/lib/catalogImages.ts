/** Keep real source alternatives so a failed migrated image can recover. */
export function listingImages(listing: any): string[] {
  if (!listing) return [];
  return [...new Set<string>(
    [listing.r2Images, listing.sourceImages, listing.gallery]
      .flatMap((group) => Array.isArray(group) ? group : [])
      .filter((url): url is string => typeof url === "string" &&
        (/^https:\/\//i.test(url) || /^\/(?!\/)/.test(url))),
  )];
}
