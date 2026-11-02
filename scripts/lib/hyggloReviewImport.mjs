const PROFILE_IMAGE_HOST = "hygglo.imgix.net";

function profileImageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== PROFILE_IMAGE_HOST || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeHyggloReview(review) {
  if (!Number.isSafeInteger(review?.id) || review.id <= 0) return null;
  if (review.rating !== 5) return null;
  if (typeof review.createdAt !== "string") return null;
  const date = Date.parse(review.createdAt);
  if (!Number.isFinite(date)) return null;

  const text = typeof review.text === "string" ? review.text.trim() : "";
  const authorImage = profileImageUrl(review.author?.profileImage?.fullSizeUrl);
  if (text.length <= 8 || !authorImage) return null;

  const product = review.product?.name;
  const listingSlug = review.productListing?.slug;

  return {
    hyggloReviewId: review.id,
    author: (review.author?.shortName ?? "Renter").trim() || "Renter",
    authorImage,
    rating: review.rating,
    sourceRating: review.rating,
    text,
    product: typeof product === "string" ? product.trim() || undefined : undefined,
    listingSlug: typeof listingSlug === "string" ? listingSlug : undefined,
    date,
  };
}

export async function verifyHyggloProfilePhoto(value, fetchImpl = globalThis.fetch) {
  const url = profileImageUrl(value);
  if (!url || typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchImpl(url, { method: "HEAD", redirect: "manual" });
    const contentType = response.headers?.get?.("content-type") ?? "";
    return response.status === 200 && /^image\//i.test(contentType);
  } catch {
    return false;
  }
}

export function parseAuthorizedHyggloExport(value) {
  if (!value || value.format !== "dbc-hygglo-authorized-export-v1" || value.source !== "hygglo" || !Array.isArray(value.reviews)) {
    throw new Error("Expected a dbc-hygglo-authorized-export-v1 JSON export.");
  }
  if (value.reviews.length > 10000) throw new Error("The authorized review export exceeds the 10,000-record safety limit.");
  return value.reviews;
}
