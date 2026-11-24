type RentalProductListing = {
  slug: string;
  title: string;
  category: string;
  description?: string | null;
  knowledge?: { summary?: string | null } | null;
  gallery?: string[] | null;
  heroImage?: string | null;
  pricing?: { daily?: number | null } | null;
  bookable: boolean;
};

export function rentalProductJsonLd(listing: RentalProductListing, siteUrl: string) {
  const base = siteUrl.replace(/\/$/, "");
  const url = `${base}/gear/${listing.slug}`;
  const daily = listing.pricing?.daily;
  const hasDailyRate = typeof daily === "number" && Number.isFinite(daily) && daily > 0;
  const images = listing.gallery?.length ? listing.gallery : listing.heroImage ? [listing.heroImage] : [];
  const description = listing.description || listing.knowledge?.summary ||
    `Hire ${listing.title} in London. Select your dates to check rental availability.`;

  const product = {
    "@type": "Product",
    name: listing.title,
    category: listing.category,
    description,
    ...(images.length ? { image: images } : {}),
    ...(listing.bookable && hasDailyRate ? {
      offers: {
        "@type": "Offer",
        priceCurrency: "GBP",
        price: daily,
        businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
        seller: { "@id": `${base}/#organization` },
        priceSpecification: { "@type": "UnitPriceSpecification", price: daily, priceCurrency: "GBP", unitCode: "DAY" },
        url,
      },
    } : {}),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      product,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: base },
          { "@type": "ListItem", position: 2, name: "Gear", item: `${base}/gear` },
          { "@type": "ListItem", position: 3, name: listing.title, item: url },
        ],
      },
    ],
  };
}
