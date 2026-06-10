import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { GUIDES } from "@/lib/guides";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Guides — camera & film gear hire tips",
  description:
    "Practical guides to renting cinema cameras, lenses and lighting in London — costs, kit lists and camera comparisons from Db Cinema Rentals.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-14">
        <PageHero eyebrow="Guides" lead="Shoot" accent="smarter" />
        <p className="mt-3 max-w-xl text-white/40">
          Straight-talking advice on renting the right gear for your shoot in London.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {GUIDES.map((g, i) => (
            <Reveal key={g.slug} delay={i * 60}>
              <Link
                href={`/guides/${g.slug}`}
                className="lift block h-full rounded-2xl glass gradient-border p-6"
              >
                <h2 className="font-display text-xl font-semibold text-white/90">{g.title}</h2>
                <p className="mt-2 text-sm text-white/45">{g.description}</p>
                <span className="mt-4 inline-block text-sm text-accent-400">Read guide →</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </main>
    </>
  );
}
