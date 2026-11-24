import previous from "./2026-11-v28";

const renterCancellation = "For a rental accepted under this version, cancelling seven or more London calendar days before the earliest equipment start gives you a choice: a full refund of the remaining eligible rental payment to its original payment method, or 100% of that remaining rental value as account credit valid for 365 days. Cancelling at least 48 hours before the scheduled London pickup time, but fewer than seven London calendar days before the earliest equipment start, gives account credit only for the remaining eligible rental value. Cancelling less than 48 hours before the scheduled London pickup time gives no rental refund and no account credit. Exactly 48 hours before scheduled pickup remains in the account-credit-only window. Any separately refundable security is settled separately. Membership fees are not rental payments. Statutory rights take priority, and existing bookings keep the terms they accepted.";

const replacements: Record<string, Record<string, string>> = {
  terms: { "Cancellation and refunds": renterCancellation },
  "rental-terms": { "Cancellation and refunds": renterCancellation },
  "rental-agreement": { "Cancellation and refunds": renterCancellation },
  cancellation: { "Your cancellation": renterCancellation },
};

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  ...(kind === "terms" ? { updated: "November 2026" } : {}),
  sections: document.sections.map(section => {
    const replacement = replacements[kind]?.[section.h];
    return replacement ? { ...section, p: replacement } : section;
  }),
}])) as typeof previous;

export default current;
