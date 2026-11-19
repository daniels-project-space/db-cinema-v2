import previous from "./2026-11-v21";

const lateVerification = "Paid rentals must pass required verification before collection. If verification is still incomplete two hours after the scheduled rental start, the online verification session closes and the rental remains unconfirmed unless the team manually reopens it. Because the equipment was reserved for this booking, the rental payment is not refunded when this verification deadline is missed. Any separate refundable security and statutory rights remain unaffected. Existing bookings keep the terms accepted at checkout.";
const current = Object.fromEntries(Object.entries(previous).map(([kind, document]) => [kind, { ...document, sections: [...document.sections] }]));

current["verification-deadline"] = {
  title: "Verification deadline & missed collection",
  updated: "November 2026",
  sections: [{ h: "Complete verification before collection", p: lateVerification }],
};

for (const kind of ["terms", "rental-terms", "rental-agreement"]) {
  const document = current[kind];
  if (document) document.sections.push({ h: "Verification deadline", p: lateVerification });
}

export default current;
