import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Accordion } from "@/components/Accordion";
import { AskGaffer } from "@/components/gaffer/AskGaffer";
import {currentLegalVersion} from "@/lib/currentLegalVersion";
import {REFUNDABLE_DEPOSIT_LEGAL_VERSION,ASSESSMENT_DEPOSIT_LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,SETUP_INTENT_LEGAL_VERSION} from "@/lib/legal";
export const dynamic="force-dynamic";
import { FAQS } from "@/lib/guides";

export const metadata: Metadata = {
  title: "FAQ — camera & film gear hire in London",
  description:
    "Answers on renting cinema cameras and lighting in London: delivery, deposits, insurance, rates, opening hours and booking changes.",
  alternates: { canonical: "/faq" },
};

export default async function FAQPage() {
  const version=await currentLegalVersion(),setupIntent=version===SETUP_INTENT_LEGAL_VERSION,cash=version===REFUNDABLE_DEPOSIT_LEGAL_VERSION,assessment=[ASSESSMENT_DEPOSIT_LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,"2026-10-v15","2026-10-v16"].includes(version);
  const faqs=FAQS.map(f=>setupIntent&&f.q==="What about deposits and insurance?"?{...f,a:"New rentals under the saved-card policy have no upfront deposit and reserve no card funds. The saved-card ceiling is £50 below £1,000 replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more. It applies only to evidenced, itemised late-return charges or severe permanent cosmetic damage or loss, with at least seven days to query a claim and collection attempted within 30 days after return. No claim is automatically charged for an on-time return without a reported issue. Insurance claims and excess are separate. Membership or a free trial does not itself grant a waiver or claim permission; the exact terms are accepted separately with each rental. Existing bookings keep their signed terms."}:assessment&&f.q==="What about deposits and insurance?"?{...f,a:"Standard refundable deposits are £20 below £1,000 combined equipment value, £50 from £1,000 to below £4,000 and £100 at £4,000 or more. No deposit waiver applies to a first rental. Below £4,000, a waiver requires either an active paid subscription after at least one successful recurring payment or the final Encore level recorded on the account; both also require the same account to have a previous rental with every item inspected as good and security fully settled. A trial or membership alone is not enough. No extra funds are blocked. A return with no claimed issue releases unused security automatically. Existing bookings retain their accepted terms."}:cash&&f.q==="What about deposits and insurance?"?{...f,a:"No deposit below £1,000 combined equipment replacement value; £50 from £1,000 to below £4,000; £100 at £4,000 or more. Unused deposit returns to the original card after return. Any retained amount and reason appear on your completion statement and reduce the same assessed loss and later card allowance. The existing 10% combined saved-card damage/late-fee permission remains. No extra card hold is placed. These are security arrangements, not an insurance purchase or liability cap. Own insurance is optional for currently declared company-owned or declared leased kit; DB’s contingent cover does not waive renter responsibility. Identity and address checks and approval are required before handover. Existing bookings keep their accepted terms."}:f);
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
