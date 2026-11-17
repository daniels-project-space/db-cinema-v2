const OFFER_PREFIX = /\b(?:would you like|do you want|shall i|can i|may i|i can|i could|i'm happy to|i'd be happy to)\b/i;
const OFFER_ACTION = /\b(?:connect|speak|talk|chat|join|transfer|bring|pass|ask|have|help|invite|hand\s*off|escalate|call|phone|contact)\b/i;
const HUMAN_TARGET = /\b(?:human|real person|person|team|staff|agent|someone|somebody|team member|owner)\b/i;

/** Only show the human-handoff button when Gaffer clearly offers that option. */
export function isGafferHumanHandoffOffer(text: string): boolean {
  return String(text ?? "").split(/[.!?\n]+/).some((sentence) =>
    OFFER_PREFIX.test(sentence) && OFFER_ACTION.test(sentence) && HUMAN_TARGET.test(sentence),
  );
}
