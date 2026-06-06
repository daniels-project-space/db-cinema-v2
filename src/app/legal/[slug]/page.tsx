import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Doc = { title: string; updated: string; sections: { h: string; p: string }[] };

const DOCS: Record<string, Doc> = {
  terms: {
    title: "Terms & Conditions",
    updated: "June 2026",
    sections: [
      { h: "1. About us", p: "Db Cinema Rentals (\"we\", \"us\") hires professional film and photography equipment to customers in the UK. By using this site or placing a booking you agree to these terms." },
      { h: "2. Bookings", p: "A booking is confirmed once payment is taken. You are responsible for ensuring the rental dates and equipment are correct before paying. We reserve the right to decline or cancel a booking where stock is unavailable or identity/payment cannot be verified." },
      { h: "3. Pricing & payment", p: "All prices are in GBP and include applicable discounts for multi-day rentals. Payment, including any refundable deposit, is taken at checkout via our payment processor (Stripe). We do not store your card details." },
      { h: "4. Use of equipment", p: "Equipment must be used lawfully and only for its intended purpose. You must not sub-hire, modify, or take equipment outside the UK without written consent." },
      { h: "5. Liability", p: "Our liability for any loss is limited to the value of the rental. We are not liable for indirect or consequential loss, including lost footage or missed productions." },
      { h: "6. Governing law", p: "These terms are governed by the laws of England and Wales." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  "rental-terms": {
    title: "Rental Terms",
    updated: "June 2026",
    sections: [
      { h: "1. Rental period", p: "The rental period runs from the agreed pickup/delivery date to the agreed return date inclusive. Late returns are charged at the daily rate per day plus a late fee." },
      { h: "2. Deposit", p: "A refundable damage deposit is taken at checkout and released after the equipment is returned and inspected in its original condition." },
      { h: "3. Condition & care", p: "You must return equipment clean, complete (all cables, batteries, cases) and in the condition supplied. Loss or damage will be charged against the deposit, up to the equipment's replacement value." },
      { h: "4. Identity & agreement", p: "For higher-value gear we may require ID verification and a signed rental agreement before handover." },
      { h: "5. Collection & delivery", p: "Pickup is from our London location during agreed hours. Local delivery is available within our service radius for a fee shown at checkout." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "June 2026",
    sections: [
      { h: "1. What we collect", p: "We collect the information you give us when booking — name, email, phone, delivery address — and booking history. Payments are processed by Stripe; we never see your full card number." },
      { h: "2. How we use it", p: "To process bookings, arrange fulfilment, provide support, send booking-related messages, and meet legal obligations." },
      { h: "3. Sharing", p: "We share data only with processors needed to run the service (e.g. payment and email providers) and where required by law. We do not sell your data." },
      { h: "4. Your rights", p: "Under UK GDPR you can request access to, correction of, or deletion of your data. Contact us to exercise these rights." },
      { h: "5. Retention", p: "We keep booking records only as long as necessary for legal and accounting purposes." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  cancellation: {
    title: "Cancellation & Refund Policy",
    updated: "June 2026",
    sections: [
      { h: "Free cancellation", p: "Cancel more than 7 days before the rental start date for a full refund of the rental fee." },
      { h: "Partial refund", p: "Cancel between 2 and 7 days before the start date for a 50% refund of the rental fee." },
      { h: "No refund", p: "Cancellations within 48 hours of the rental start date are non-refundable." },
      { h: "Deposit", p: "The refundable damage deposit is always returned in full on cancellation." },
      { h: "How to cancel", p: "Contact us with your booking email to request a cancellation." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-white/90">
          {doc.title}
        </h1>
        <p className="mt-1 text-xs text-white/30">Last updated {doc.updated}</p>
        <div className="mt-8 flex flex-col gap-6">
          {doc.sections.map((s, i) => (
            <section key={i}>
              <h2 className="font-display text-lg font-semibold text-white/80">
                {s.h}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-white/50">{s.p}</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
