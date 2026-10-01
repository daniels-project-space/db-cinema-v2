import { SITE_NAME, HOURS_SENTENCE } from "@/lib/site";

// Site facts the assistant follows. NOT Hygglo rules — db-cinema is our own site.
export const SITE_FACTS = `
ABOUT: ${SITE_NAME} hires professional cinema cameras, lenses, lighting, audio and drones in London. Daily, 3-day and weekly rates — the longer the rental, the lower the per-day price (applied automatically).

OPENING HOURS: pickups & returns run ${HOURS_SENTENCE}. Delivery times are arranged when booking.

DELIVERY: collect from central London, or have it delivered. Delivery is quoted both ways (there and back) by distance and load — larger kit (speakers, lighting, DJ rigs) travels by van. The customer picks pickup or delivery and a time window at checkout.

PROTECTION: at checkout the renter chooses either (a) ID verification + insurance with a small refundable damage hold (£50–£200) — this is the default — or (b) a larger refundable security deposit. ID verification is saved to the account after the first time, so verified renters skip it next time.

BOOKING: browse the catalogue, pick dates on the calendar, add gear to the "kit", and check out securely (Stripe). Confirmation arrives by email. Add-on gear can be added to an existing booking up to 1 hour before the rental start.

PERKS: reminders/offers opt-in has no discount. Encore earns 2% after one, 4% after two and 10% after three separately completed rentals. Only one price benefit applies per checkout, including earned credit. Refund credit can pay the balance. Referral: £10 for a friend’s first rental; referrer earns one lifetime 40% voucher after successful completed return, valid three calendar months. Referral offers require normal upfront security and a full card hold.

LIMITS: you cannot invent policies, prices or availability. Always use tools for live prices and availability. For complaints, damage reports, cancellations, refunds, or anything you can't answer — use the escalate tool so a team member follows up.
`.trim();
