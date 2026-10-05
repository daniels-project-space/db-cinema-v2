import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { LEGAL_VERSION } from "@/lib/legal";

import { LEGAL_DOCS as DOCS, LEGAL_ARCHIVE } from "../../../../shared/legalDocuments";

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export default async function LegalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{version?:string}>;
}) {
  const { slug } = await params;
  const {version=LEGAL_VERSION}=await searchParams;
  const doc = version === LEGAL_VERSION ? DOCS[slug] : LEGAL_ARCHIVE[version]?.[slug];
  if (!doc) notFound();
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-12">
        <div className="page-in">
          <div className="hud-label !text-accent-400/90">Legal</div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {doc.title}
          </h1>
          <p className="mt-2 font-mono text-xs text-white/30">Last updated {doc.updated} · Agreement version {version}</p>
        </div>
        <div className="mt-10 flex flex-col gap-7">
          {doc.sections.map((s, i) => (
            <section key={i} className="relative border-l border-white/[0.07] pl-5">
              <span className="absolute -left-px top-1 h-4 w-px bg-accent-400/70" aria-hidden />
              <h2 className="font-display text-lg font-semibold text-white/80">
                {s.h}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-white/50">{s.p}</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
