import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import GearDetailClient from "./GearDetailClient";

const BASE = "https://dbcinemarentals.com";
const client = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const l: any = await client().query(api.catalog.getListingBySlug, { slug });
    if (!l) return { title: "Gear not found" };
    const daily = l.pricing?.daily;
    const title = `Rent ${l.title} in London`;
    const description = `Hire the ${l.title}${daily ? ` from £${daily}/day` : ""} in London — daily, 3-day & weekly rates, delivered. Verified gear from Db Cinema Rentals.`;
    const images = l.heroImage ? [l.heroImage] : [];
    return {
      title,
      description,
      alternates: { canonical: `/gear/${slug}` },
      openGraph: {
        title: `${title} | Db Cinema Rentals`,
        description,
        images,
        url: `${BASE}/gear/${slug}`,
        type: "website",
      },
      twitter: { card: "summary_large_image", title, description, images },
    };
  } catch {
    return { title: "Cinema gear rental in London" };
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let jsonLd: any = null;
  try {
    const l: any = await client().query(api.catalog.getListingBySlug, { slug });
    if (l) {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: l.title,
        category: l.category,
        image: l.gallery?.length ? l.gallery : l.heroImage ? [l.heroImage] : [],
        description: `Rent the ${l.title} in London from Db Cinema Rentals — daily, 3-day and weekly rates, delivered.`,
        brand: { "@type": "Brand", name: "Db Cinema Rentals" },
        offers: {
          "@type": "Offer",
          priceCurrency: "GBP",
          price: l.pricing?.daily ?? undefined,
          availability: "https://schema.org/InStock",
          url: `${BASE}/gear/${slug}`,
          priceValidUntil: "2027-12-31",
        },
      };
    }
  } catch {}
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <GearDetailClient slug={slug} />
    </>
  );
}
