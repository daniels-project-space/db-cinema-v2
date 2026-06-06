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
  "rental-agreement": {
    title: "Rental Agreement",
    updated: "June 2026 (v1)",
    sections: [
      { h: "1. Parties & equipment", p: "This agreement is between Db Cinema Rentals (\"Owner\") and the person named at checkout (\"Renter\") for the equipment listed in the booking, for the dates booked." },
      { h: "2. Possession & care", p: "The Renter takes possession of the equipment for the rental period and agrees to keep it secure, use it only for its intended purpose, and not sub-hire, sell, or take it outside the UK without written consent." },
      { h: "3. Return", p: "The Renter must return all equipment, cables, batteries and cases by the agreed return date/time in the condition supplied. Late returns are charged at the daily rate per extra day plus a late fee." },
      { h: "4. Loss & damage", p: "The Renter is responsible for loss, theft or damage occurring while the equipment is in their possession, up to the equipment's stated replacement value, subject to the Equipment Protection & Liability Policy and any applicable excess." },
      { h: "5. Identity & deposit", p: "The Renter agrees to complete identity verification and authorises the refundable damage deposit described in the Deposit Agreement before handover." },
      { h: "6. Liability", p: "The Owner's liability is limited to the value of the rental and excludes indirect or consequential loss (including lost footage or missed productions)." },
      { h: "7. Governing law", p: "Governed by the laws of England and Wales." },
      { h: "Draft notice", p: "Review-ready draft — have a qualified solicitor and your insurer review before go-live." },
    ],
  },
  "deposit-agreement": {
    title: "Refundable Deposit Agreement",
    updated: "June 2026 (v1)",
    sections: [
      { h: "1. Purpose", p: "A refundable damage deposit is taken to cover loss of, or damage to, the rented equipment. The amount is shown at checkout and corresponds to the equipment's risk/replacement value." },
      { h: "2. Hold & release", p: "The deposit is collected with payment and released back to the Renter after the equipment is returned and inspected in the condition supplied, normally within a few business days." },
      { h: "3. Deductions", p: "The Owner may deduct from the deposit the cost of repair, cleaning, missing accessories, late return fees, or replacement (up to the stated replacement value) for loss or damage attributable to the Renter." },
      { h: "4. Beyond the deposit", p: "Where loss or damage exceeds the deposit, the Renter remains liable for the balance up to the replacement value, subject to the Equipment Protection & Liability Policy." },
      { h: "5. Disputes", p: "The Owner will provide evidence (photos/invoices) for any deduction. Disputes are handled in good faith and under English law." },
      { h: "Draft notice", p: "Review-ready draft — confirm deposit handling with your payment processor and insurer." },
    ],
  },
  insurance: {
    title: "Equipment Protection & Liability Policy",
    updated: "June 2026 (v1)",
    sections: [
      { h: "1. Scope", p: "This policy sets out the Renter's responsibility for the equipment and the protection that applies during the rental period. It supplements, and does not replace, any insurance the Renter holds." },
      { h: "2. Renter responsibility", p: "While in the Renter's possession the equipment is at the Renter's risk. The Renter must take reasonable care, never leave equipment unattended in a public place or visible in a vehicle, and follow manufacturer guidance." },
      { h: "3. Cover & excess", p: "Accidental damage may be covered subject to an excess and to the equipment being used as intended. Loss, theft (without evidence of forced entry), water/sand damage, negligence and unauthorised use are excluded." },
      { h: "4. Claims & reporting", p: "The Renter must report any loss or damage immediately, and report theft to the police within 24 hours and provide a crime reference number. Failure to report promptly may void protection." },
      { h: "5. Renter liability", p: "The Renter remains liable for the applicable excess and for any loss/damage falling outside cover, up to the equipment's replacement value." },
      { h: "Draft notice", p: "IMPORTANT: This is illustrative wording only and is NOT a binding insurance contract. Final terms must reflect an actual underwritten policy reviewed by your insurer and solicitor before go-live." },
    ],
  },
  "data-processing": {
    title: "Data Processing Terms",
    updated: "June 2026 (v1)",
    sections: [
      { h: "1. Controller", p: "Db Cinema Rentals is the data controller for personal data collected to provide the rental service." },
      { h: "2. What we process", p: "Contact and booking details; delivery address; payment metadata (card data is handled by Stripe, never stored by us); and identity verification data processed by Stripe Identity to confirm who you are." },
      { h: "3. Identity verification", p: "Identity documents and biometric checks are processed by our verification provider (Stripe Identity) as processor. We receive only the verification result and limited metadata, not your raw documents, save as needed for fraud prevention and legal compliance." },
      { h: "4. Processors", p: "We use Stripe (payments + identity), Convex (application database), Vercel (hosting) and Cloudflare (media). Each processes data under contract on our instructions." },
      { h: "5. Lawful basis & retention", p: "We process data to perform the rental contract, comply with legal obligations, and our legitimate interest in preventing fraud. Records are retained only as long as necessary for legal and accounting purposes." },
      { h: "6. Your rights", p: "Under UK GDPR you may request access, correction, deletion or restriction. Contact us to exercise these rights or to raise a concern." },
      { h: "Draft notice", p: "Review-ready draft — confirm processor list and retention periods with your DPO/solicitor before go-live." },
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
