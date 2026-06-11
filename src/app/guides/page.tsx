import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { GUIDES } from "@/lib/guides";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight } from "@/components/icons";

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
        <PageHero
          eyebrow="Guides"
          lead="Shoot"
          accent="smarter"
          sub="Straight-talking advice on renting the right gear for your shoot in London."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {GUIDES.map((g, i) => (
            <Reveal key={g.slug} delay={i * 70}>
              <Link
                href={`/guides/${g.slug}`}
                className="lift spot gradient-border group relative block h-full overflow-hidden rounded-2xl p-6"
              >
                <span className="font-poster pointer-events-none absolute -right-2 -top-4 text-7xl text-white/[0.05] transition-colors group-hover:text-accent-400/15" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="hud-label !text-accent-400/80">Guide {String(i + 1).padStart(2, "0")}</span>
                <h2 className="mt-3 font-display text-xl font-semibold text-white/90 transition-colors group-hover:text-white">
                  {g.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/45">{g.description}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent-400">
                  Read guide
                  <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </main>
    </>
  );
}
