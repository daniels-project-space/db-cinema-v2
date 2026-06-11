import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { guideBySlug, GUIDES } from "@/lib/guides";
import { IconChevronLeft, IconArrowRight } from "@/components/icons";

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
        <Link
          href="/guides"
          className="group inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white"
        >
          <IconChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          All guides
        </Link>
        <div className="page-in">
          <div className="hud-label mt-7 !text-accent-400/90">Field guide</div>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">{g.title}</h1>
          <p className="serif-accent mt-5 text-xl leading-relaxed text-white/60 sm:text-2xl">{g.intro}</p>
        </div>
        <div className="mt-10 space-y-9">
          {g.sections.map((s, i) => (
            <Reveal key={s.h} delay={Math.min(i, 3) * 60}>
              <section className="relative border-l border-white/[0.07] pl-5">
                <span className="absolute -left-px top-1 h-5 w-px bg-accent-400" aria-hidden />
                <h2 className="font-display text-xl font-semibold text-white/85">{s.h}</h2>
                <p className="mt-2.5 leading-relaxed text-white/55">{s.p}</p>
              </section>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-14">
          <div className="spot gradient-border rounded-2xl p-7 text-center">
            <p className="serif-accent text-2xl text-white/85">Ready to book your kit?</p>
            <Link href="/gear" className="btn-primary mt-5 px-7 py-3">
              Browse the catalogue
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </main>
    </>
  );
}
