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
  const version=await currentLegalVersion(),cash=version===REFUNDABLE_DEPOSIT_LEGAL_VERSION,assessment=["2026-10-v15","2026-10-v16"].includes(version);
  const faqs=FAQS.map(f=>assessment&&f.q==="What about deposits and insurance?"?{...f,a:"Refundable deposits start at £20 below £1,000 combined equipment value, £50 from £1,000 to below £4,000 and £100 from £4,000. Eligible active members/subscribers and verified Encore renters have no cash deposit. A return without issues automatically refunds unused deposit to the original card. Stripe saves a card for evidenced damage, loss and late-fee payments after an itemised notice and review period. Retained deposit reduces the same assessment. ID and address checks must be approved before handover. Existing bookings retain their accepted terms."}:cash&&f.q==="What about deposits and insurance?"?{...f,a:"No deposit below £1,000 combined equipment replacement value; £50 from £1,000 to below £4,000; £100 at £4,000 or more. Unused deposit returns to the original card after return. Any retained amount and reason appear on your completion statement and reduce the same assessed loss and later card allowance. The existing 10% combined saved-card damage/late-fee permission remains. No extra card hold is placed. Identity and address checks and approval are required before handover. Existing bookings keep their accepted terms. "+f.a.slice(f.a.indexOf("These are security"))}:f);
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
