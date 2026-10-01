import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { CANCELLATION_CREDIT_DAYS, CANCELLATION_FULL_REFUND_DAYS } from "@/lib/cancellationPolicy";
import { LEGAL_VERSION } from "@/lib/legal";

type Doc = { title: string; updated: string; sections: { h: string; p: string }[] };

const DOCS: Record<string, Doc> = {
  terms: {
    title: "Terms & Conditions",
    updated: "September 2026",
    sections: [
      { h: "1. About us", p: "Db Cinema Rentals (\"we\", \"us\") hires professional film and photography equipment to customers in the UK. By using this site or placing a booking you agree to these terms." },
      { h: "2. Bookings", p: "A booking is confirmed once payment is taken. You are responsible for ensuring the rental dates and equipment are correct before paying. We reserve the right to decline or cancel a booking where stock is unavailable or identity/payment cannot be verified." },
      { h: "3. Pricing & payment", p: "All prices are in GBP. At checkout you pay the rental price and ordinarily a refundable security payment equal to 50% of the displayed card-hold amount. An active membership with a confirmed paid billing period waives that upfront security payment; the free trial does not. An authenticated account with a safely completed, fully settled previous rental of the same exact item set and quantities may also qualify. The confirmed checkout quote states any waiver. We also request a separate card authorisation for the full displayed hold amount. The hold is not a charge and reduces available card funds while active. Your bank may decline it or require further authentication. We do not store your full card number." },
      { h: "3A. Later charges", p: "By signing at checkout, you separately agree to documented late rental time at the booked item daily rate, and to documented missing items, damage or insurance excess owed under the Rental Agreement. After itemised notice, an unused active security hold may be captured toward a late fee if no damage amount is due; any balance may be attempted as a new saved-card transaction. We will never collect the same amount twice. A new card transaction may be declined or require authentication." },
      { h: "4. Use of equipment", p: "Equipment must be used lawfully and only for its intended purpose. You must not sub-hire, modify, or take equipment outside the UK without written consent." },
      { h: "5. Liability", p: "Our liability for any loss is limited to the value of the rental. We are not liable for indirect or consequential loss, including lost footage or missed productions." },
      { h: "6. Governing law", p: "These terms are governed by the laws of England and Wales." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  "rental-terms": {
    title: "Rental Terms",
    updated: "September 2026",
    sections: [
      { h: "1. Rental period", p: "The rental period ends at the agreed return date and London local return time on your booking. If an item is returned late without an agreed extension, each additional commenced rental day after that local return time is charged at that item's daily rental rate shown when you booked. There is no separate flat penalty. We will provide a calculation before charging." },
      { h: "2. Security payment and hold", p: "Unless the checkout quote records a paid membership or safely completed same-kit account exemption, you pay a refundable security amount equal to half the displayed card hold; a separate authorisation is requested for the full displayed hold. The card hold expires according to your issuer and may need a fresh authorisation on long rentals. Handover requires an active hold." },
      { h: "3. Condition & care", p: "You must return equipment clean, complete (all cables, batteries, cases) and in the condition supplied. Loss or damage will be charged against the deposit, up to the equipment's replacement value." },
      { h: "4. Identity & agreement", p: "An automatic identity document, selfie/liveness and proof-of-address check is required before handover. A fully approved automatic check may be reused on the same account for up to 90 days, capped by the identity document expiry, if the rental starts within that period and the name and billing address are unchanged. We recheck the original provider decision before reuse. Changed details, expiry, a revoked result or a risk concern requires a fresh check. Manual or legacy approvals do not qualify for automatic reuse. If a document fails, the verification provider may ask you to resubmit that document. An authorised member of our team may make a documented manual decision." },
      { h: "5. Collection & delivery", p: "Pickup is from our London location during agreed hours. Local delivery is available within our service radius for a fee shown at checkout." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "September 2026",
    sections: [
      { h: "1. What we collect", p: "We collect your booking details and verification result. Didit processes your ID, selfie/liveness and proof-of-address documents. Stripe processes card payments and authorisations. We do not store your full card number or raw identity documents." },
      { h: "2. How we use it", p: "To process bookings, arrange fulfilment, provide support, send booking-related messages, and meet legal obligations." },
      { h: "3. Sharing", p: "We share data with service providers needed to run bookings, including Didit for verification, Stripe for card payments, Convex for application records and Vercel for hosting, or where required by law. We do not sell your data." },
      { h: "4. Your rights", p: "Under UK GDPR you can request access to, correction of, or deletion of your data. Contact us to exercise these rights." },
      { h: "4A. Rental account", p: "A paid website rental is linked to an account for the booking email. If needed, an account is created automatically without enrolling you in marketing. A private one-time email sign-in link proves ownership before giving access to the rental conversation and account benefits. Existing passwords and Google access remain intact. Do not share sign-in links." },
      { h: "5. Retention", p: "We keep booking records only as long as necessary for legal and accounting purposes." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  cancellation: {
    title: "Cancellation & Refund Policy",
    updated: "September 2026",
    sections: [
      { h: "Full card refund", p: `If you cancel at least ${CANCELLATION_FULL_REFUND_DAYS} London calendar days before the earliest item starts, we refund the amount paid for the rental booking, including any refundable security payment, to the original card. A separately identified recurring membership fee is governed by the Membership Terms and is not included in a rental cancellation refund. Any account credit redeemed for that booking is restored for ${CANCELLATION_CREDIT_DAYS} days.` },
      { h: "Optional full-value account credit", p: "At least three London calendar days before the rental starts, we may offer cancellation for the full remaining paid value as account credit, valid for one year. This includes any remaining paid security payment and replaces a card refund only if you explicitly accept the displayed offer. Unused card holds are released. Credit is automatically applied to eligible future rental charges and is not withdrawable as cash under this commercial policy. Your rights under applicable law are unaffected." },
      { h: "Closer to pickup", p: `If you cancel less than ${CANCELLATION_FULL_REFUND_DAYS} London calendar days before the earliest item starts, we refund the refundable security payment to the original card and issue the remaining amount paid as account credit valid for ${CANCELLATION_CREDIT_DAYS} days. Any account credit redeemed for that booking is also restored for ${CANCELLATION_CREDIT_DAYS} days. The account credit cannot be withdrawn as cash under this commercial policy.` },
      { h: "Card hold", p: "An uncaptured security card hold is cancelled on either path; your issuer decides when available funds are restored. If checkout payment has not completed, no refund or credit is due." },
      { h: "How to cancel", p: "Use the cancellation control in your rental account when available, or contact us with your booking email. If we cancel an unstarted direct booking, we refund the amount paid to the original card." },
      { h: "Your legal rights", p: "This commercial cancellation schedule does not limit any statutory right to cancel or receive a refund. Contact us if you believe a statutory right applies; we will assess it separately." },
      { h: "Draft notice", p: "This is a review-ready draft and must be checked by a qualified solicitor before go-live." },
    ],
  },
  "rental-agreement": {
    title: "Rental Agreement",
    updated: "September 2026",
    sections: [
      { h: "1. Parties & equipment", p: "This agreement is between Db Cinema Rentals (\"Owner\") and the person named at checkout (\"Renter\") for the equipment listed in the booking, for the dates booked." },
      { h: "2. Possession & care", p: "The Renter takes possession of the equipment for the rental period and agrees to keep it secure, use it only for its intended purpose, and not sub-hire, sell, or take it outside the UK without written consent." },
      { h: "3. Return and late time", p: "The Renter must return all equipment, cables, batteries and cases by the agreed return date/time. Each additional commenced rental day after that London local time is charged at the affected item's daily rate shown at booking. An extension agreed and paid before the due time follows the extension quote instead. We do not add a separate flat late penalty." },
      { h: "4. Loss & damage", p: "The Renter is responsible for loss, theft or damage occurring while the equipment is in their possession, up to the equipment's stated replacement value, subject to the Equipment Protection & Liability Policy and any applicable excess." },
      { h: "5. Identity and card security", p: "The Renter agrees to automatic ID, selfie/liveness and proof-of-address verification and to the separate refundable security payment and card authorisation detailed in the Card Hold & Refundable Security Payment Agreement. A documented manual review may be used where automation cannot reach a result." },
      { h: "5A. Saved-card authority", p: "The Renter agrees that we may attempt a separate saved-card payment after the rental for a documented amount owed under this agreement, including late rental time, loss, damage or insurance excess, after giving an itemised notice. The issuer may require a fresh authentication and payment is not guaranteed." },
      { h: "6. Liability", p: "The Owner's liability is limited to the value of the rental and excludes indirect or consequential loss (including lost footage or missed productions)." },
      { h: "7. Governing law", p: "Governed by the laws of England and Wales." },
      { h: "Draft notice", p: "Review-ready draft — have a qualified solicitor and your insurer review before go-live." },
    ],
  },
  "deposit-agreement": {
    title: "Card Hold & Refundable Security Payment Agreement",
    updated: "September 2026",
    sections: [
      { h: "1. Two separate amounts", p: "At checkout you pay a refundable security amount equal to 50% of the displayed hold category. Separately, your card is authorised for 100% of that category's displayed amount. The hold is not a charge. Both amounts appear separately in the checkout summary." },
      { h: "2. Safe return", p: "After the equipment is returned and inspected, we refund the security payment in full and cancel any uncaptured hold. Card networks and issuers control how quickly a released hold disappears from your available balance." },
      { h: "3. Documented deductions", p: "If the Renter owes an evidenced amount for missing items, damage or applicable insurance excess, we may capture no more than that amount from an active hold, up to the authorised hold amount. The refundable payment is applied only to any remaining documented balance. We provide an itemised account and evidence." },
      { h: "4. Hold expiry and later payments", p: "An authorisation may expire before a long rental ends. We will attempt a replacement authorisation for the same displayed hold amount shortly before expiry and release the old hold after the new one succeeds. For a brief period, your bank may show both holds. A replacement is a new issuer decision: it can fail or require you to approve it in your rental account. We will notify you when action is needed. A saved-card payment is also a separate issuer decision and is not guaranteed." },
      { h: "5. Late rental time", p: "Late rental time is a separately agreed charge at the affected item's daily rental rate shown when booked for each additional commenced rental day after the agreed London local return time, with no separate flat penalty. We send an itemised notice and allow seven days to dispute it. If no damage amount is due, we may apply an unused active hold to this late fee; any remainder may be attempted on the saved card. We will not collect the same amount twice or attempt collection later than 30 days after return. The issuer may decline or request authentication." },
      { h: "6. Disputes", p: "We will give an itemised notice and evidence before retaining or attempting to charge an amount, and provide a way to dispute the calculation. Statutory consumer rights are unaffected." },
      { h: "Draft notice", p: "Review-ready draft — confirm deposit handling with your payment processor and insurer." },
    ],
  },
  insurance: {
    title: "Equipment Protection & Liability Policy",
    updated: "September 2026",
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
    updated: "September 2026",
    sections: [
      { h: "1. Controller", p: "Db Cinema Rentals is the data controller for personal data collected to provide the rental service." },
      { h: "2. What we process", p: "Contact and booking details; delivery address; Stripe payment and card-authorisation references; and Didit's verification result, review status and resubmission explanation. We do not store raw identity documents or full card details in our application database." },
      { h: "3. Identity verification", p: "Didit collects and checks ID, selfie/liveness and proof of address through an embedded flow. It may request a clearer or replacement document. We receive the decision and limited metadata. An authorised team member may make a recorded manual decision." },
      { h: "4. Processors", p: "We use Didit (identity and address checks), Stripe (payments and holds), Convex (application records), Vercel (hosting) and Cloudflare (media)." },
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
        <div className="page-in">
          <div className="hud-label !text-accent-400/90">Legal</div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {doc.title}
          </h1>
          <p className="mt-2 font-mono text-xs text-white/30">Last updated {doc.updated} · Agreement version {LEGAL_VERSION}</p>
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
