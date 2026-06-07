import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { guideBySlug, GUIDES } from "@/lib/guides";

const BASE = "https://dbcinemarentals.com";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) return { title: "Guide" };
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: `/guides/${slug}` },
    openGraph: { title: g.title, description: g.description, type: "article", url: `${BASE}/guides/${slug}` },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.description,
    author: { "@type": "Organization", name: "Db Cinema Rentals" },
    publisher: { "@type": "Organization", name: "Db Cinema Rentals" },
    mainEntityOfPage: `${BASE}/guides/${slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-14">
        <Link href="/guides" className="text-sm text-white/40 hover:text-white">← All guides</Link>
        <h1 className="mt-5 font-display text-4xl font-bold text-white/90">{g.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-white/50">{g.intro}</p>
        <div className="mt-8 space-y-8">
          {g.sections.map((s) => (
            <section key={s.h}>
              <h2 className="font-display text-xl font-semibold text-white/85">{s.h}</h2>
              <p className="mt-2 leading-relaxed text-white/55">{s.p}</p>
            </section>
          ))}
        </div>
        <div className="mt-12 rounded-2xl glass gradient-border p-6 text-center">
          <p className="font-display text-lg text-white/85">Ready to book your kit?</p>
          <Link href="/gear" className="mt-4 inline-block rounded-full bg-accent-500 px-7 py-3 font-medium text-white hover:bg-accent-600">
            Browse the catalogue
          </Link>
        </div>
      </main>
    </>
  );
}
