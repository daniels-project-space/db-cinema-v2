import previous from "./2026-11-v19";

const security = "A new rental does not take an upfront cash deposit or reserve funds on a payment card. Stripe saves the card for future, one-off security claims; this is not a hold, a charge, or a guarantee that a later payment will be authorised. The combined maximum for assessed late-return charges and severe, permanent cosmetic damage or loss is £50 when the combined equipment replacement value is below £1,000, £100 from £1,000 to below £4,000, and £200 at £4,000 or more. Severe cosmetic damage means material, permanent damage that materially affects the equipment’s condition or reasonable rental value or requires professional repair; fair wear, pre-existing defects, routine dirt, minor removable marks and damage attributable to DB are excluded. No amount is automatically charged when equipment is returned on time without a reported issue. An authorised team member must record the specific reason and supporting evidence, provide an itemised notice, allow at least seven days to query or dispute it, and attempt any permitted collection within 30 days after the recorded return. Claims above this combined ceiling require a separate agreement. Insurance claims or policy excess are outside this ceiling and are handled separately under the applicable insurance terms; they are not charged under this saved-card permission. A saved card does not guarantee available funds or issuer approval; a later charge may be declined or require authentication.";
const insuranceSeparation = "Insurance claims and any policy excess are separate from the saved-card security ceiling. The rental security permission does not authorise an insurance or excess charge; any such charge must have its own basis under the applicable insurance terms and be separately itemised.";
const laterCharges = "The saved-card permission covers only the combined limit and claim types in the Saved Card & Future Security Payments Agreement: an evidenced, itemised late-return charge or severe permanent cosmetic damage or loss beyond fair wear. No deposit or card hold is taken under this version. No amount is automatically charged for an on-time return without a reported issue. Before any permitted collection, an authorised team member must record the reason and evidence, send an itemised notice, allow at least seven days to query or dispute it, and attempt collection within 30 days after the recorded return. The limit is not permission to charge for insurance or policy excess. A later payment may be declined or require authentication; statutory and bank dispute rights remain unchanged.";
const lossDamage = "During the agreed responsibility period you are responsible for accidental physical loss, damage or destruction, including theft, missing items and non-return. Fair wear, pre-existing defects and loss attributable to DB are excluded from renter liability. For repairable damage we seek reasonable evidenced repair costs, limited to reasonable pre-loss replacement value. For lost, stolen, missing or irreparable items we use reasonable equivalent replacement valuation reflecting age, condition and available alternatives, supported by item/condition records. Catalog replacement value is a reference, not an automatic new-for-old award. We give itemised evidence and notice before recovery, allow at least seven days to raise a dispute without limiting statutory rights, and consider your evidence. This version takes no security deposit or card hold. The saved-card ceiling limits card collection under the separate signed permission; it is not a liability cap. Any further amount requires a separate payment agreement or lawful recovery, and deposits, recovered items and insurance recoveries are accounted for to prevent double recovery. DB’s policy excess is not automatically the renter’s liability or cap.";
const cancellation = "For rentals accepted under this version, cancelling more than seven London calendar days before the earliest equipment start returns the remaining rental cash payment to its original payment transaction. Cancelling seven or fewer London calendar days before that start converts the remaining paid rental amount into account credit valid for 365 days from issue, instead of a rental cash refund under this commercial schedule. No refundable security deposit or card hold is collected under this version, so there is no deposit refund or hold release. Any separate post-return claim is governed only by the saved-card agreement and is not a cancellation charge. Previously redeemed rental credit is accounted for once. Recurring membership fees are separate. Statutory refunds and rights take priority; account credit never replaces a refund required by law. Existing bookings retain their accepted terms.";
const accountCredit = "Account credit is shown only when an available balance exists and is used at checkout only when you choose it. The quotation and rental invoice show the amount applied. Credit cannot pay membership fees, future security claims or insurance/policy excess. Earned/promotional credit does not stack with another rental discount. Credit is non-refundable and cannot be withdrawn as cash under this commercial policy, subject to statutory rights. Each credit receipt records its expiry; unspent credit expires after its recorded validity period. Cancelling a credit-funded booking does not turn that credit into cash.";
const cancellationProtection = "Cancellation protection is included free. If DB cancels before pickup because equipment is unexpectedly unavailable, we allow one hour for the account decision. Eligible accounts not blocked receive an email before settlement with two options: a full refund of remaining rental cash to the original payment method, with previously used account credit restored, or account credit equal to 130% of the eligible remaining rental purchase amount, valid for 365 days from issue. The extra 30% is not applied to membership fees or future security claims. No security deposit or card hold is collected under this version. Choosing credit replaces the cash refund for the converted rental amount and is non-refundable, subject to statutory rights. The secure review shows cash, used credit and bonus separately before confirmation. Blocking an account does not remove its right to a refund. Existing bookings retain their accepted commercial terms and statutory rights remain unchanged.";
const rentalReturn = "After return, the team records the inspection and any open issue. No deposit is held and no funds are reserved under this version. An on-time return without a reported issue does not trigger an automatic security charge. If a permitted late-return or severe-damage/loss claim is assessed, its reason and evidence are recorded and an itemised notice is sent with at least seven days to query or dispute; collection is attempted within 30 days after the recorded return and only within the separate signed saved-card ceiling. Fair wear and pre-existing defects are excluded. No amount above that ceiling is automatically charged. The completion statement records the decision and any charge; bank approval may still be declined or require authentication.";
const referralTerms = "Only one price benefit applies: referral, promo, item offer, Encore, membership weekend or delivery saving, or earned store credit. The once-only £5 Starter / £10 Pro or Studio joining credit is the sole stacking exception, capped at remaining rental charges. Multiple earned credit grants count as one credit benefit. Refund credits may pay the remaining eligible rental/delivery balance. Referral offers do not waive verification or change the security terms in the final rental quote. Under this version, there is no upfront deposit or card hold; the saved-card ceiling and permitted claim types remain those in the separately accepted rental agreement. Security claims, delivery, subscription fees and Film Fund fees are outside the referral rental discount.";
const privacyCollection = "We collect contact, booking, billing/delivery and agreement-acceptance records, payment and saved-payment-method setup references, and limited verification results/metadata. Didit processes ID, selfie/liveness and address submissions; Stripe processes payments and securely stores payment methods. This version does not create a card hold. Raw ID images and full card numbers are not stored in the application database. This does not mean providers hold no documents or biometric data.";
const dataProcessing = "Contact and booking details; delivery address; Stripe payment, saved-payment-method setup and agreement-consent references; and Didit's verification result, review status and resubmission explanation. We do not store raw identity documents or full card details in our application database.";
const processors = "We use Didit (identity and address checks), Stripe (payments and saved-payment-method setup), Convex (application records), Vercel (hosting) and Cloudflare (media).";

const overrides: Record<string, Record<string, { h?: string; p: string }>> = {
  terms: {
    "3A. Later charges": { p: laterCharges },
    "Cancellation and refunds": { p: cancellation },
    "Account credit": { p: accountCredit },
    "Free cancellation protection": { p: cancellationProtection },
  },
  "rental-terms": {
    "2. Security payment and hold": { h: "2. Saved-card security claims", p: security },
    "7. Inspection and delays": { p: rentalReturn },
    "Cancellation and refunds": { p: cancellation },
  },
  "rental-agreement": {
    "4. Loss & damage": { p: lossDamage },
    "5A. Saved-card authority": { p: laterCharges },
    "Cancellation and refunds": { p: cancellation },
  },
  cancellation: {
    "Card hold": { h: "Security after cancellation", p: "No deposit is taken and no funds are held under this version. Any permitted future security claim follows the separately accepted saved-card agreement; it is not part of the cancellation refund. Earlier bookings retain their accepted terms." },
    "Your cancellation": { p: cancellation },
    "Account credit": { p: accountCredit },
    "Free cancellation protection": { p: cancellationProtection },
  },
  insurance: {
    "1. Company insurance and liability": { p: "This describes contingent company cover and renter responsibility, not a renter insurance policy. Own insurance is optional for declared company-owned or declared leased kit. The saved-card ceiling is limited permission to attempt the specific future claims in the rental agreement; it is not a deposit, hold, insurance purchase or liability cap. Insurance claims and any policy excess are handled separately under their own terms. DB’s policy excess is not automatically the renter’s liability or cap. Recovery follows the Rental Agreement’s evidenced valuation, notice, dispute and no-double-recovery safeguards." },
  },
  privacy: {
    "1. What we collect": { p: privacyCollection },
  },
  "data-processing": {
    "2. What we process": { p: dataProcessing },
    "4. Processors": { p: processors },
  },
  referrals: {
    "No stacking and normal security": { h: "No stacking and rental security", p: referralTerms },
  },
};

const current = Object.fromEntries(Object.entries(previous).map(([kind, doc]) => [kind, {
  ...doc,
  sections: doc.sections.map(section => {
    const override = overrides[kind]?.[section.h];
    if (override) return { ...section, ...override };
    return section.p.includes("New rentals use a Stripe card authorisation hold") ? { ...section, p: security } : section;
  }),
}]));

if (current.insurance) {
  current.insurance = {
    ...current.insurance,
    sections: [...current.insurance.sections, { h: "Insurance claims and excess", p: insuranceSeparation }],
  };
}

current["deposit-agreement"] = {
  title: "Saved Card & Future Security Payments Agreement",
  updated: "November 2026",
  sections: [
    { h: "1. No deposit or card hold", p: "No security deposit is charged and no funds are reserved at checkout or pickup. Stripe securely saves the payment method for the limited future one-off claims described below. This does not promise that the bank will approve a later payment." },
    { h: "2. Future-claim ceiling and permitted reasons", p: security },
    { h: "3. Separate insurance handling", p: insuranceSeparation },
  ],
};

export default current;
