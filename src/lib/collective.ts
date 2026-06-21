// Shared, client-safe constants for the Creative Collective onboarding.

/** Roles a professional can apply as — values match the operator role icons. */
export const COLLECTIVE_ROLES: { value: string; label: string }[] = [
  { value: "cinematographer", label: "Cinematographer" },
  { value: "dop", label: "Director of Photography" },
  { value: "videographer", label: "Videographer" },
  { value: "editor", label: "Editor" },
  { value: "music-composer", label: "Music Composer" },
  { value: "drone-operator", label: "Drone Operator" },
  { value: "sound-operator", label: "Sound Operator" },
];

/** Revenue split for gear providers. */
export const GEAR_SPLIT = { dbc: 60, provider: 40 } as const;

/**
 * Plain-English summary of the gear-provider agreement. This is a summary shown
 * during onboarding — a formal agreement is issued and signed before any item
 * is listed. (Not legal advice; the binding contract is the signed document.)
 */
export const GEAR_PROVIDER_TERMS: { h: string; p: string }[] = [
  {
    h: `Revenue share — ${GEAR_SPLIT.provider}% to you`,
    p: `For every confirmed rental of your item, you receive ${GEAR_SPLIT.provider}% of the net rental revenue and Db Cinema retains ${GEAR_SPLIT.dbc}%. Our share covers listing, marketing, booking, customer support, handling, payment processing and insurance administration.`,
  },
  {
    h: "Ownership stays with you",
    p: "You remain the legal owner of your equipment at all times. Listing with us is a custody-and-rental arrangement, not a sale or transfer of title. You can withdraw an item from future bookings at any time, subject to honouring rentals already confirmed.",
  },
  {
    h: "Custody during the leasing period",
    p: "While an item is in our custody or out on a rental, Db Cinema is responsible for its safekeeping, handover, condition checks and return. Renters are ID-verified and covered by a damage hold plus insurance. In the event of loss or damage beyond fair wear, we manage the claim and you are compensated per the agreed item value.",
  },
  {
    h: "Condition, maintenance & valuation",
    p: "Items must be fully working, clean and complete with their standard accessories. We agree a documented replacement value per item up front, which sets insurance cover and any compensation. Routine wear is expected; we'll flag anything that needs your attention.",
  },
  {
    h: "Payouts",
    p: "Earnings are tracked per booking and paid out on a regular schedule to your nominated account, with a clear statement of the rentals included. You keep full visibility of what your gear earned.",
  },
  {
    h: "Term & withdrawal",
    p: "The arrangement is non-exclusive and open-ended. Either side can end it with reasonable notice; any bookings already confirmed are honoured, after which the item is returned to you.",
  },
];
