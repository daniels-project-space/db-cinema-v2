import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import {currentLegalVersion} from "@/lib/currentLegalVersion";
import { CancellationPolicyQuickGuide } from "@/components/CancellationPolicyQuickGuide";
export const dynamic="force-dynamic";
import { LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,SETUP_INTENT_LEGAL_VERSION,IMMEDIATE_CLAIM_LEGAL_VERSIONS } from "@/lib/legal";

import { LEGAL_DOCS as DOCS, LEGAL_ARCHIVE } from "../../../../shared/legalDocuments";
import { CURRENT_PRIVACY_NOTICE, CURRENT_PRIVACY_NOTICE_VERSION } from "../../../../shared/currentPrivacyNotice";
import { DELIVERY_ACCEPTANCE_TEXT, DELIVERY_TERMS_VERSION } from "../../../../shared/rentalAgreement";

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
  const selected=await searchParams;
  if (slug === "data-processing" && !selected.version) redirect("/legal/privacy");
  const version=selected.version??await currentLegalVersion();
  const isPrivacyPage = slug === "privacy";
  const currentPrivacy = slug === "privacy" && (!selected.version || selected.version === CURRENT_PRIVACY_NOTICE_VERSION);
  const deliveryTerms = slug === "delivery-disclaimer" && version === DELIVERY_TERMS_VERSION;
  const doc = currentPrivacy ? CURRENT_PRIVACY_NOTICE : deliveryTerms
    ? { title: "Delivery arrangements", updated: "October 2026", sections: [{ h: "Delivery", p: DELIVERY_ACCEPTANCE_TEXT }] }
    : version === LEGAL_VERSION ? DOCS[slug] : LEGAL_ARCHIVE[version]?.[slug];
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
          <p className="mt-2 font-mono text-xs text-white/30">Last updated {doc.updated} · {isPrivacyPage ? `Privacy notice ${currentPrivacy ? CURRENT_PRIVACY_NOTICE_VERSION : version}` : `Agreement version ${version}`}</p>
        </div>
{["cancellation", "terms"].includes(slug) && ["2026-10-v16",CANCELLATION_PROTECTION_LEGAL_VERSION,SETUP_INTENT_LEGAL_VERSION,...IMMEDIATE_CLAIM_LEGAL_VERSIONS].includes(version) && <CancellationPolicyQuickGuide version={version} />}
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
