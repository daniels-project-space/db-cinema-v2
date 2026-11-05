import previous from "./2026-11-v18";

const security = "New rentals use a Stripe card authorisation hold rather than taking a cash deposit: £50 below £1,000 combined equipment replacement value, £100 from £1,000 to below £4,000, and £200 at £4,000 or more. An authorisation is not a payment, but your bank may temporarily reduce the balance or credit available. Banks control how quickly released funds become available. If a rental begins more than a week after checkout, the original authorisation may expire; we will request a replacement five hours before pickup. If the old authorisation is still active, we cancel it only after the replacement succeeds, so your bank may briefly show both. A replacement can require bank authentication. A zero-hold exemption is available only below £4,000 when the same account has a previous completed rental with every item recorded in a good-condition return inspection, no damage or late-fee claim, and all security settlement complete, and the account either has a paid active subscription after its first successful recurring payment or the final Encore level. A first rental, unpaid trial, membership alone, or account without a clean completed rental never qualifies. The accepted quotation records the amount and any exemption.";
const returns = "When the rental is returned without reported issues, we automatically cancel any uncaptured authorisation; no late fee or other amount is automatically captured. A team member must record a specific reason and evidence before claiming any amount from the hold. Any authorised capture is limited to the amount actually claimed and available under the hold; the remainder is released. The completion statement records the return, release or any approved claim. Stripe sends a release request when the hold is cancelled, but the bank controls when the available balance is restored.";

const current = Object.fromEntries(Object.entries(previous).map(([kind, doc]) => [kind, {
  ...doc,
  sections: doc.sections.map(section => ({
    ...section,
    p: section.p.replace(/New rentals include a refundable deposit[^.]+\. A zero-deposit exemption[^.]+\. The first rental never qualifies\.[^.]+\. Membership alone, an account without a clean completed rental, or a first rental never qualifies\. The accepted quotation records the exact amount and exemption\. No extra funds are blocked\./, security),
  })),
}]));

current["deposit-agreement"] = {
  title: "Card Authorisation Hold & Return Agreement",
  updated: "November 2026",
  sections: [
    { h: "1. Card authorisation hold", p: security },
    { h: "2. Return and claims", p: returns },
  ],
};

export default current;
