import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { GUIDES, GUIDE_CATEGORIES } from "@/lib/guides";
import { AskGaffer } from "@/components/gaffer/AskGaffer";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight } from "@/components/icons";

export const metadata: Metadata = {
  title: "Guides — camera & film gear hire tips",
  description:
    "Practical guides to renting cinema cameras, lenses and lighting in London — plus how-to videos on balancing gimbals, setting up drones, ND filters, audio and lighting.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  let n = 0;
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-14">
        <PageHero
          eyebrow="Guides"
          lead="Shoot"
          accent="smarter"
          sub="Straight-talking advice on renting the right gear — and how-to videos for getting the most out of it."
        />

        <AskGaffer
          className="mt-8"
          title="Stuck on set right now?"
          blurb="Skip the reading. Tell Gaffer which bit of kit you're wrestling with and it'll talk you through the setup step by step."
        />

        {GUIDE_CATEGORIES.map((cat) => {
          const guides = GUIDES.filter((g) => g.category === cat);
          if (guides.length === 0) return null;
          return (
            <section key={cat} className="mt-12 first:mt-10">
              <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white/85">
                <span className="hud-label !text-accent-400/90">{cat}</span>
                <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
              </h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {guides.map((g, i) => {
                  n += 1;
                  const hasVideo = g.sections.some((s) => s.video);
                  return (
                    <Reveal key={g.slug} delay={i * 70}>
                      <Link
                        href={`/guides/${g.slug}`}
                        className="lift spot gradient-border group relative block h-full overflow-hidden rounded-2xl p-6"
                      >
                        <span className="font-poster pointer-events-none absolute -right-2 -top-4 text-7xl text-white/[0.05] transition-colors group-hover:text-accent-400/15" aria-hidden>
                          {String(n).padStart(2, "0")}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="hud-label !text-accent-400/80">Guide {String(n).padStart(2, "0")}</span>
                          {hasVideo && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-accent-400/30 bg-accent-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-300">
                              <span aria-hidden>▶</span> Video
                            </span>
                          )}
                        </div>
                        <h3 className="mt-3 font-display text-xl font-semibold text-white/90 transition-colors group-hover:text-white">
                          {g.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-white/45">{g.description}</p>
                        <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent-400">
                          Read guide
                          <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </span>
                      </Link>
                    </Reveal>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
