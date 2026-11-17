import previous from "./2026-11-v24";

// v25 corrects the booking-confirmation explanation for the live payment and
// Didit flow. Earlier signed agreement versions remain immutable.
const bookingConfirmation = "A rental is confirmed only after payment has been recorded and the required identity verification has passed. A current 90-day verification approval already recorded for this account may satisfy the verification step. Until both requirements are met, the rental remains pending; we send the final confirmation, invoice and exact collection address only after approval. We may decline or cancel a rental if stock is unavailable or payment or required verification is not approved.";

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  ...(kind === "terms" ? { updated: "November 2026" } : {}),
  sections: document.sections.map(section => kind === "terms" && section.h === "2. Bookings"
    ? { ...section, p: bookingConfirmation }
    : section),
}])) as typeof previous;

export default current;
