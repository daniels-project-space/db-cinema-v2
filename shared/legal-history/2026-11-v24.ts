import previous from "./2026-11-v23";

// v24 keeps v23's renter-cancellation and saved-card rules. It broadens the
// company-cancellation promise for future bookings; earlier signed versions
// remain unchanged in the archive.
const companyCancellation = "If DB Cinema cancels your confirmed rental before pickup for any reason, you can choose a full refund of the remaining eligible rental payment to the original payment method, with any account credit used for the rental restored, or account credit equal to 130% of the remaining eligible rental value, valid for 365 days. The 130% option is unavailable if the account or rental is rejected or restricted for a terms violation; this does not remove a refund or other statutory rights. If you do not choose by the deadline in our email, we issue the original-payment refund and restore used credit. Refundable security is settled separately. Membership fees are excluded.";

const replacements: Record<string, Record<string, string>> = {
  terms: { "Free cancellation protection": companyCancellation },
  cancellation: { "Free cancellation protection": companyCancellation },
};

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  sections: document.sections.map(section => {
    const replacement = replacements[kind]?.[section.h];
    return replacement ? { ...section, p: replacement } : section;
  }),
}])) as typeof previous;

export default current;
