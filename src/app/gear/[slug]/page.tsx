import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicListing } from "@/lib/discovery";
import GearDetailClient from "./GearDetailClient";
import { SITE_URL as BASE } from "@/lib/site";
import { rentalProductJsonLd } from "@/../shared/rentalProductJsonLd";

export const dynamic = "force-dynamic";

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
    const description = `Rent ${l.title} in London. Check dates and current rental rates; collection and local delivery options are shown during booking.`;
    const images = l.heroImage ? [l.heroImage] : [];
    return {
      title,
      description,
      robots:{index:process.env.NEXT_PUBLIC_SITE_LIVE === "true" && !!l.bookable,follow:process.env.NEXT_PUBLIC_SITE_LIVE === "true"},
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
    return { title: "Cinema gear rental in London", robots: { index: false, follow: false } };
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
  const jsonLd = rentalProductJsonLd(l, BASE);
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
