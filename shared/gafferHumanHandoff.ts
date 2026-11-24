const OFFER_PREFIX = /\b(?:would you like|do you want|shall i|can i|may i|i can|i could|i'm happy to|i'd be happy to)\b/i;
const OFFER_ACTION = /\b(?:connect|speak|talk|chat|join|transfer|bring|pass|ask|have|help|invite|hand\s*off|escalate|call|phone|contact)\b/i;
const HUMAN_TARGET = /\b(?:human|real person|person|team|staff|agent|someone|somebody|team member|owner)\b/i;

function isOfferSentence(sentence: string): boolean {
  return OFFER_PREFIX.test(sentence) && OFFER_ACTION.test(sentence) && HUMAN_TARGET.test(sentence);
}

export function containsGafferHumanHandoffOffer(text: string): boolean {
  return String(text ?? "").split(/[.!?\n]+/).some(isOfferSentence);
}

export function isGafferHumanHandoffOffer(text: string, renterExplicitlyRequestedHuman = false): boolean {
  return renterExplicitlyRequestedHuman && containsGafferHumanHandoffOffer(text);
}

export function removeGafferHumanHandoffOffers(text: string): string {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !isOfferSentence(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
