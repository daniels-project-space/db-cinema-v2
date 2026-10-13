import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Accordion } from "@/components/Accordion";
import { AskGaffer } from "@/components/gaffer/AskGaffer";
import {currentLegalVersion} from "@/lib/currentLegalVersion";
import {REFUNDABLE_DEPOSIT_LEGAL_VERSION} from "@/lib/legal";
export const dynamic="force-dynamic";
import { FAQS } from "@/lib/guides";

export const metadata: Metadata = {
  title: "FAQ — camera & film gear hire in London",
  description:
    "Answers on renting cinema cameras and lighting in London: delivery, deposits, insurance, rates, opening hours and booking changes.",
  alternates: { canonical: "/faq" },
};

export default async function FAQPage() {
  const cash=await currentLegalVersion()===REFUNDABLE_DEPOSIT_LEGAL_VERSION;
  const faqs=FAQS.map(f=>cash&&f.q==="What about deposits and insurance?"?{...f,a:"No deposit below £1,000 combined equipment replacement value; £50 from £1,000 to below £4,000; £100 at £4,000 or more. Unused deposit returns to the original card after return. Any retained amount and reason appear on your completion statement and reduce the same assessed loss and later card allowance. The existing 10% combined saved-card damage/late-fee permission remains. No extra card hold is placed. Identity and address checks and approval are required before handover. Existing bookings keep their accepted terms. "+f.a.slice(f.a.indexOf("These are security"))}:f);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />
      <main className="section-window mx-auto max-w-2xl px-6 py-14">
        <PageHero
          eyebrow="FAQ"
          lead="Questions,"
          accent="answered"
          sub="Renting, delivery, deposits and dates, all explained in plain English."
        />
        <div className="mt-10">
          <Accordion items={faqs} />
        </div>
        <AskGaffer
          className="mt-10"
          title="Not answered here?"
          blurb="Talk it through with Gaffer. Say what's gone wrong and it'll work out whether it's a settings issue, a fault, or something we need to sort at our end."
        />
        <div className="mt-8 text-center text-sm text-white/40">
          Still stuck?{" "}
          <Link href="/account" className="arrow-link text-accent-400 hover:text-accent-300">
            Message us in your account <span className="arrow">→</span>
          </Link>
        </div>
      </main>
    </>
  );
}
