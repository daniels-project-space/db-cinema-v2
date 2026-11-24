type ListingImageInput = {
  image?: unknown;
  heroImage?: unknown;
  imageSources?: unknown;
  gallery?: unknown;
};

export function listingImageSources(listing: ListingImageInput | null | undefined): string[] {
  const sources = [
    listing?.image,
    listing?.heroImage,
    ...(Array.isArray(listing?.imageSources) ? listing.imageSources : []),
    ...(Array.isArray(listing?.gallery) ? listing.gallery : []),
  ];
  return [...new Set(sources.filter((source): source is string => typeof source === "string" && source.trim().length > 0))];
}
