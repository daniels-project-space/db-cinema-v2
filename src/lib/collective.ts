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

/** Professional economics. Client pays the pro's rate + markup; we take a
 * commission from the pro's side; gear is half-price for booked shoots. */
export const CLIENT_MARKUP = 0.2; // +20% on the client side
export const CREATIVE_COMMISSION = 0.15; // 15% from the creative's side
export const GEAR_MEMBER_DISCOUNT = 0.5; // 50% off gear for booked shoots

/** Client-facing day rate = the pro's quote + our markup. */
export const clientRate = (n: number) => Math.round(n * (1 + CLIENT_MARKUP));
/** What the pro keeps after our commission. */
export const creativeNet = (n: number) => Math.round(n * (1 - CREATIVE_COMMISSION));

/** Where the agreed "terms of renting" live (link target in onboarding). */
export const RENTAL_TERMS_HREF = "/legal/terms";

/**
 * Plain-English summary of the gear-provider agreement, shown during onboarding.
 * A formal agreement is issued and signed before any item is listed.
 * (Not legal advice; the binding contract is the signed document.)
 */
export const GEAR_PROVIDER_TERMS: { h: string; p: string }[] = [
  {
    h: `Revenue share — ${GEAR_SPLIT.provider}% to you`,
    p: `For every confirmed rental of your item, you receive ${GEAR_SPLIT.provider}% of the net rental revenue and Db Cinema retains ${GEAR_SPLIT.dbc}%. Our share covers listing, marketing, booking, customer support, handling, payment processing and insurance administration.`,
  },
  {
    h: "Ownership stays with you",
    p: "You remain the legal owner of your equipment at all times. Listing with us is a custody-and-rental arrangement, not a sale or transfer of title.",
  },
  {
    h: "Get your gear back any time*",
    p: "You can withdraw an item whenever you like.* *You must wait until there are no active or upcoming rentals booked on that item — then we agree a handover window and you collect, and later return, the item yourself.",
  },
  {
    h: "Custody during the leasing period",
    p: "While an item is out on a rental, Db Cinema is responsible for handover, condition checks and return. Renters are ID-verified and covered by a damage hold plus insurance. For loss or damage beyond fair wear, we manage the claim and you're compensated per the agreed item value.",
  },
  {
    h: "Condition, maintenance & valuation",
    p: "Items must be fully working, clean and complete with their standard accessories. We agree a documented replacement value per item up front, which sets insurance cover and any compensation.",
  },
  {
    h: "Paid out monthly",
    p: "Your earnings are tracked per booking and paid out monthly to your nominated bank account, with a clear statement of the rentals included.",
  },
];

/**
 * Professional membership terms — read & agreed in onboarding.
 */
export const PROFESSIONAL_TERMS: { h: string; p: string }[] = [
  {
    h: "How pricing & pay works",
    p: `You set your own rate. Clients are charged your rate + ${Math.round(CLIENT_MARKUP * 100)}% (our booking fee). We take ${Math.round(CREATIVE_COMMISSION * 100)}% commission from your side, so you keep ${Math.round((1 - CREATIVE_COMMISSION) * 100)}% of your quoted rate — paid out monthly.`,
  },
  {
    h: "We bring you the leads",
    p: "We market the roster and bring paying clients to you. In return, work introduced by Db Cinema is booked, contracted and paid through us — not taken off-platform.",
  },
  {
    h: "We handle the contracts & the money",
    p: "We handle the contract and terms on both ends — yours and the client's — and we hold the client's money securely until the job is done, so you always get paid.",
  },
  {
    h: `${Math.round(GEAR_MEMBER_DISCOUNT * 100)}% off all our gear`,
    p: "For any shoot booked through us, rent any camera, lens, light or rig from our catalogue at half price for the hire period.",
  },
  {
    h: "Verified & reliable",
    p: "Crew are vetted and ID-verified — clients trust the Db Cinema verified badge. You agree to show up, on time, and deliver to a professional standard.",
  },
];

/** Pitch bullets used on the professional onboarding choice + final step. */
export const PROFESSIONAL_PERKS: { icon: string; h: string; p: string }[] = [
  { icon: "📣", h: "We bring in the leads", p: "We market the roster and match you with paying clients directly." },
  { icon: "🎬", h: "50% off all our gear", p: "Rent any camera, lens, light or rig at half price for shoots booked through us." },
  { icon: "📝", h: "Contracts handled both ends", p: "We handle the contract and terms for you and the client." },
  { icon: "💷", h: "We hold the client's money", p: "Funds are held securely until the job's done — you always get paid, monthly." },
];
