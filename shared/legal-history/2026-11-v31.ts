import previous from "./2026-11-v30";

const verificationTiming = "Where Didit identity verification is required, payment alone does not confirm or approve the rental. Didit must approve the required checks strictly before the two-hour cutoff after the earliest scheduled London pickup time. At the cutoff or later, unless DB Cinema records an authorised manual override, approval may be refused because the equipment was reserved for your booking. Passing the cutoff does not itself cancel the rental or decide any refund or account credit. Any cancellation or payment outcome is handled under the terms accepted for the booking and applicable statutory rights. Existing bookings remain under the version they accepted.";

const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, {
  ...document,
  ...(kind === "terms" ? { updated: "November 2026" } : {}),
  sections: [
    ...document.sections,
    ...(kind === "terms" || kind === "rental-terms" || kind === "rental-agreement"
      ? [{ h: "Verification timing", p: verificationTiming }]
      : []),
  ],
}])) as typeof previous;

export default current;
