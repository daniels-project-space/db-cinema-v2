import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { guideBySlug, GUIDES, type GuideVideo } from "@/lib/guides";
import { IconChevronLeft, IconArrowRight, IconCheck } from "@/components/icons";
import { AskGaffer } from "@/components/gaffer/AskGaffer";

import { SITE_URL as BASE } from "@/lib/site";

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

const anchor = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Privacy-friendly, lazy-loaded YouTube embed with an attributed caption. */
function VideoEmbed({ v }: { v: GuideVideo }) {
  return (
    <figure className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl shadow-black/40">
      <div className="relative aspect-video">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${v.id}?rel=0`}
          title={v.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <figcaption className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-white/45">
        <span className="truncate">
          <span className="text-white/65">{v.title}</span> · {v.author}
        </span>
        <a
          href={`https://www.youtube.com/watch?v=${v.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-accent-400 hover:underline"
        >
          Watch on YouTube ↗
        </a>
      </figcaption>
    </figure>
  );
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) notFound();

  const firstVideo = g.sections.find((s) => s.video)?.video;
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.description,
    articleSection: g.category,
    author: { "@type": "Organization", name: "Db Cinema Rentals" },
    publisher: { "@type": "Organization", name: "Db Cinema Rentals" },
    mainEntityOfPage: `${BASE}/guides/${slug}`,
  };
  if (firstVideo) {
    jsonLd.video = {
      "@type": "VideoObject",
      name: firstVideo.title,
      description: g.description,
      thumbnailUrl: `https://i.ytimg.com/vi/${firstVideo.id}/hqdefault.jpg`,
      contentUrl: `https://www.youtube.com/watch?v=${firstVideo.id}`,
      embedUrl: `https://www.youtube.com/embed/${firstVideo.id}`,
    };
  }

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
          <div className="hud-label mt-7 !text-accent-400/90">{g.category}</div>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">{g.title}</h1>
          <p className="serif-accent mt-5 text-xl leading-relaxed text-white/60 sm:text-2xl">{g.intro}</p>
        </div>

        {/* quick takeaways */}
        {g.takeaways && g.takeaways.length > 0 && (
          <div className="mt-8 rounded-2xl border border-accent-400/20 bg-accent-500/[0.05] p-5">
            <div className="hud-label !text-accent-400/90">Quick tips</div>
            <ul className="mt-3 space-y-2">
              {g.takeaways.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm leading-relaxed text-white/70">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* in this guide */}
        {g.sections.length > 2 && (
          <nav className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="hud-label !text-white/45">In this guide</div>
            <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {g.sections.map((s, i) => (
                <li key={s.h}>
                  <a href={`#${anchor(s.h)}`} className="text-sm text-white/55 transition-colors hover:text-accent-300">
                    <span className="font-mono text-xs text-white/30">{String(i + 1).padStart(2, "0")}</span> {s.h}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="mt-10 space-y-9">
          {g.sections.map((s, i) => (
            <Reveal key={s.h} delay={Math.min(i, 3) * 60}>
              <section id={anchor(s.h)} className="relative scroll-mt-24 border-l border-white/[0.07] pl-5">
                <span className="absolute -left-px top-1 h-5 w-px bg-accent-400" aria-hidden />
                <h2 className="font-display text-xl font-semibold text-white/85">{s.h}</h2>
                <p className="mt-2.5 leading-relaxed text-white/55">{s.p}</p>
                {s.video && <VideoEmbed v={s.video} />}
                {s.tips && s.tips.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {s.tips.map((t) => (
                      <li key={t} className="flex items-start gap-2.5 text-sm leading-relaxed text-white/60">
                        <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </Reveal>
          ))}
        </div>
        {/* topic = the guide's real title, so Gaffer opens the call already
            knowing which setup it's walking them through */}
        <AskGaffer
          className="mt-12"
          title="Want this walked through out loud?"
          blurb="Gaffer can take you through it hands-free, one step at a time — handy when both of yours are holding the rig."
          topic={g.title}
        />
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
