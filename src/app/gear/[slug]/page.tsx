import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicListing } from "@/lib/discovery";
import GearDetailClient from "./GearDetailClient";
import { SITE_URL as BASE } from "@/lib/site";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const l: any = await publicListing(slug);
    if (!l) return { title: "Gear not found",robots:{index:false,follow:true} };
    const daily = l.pricing?.daily;
    const title = `Rent ${l.title} in London`;
    const description = `Hire the ${l.title}${daily ? ` from £${daily}/day` : ""} in London — daily, 3-day & weekly rates, delivered. Verified gear from Db Cinema Rentals.`;
    const images = l.heroImage ? [l.heroImage] : [];
    return {
      title,
      description,
      robots:{index:l.bookable,follow:true},
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
  const l=await publicListing(slug);
  if(!l)notFound();
  const jsonLd = {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Product",
            name: l.title,
            category: l.category,
            image: l.gallery?.length ? l.gallery : l.heroImage ? [l.heroImage] : [],
            description: l.description ?? l.knowledge?.summary ?? `Hire ${l.title} in London. Select your dates for rental availability.`,

            offers: {
              "@type": "Offer",
              priceCurrency: "GBP",
              price: l.pricing?.daily ?? undefined,
              businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
              seller:{"@id":`${BASE}/#organization`},
              ...(!l.bookable?{availability:"https://schema.org/OutOfStock"}:{}),
              priceSpecification:{"@type":"UnitPriceSpecification",price:l.pricing.daily,priceCurrency:"GBP",unitCode:"DAY"},
              url: `${BASE}/gear/${slug}`,

            },
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: BASE },
              { "@type": "ListItem", position: 2, name: "Gear", item: `${BASE}/gear` },
              { "@type": "ListItem", position: 3, name: l.title, item: `${BASE}/gear/${slug}` },
            ],
          },
        ],
  };
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g,"\\u003c") }}
        />
      )}
      <GearDetailClient slug={slug} initialListing={l} />
    </>
  );
}
