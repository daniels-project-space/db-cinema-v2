import { SITE_NAME, HOURS_SENTENCE } from "@/lib/site";

// Site facts the assistant follows. NOT Hygglo rules — db-cinema is our own site.
export const SITE_FACTS = `
ABOUT: ${SITE_NAME} hires professional cinema cameras, lenses, lighting, audio and drones in London. Daily, 3-day and weekly rates — the longer the rental, the lower the per-day price (applied automatically).

OPENING HOURS: pickups & returns run ${HOURS_SENTENCE}. Delivery times are arranged when booking.

DELIVERY: collect from central London, or have it delivered. Delivery is quoted both ways (there and back) by distance and load — larger kit (speakers, lighting, DJ rigs) travels by van. The customer picks pickup or delivery and a time window at checkout.

SECURITY AND LIABILITY: use the current checkout quote for refundable security and any separate hold. Security is not a liability cap or insurance purchase; the company insurance excess is not an automatic renter cap or charge. Own insurance is optional for currently declared company-owned or declared leased equipment. Renter responsibility follows evidenced repair/equivalent replacement costs, excluding fair wear, pre-existing defects and DB-caused loss, with no double recovery. Verification checks identity AND address; a provider pass alone is not two-source evidence. Current reuse has a 90-day/earlier-ID-expiry cap, unchanged details and provider recheck; Didit/reuse approval remains under broker review. Do not claim active cover, automatic third-party-owner cover, overseas cover or drone aviation liability. Escalate insurance, incidents and disputes to the team promptly.

BOOKING: browse the catalogue, pick dates on the calendar, add gear to the "kit", and check out securely (Stripe). Confirmation arrives by email. Add-on gear can be added to an existing booking up to 1 hour before the rental start.

PERKS: reminders/offers opt-in has no discount. Encore earns 2% after one, 4% after two and 10% after three separately completed rentals. Only one price benefit applies per checkout, including earned credit. Refund credit can pay the balance. Referral: £10 for a friend’s first rental; referrer earns one lifetime 40% voucher after successful completed return, valid three calendar months. Referral offers require normal upfront security and a full card hold.

LIMITS: you cannot invent policies, prices or availability. Always use tools for live prices and availability. For complaints, damage reports, cancellations, refunds, or anything you can't answer — use the escalate tool so a team member follows up.
`.trim();
