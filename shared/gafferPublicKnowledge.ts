export type CurrentFaq = { q: string; a: string };

export const FAQS: CurrentFaq[] = [
  { q: "How does renting work?", a: "Browse the catalogue, pick your dates on the calendar, add gear to your kit and check out. You'll get a confirmation by email, then collect from central London or have it delivered." },
  { q: "Do you deliver across London?", a: "Yes. Delivery is quoted both ways based on distance and load — larger setups travel by van. You choose pickup or delivery at checkout and pick your time window." },
  { q: "What about deposits and insurance?", a: "Your quote and signed agreement show the security terms for that rental. Any saved-card permission is limited to the reasons and amount recorded in those terms; it is not a bank hold, liability cap or insurance purchase. Own insurance is optional for currently declared company-owned or declared leased kit; DB’s contingent cover does not waive renter responsibility. Identity and address checks are required before handover. Existing bookings keep their accepted terms." },
  { q: "How are the rates structured?", a: "Daily, 3-day and weekly rates — the longer you rent, the lower the per-day price, applied automatically. Members save a further 10-30% on every rental." },
  { q: "What are your opening hours?", a: "Pickups and returns run 09:00-22:00, every day. Delivery times are arranged when you book." },
  { q: "Can I extend or add to my booking?", a: "Yes — message us in your account and you can add compatible gear up to an hour before your rental starts, or ask about extending your dates." },
  { q: "How do cancellations work?", a: "Cancellation rules depend on the terms accepted with your rental. Open the cancellation section in your rental account or ask me to find the terms for your booking." },
];

export type GafferPolicyFlags = {
  setupIntentSecurityEnabled?: boolean;
  cardHoldSecurityEnabled?: boolean;
  assessmentSecurityEnabled?: boolean;
  cancellationProtectionEnabled?: boolean;
  cancellationPolicyEnabled?: boolean;
  refundableDepositEnabled?: boolean;
};

export function faqsForSecurityPolicy(flags: GafferPolicyFlags): CurrentFaq[] {
  const setupIntent = flags.setupIntentSecurityEnabled === true;
  const cardHold = !setupIntent && flags.cardHoldSecurityEnabled === true;
  const assessment = !setupIntent && !cardHold && flags.assessmentSecurityEnabled === true;
  const cashDeposit = !setupIntent && !cardHold && !assessment && flags.refundableDepositEnabled === true;

  return FAQS.map((faq) => {
    if (faq.q === "How does renting work?") {
      return { ...faq, a: "Browse the catalogue, choose rental dates and times, add equipment to your basket and complete checkout. A basket or Gaffer quote does not reserve stock. Your account shows the current status and any next steps for the rental. Choose in-person collection or delivery at checkout." };
    }
    if (faq.q === "Do you deliver across London?") {
      return { ...faq, a: "Local delivery is available for eligible addresses. The fee and available time slot depend on the address, dates and equipment, so check the quote at checkout." };
    }
    if (faq.q === "How are the rates structured?") {
      return { ...faq, a: "Rates vary by item and rental length. The listing and checkout show the applicable total, and any active membership saving is applied to the quote for that account." };
    }
    if (faq.q === "Can I extend or add to my booking?") {
      return { ...faq, a: "Message us in your account to request an extension or compatible extra gear. We need to check the dates, stock and price, and the change is not complete until your account shows the updated rental." };
    }
    if (faq.q === "How do cancellations work?") {
      if (flags.cancellationPolicyEnabled === true) return { ...faq, a: "Under the current terms, cancel more than seven London calendar days before pickup for a full refund or 100% rental credit. More than 48 hours and seven or fewer days before pickup is credit only. At 48 hours or less, no rental refund or credit. Separately refundable security is settled separately, and statutory rights take priority. Existing rentals keep their signed terms." };
      if (setupIntent || cardHold) return { ...faq, a: "Under the current signed-card terms, cancel more than seven London calendar days before pickup for a full refund. At seven days or less, paid rental value becomes account credit. Refundable security is settled separately. Existing rentals keep their signed terms." };
      return faq;
    }
    if (faq.q !== "What about deposits and insurance?") return faq;
    if (setupIntent) {
      return { ...faq, a: "New rentals under the saved-card policy have no upfront deposit and reserve no card funds. The saved-card ceiling is £50 below £1,000 replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more. It applies only to evidenced, itemised late-return charges or severe permanent cosmetic damage or loss, with at least seven days to query a claim and collection attempted within 30 days after return. No claim is automatically charged for an on-time return without a reported issue. Insurance claims and excess are separate. Membership or a free trial does not itself grant a waiver or claim permission; the exact terms are accepted separately with each rental. Existing bookings keep their signed terms." };
    }
    if (cardHold) {
      return { ...faq, a: "New rentals use a temporary card authorisation of £50 below £1,000 replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more, unless the checkout quote shows an account exemption. It is not a payment, but it may reduce the card's available balance. An issue-free return releases the hold automatically; a claim needs a recorded reason. If pickup is more than seven days away, checkout explains the replacement-hold process. Insurance is separate, and existing bookings keep their signed terms." };
    }
    if (assessment) {
      return { ...faq, a: "Standard refundable deposits are £20 below £1,000 combined equipment value, £50 from £1,000 to below £4,000 and £100 at £4,000 or more. No deposit waiver applies to a first rental. Below £4,000, a waiver requires either an active paid subscription after at least one successful recurring payment or the final Encore level recorded on the account; both also require the same account to have a previous rental with every item inspected as good and security fully settled. A trial or membership alone is not enough. No extra funds are blocked. A return with no claimed issue releases unused security automatically. Existing bookings retain their accepted terms." };
    }
    if (cashDeposit) {
      return { ...faq, a: "No deposit below £1,000 combined equipment value; £50 from £1,000 to below £4,000; £100 at £4,000 or more. Unused deposit returns to the original card after return. Any retained amount and reason appear on your completion statement and reduce the same assessed loss and later card allowance. The existing 10% combined saved-card damage/late-fee permission remains. No extra card hold is placed. These are security arrangements, not an insurance purchase or liability cap. Own insurance is optional for currently declared company-owned or declared leased kit; DB’s contingent cover does not waive renter responsibility. Identity and address checks and approval are required before handover. Existing bookings keep their accepted terms." };
    }
    return faq;
  });
}
