function isPhotoSource(url: unknown): url is string {
  if (typeof url !== "string" || !(/^https:\/\//i.test(url) || /^\/(?!\/)/.test(url))) return false;
  try {
    const parsed = new URL(url, "https://dbcinemarentals.com");
    const format = parsed.searchParams.get("format") ?? parsed.searchParams.get("fm") ?? "";
    return !/\.svgz?$/i.test(parsed.pathname) && !/^image\/svg\+xml$/i.test(format);
  } catch {
    return false;
  }
}

export function listingRentalImages(listing: any): string[] {
  // Rental cards must show the same actual product photos as the public
  // listing. This preserves reviewed-image precedence and avoids using stale
  // imported variants when a listing has a corrected gallery.
  return listingImages(listing);
}

export function listingImages(listing: any): string[] {
  if (!listing) return [];
  // A reviewed replacement is the public gallery. Keep the imported originals
  // available for audit, but never leak them back into a rental/chat projection.
  const reviewedImages = Array.isArray(listing.reviewedImageUrls)
    ? listing.reviewedImageUrls.filter(isPhotoSource)
    : null;
  const imageGroups = reviewedImages === null
    ? [listing.r2Images, listing.sourceImages, listing.gallery]
    : listing.reviewedImageUrls.length === 0
      ? []
      : reviewedImages.length > 0
        ? [reviewedImages, listing.r2Images]
        : [listing.r2Images, listing.sourceImages, listing.gallery];
  return [...new Set<string>(
    imageGroups.flatMap((group) => Array.isArray(group) ? group : [])
      .filter(isPhotoSource),
  )];
}
