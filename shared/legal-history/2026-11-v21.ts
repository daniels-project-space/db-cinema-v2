import previous from "./2026-11-v20";

const renterCancellation = "For a rental accepted under this version, cancelling more than seven London calendar days before the earliest equipment start gives you a choice: a full refund of the remaining eligible rental payment to its original payment method, or 100% of that remaining rental value as account credit valid for 365 days. Cancelling more than 48 hours but seven or fewer London calendar days before the earliest equipment start gives account credit only for the remaining eligible rental value. Cancelling 48 hours or less before the scheduled pickup time gives no rental refund and no account credit. Any separately refundable security is settled separately. Membership fees are not rental payments. Statutory rights take priority, and existing bookings keep the terms they accepted.";
const companyCancellation = "If DB cancels before pickup because equipment is unexpectedly unavailable, every renter can receive a full refund of the remaining eligible rental payment to the original payment method. An account that is not rejected or restricted for a terms violation may instead choose 130% of that eligible rental value as account credit, valid for 365 days. A rejected or restricted account cannot choose the 130% credit; this does not remove a refund or other statutory rights. Refundable security is settled separately. Membership fees are excluded.";

const replacements: Record<string, Record<string, string>> = {
  terms: {
    "Cancellation and refunds": renterCancellation,
    "Free cancellation protection": companyCancellation,
  },
  "rental-terms": {
    "Cancellation and refunds": renterCancellation,
  },
  "rental-agreement": {
    "Cancellation and refunds": renterCancellation,
  },
  cancellation: {
    "Your cancellation": renterCancellation,
    "Free cancellation protection": companyCancellation,
  },
};

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  sections: document.sections.map(section => {
    const replacement = replacements[kind]?.[section.h];
    return replacement ? { ...section, p: replacement } : section;
  }),
}]));

export default current;
