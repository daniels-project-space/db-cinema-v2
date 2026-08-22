/**
 * What Gaffer should assume the caller wants, based on where they opened the call.
 *
 * Someone hitting "Ask Gaffer" from a gimbal guide wants their hands held through
 * a setup; someone on the FAQ probably has a problem; someone on a gear page is
 * shopping. Without this Gaffer opens every call the same way and burns the first
 * thirty seconds working out which of those it is.
 *
 * Delivered as a contextual update at connect rather than a dynamic variable, so
 * it works against the live agent with no dashboard configuration: dynamic
 * variables only do anything if the agent prompt already interpolates them.
 */

export type CallBrief = {
  intent: string;
  /**
   * Which job this call is: helping someone use kit they already have, or
   * selling them kit they don't.
   *
   * Guides and the FAQ are support; everything else defaults to sales, which is
   * how the home page and the catalogue already behave. Kept separate from
   * `intent` because it selects the *agent* — support calls can be routed to a
   * differently-configured ElevenLabs agent, which is the only way to give them
   * a genuinely different opening and instructions without permission to
   * override the sales agent's own.
   */
  mode: "support" | "sales";
  brief: string;
  /**
   * The literal first thing Gaffer says.
   *
   * This is why every call used to open identically no matter which page it was
   * started from: the agent speaks its configured first_message the instant the
   * socket connects, which is *before* a contextual update can land. Sending the
   * context alone therefore never changed the greeting — only what came after.
   * This is passed as overrides.agent.firstMessage so the opening line itself is
   * about the page they're on.
   */
  opening: string;
};

const title = (slug: string) =>
  slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * How to actually run a sale on the phone. Spelled out because the tools now
 * enforce it — add_to_basket refuses kit that isn't free, and go_to_checkout
 * refuses a basket with a bad line, so an agent that doesn't know the sequence
 * will just hit walls.
 */
const SELL_CLOSE =
  "Get their dates first — everything else depends on them. Use browse_for or find_gear to put real " +
  "options on screen and check what's actually free for those dates; never promise something you " +
  "haven't checked. When they pick one, add_to_basket highlights it on screen and drops it in. " +
  "If it's booked out you'll be handed alternatives — offer those rather than dead-ending. " +
  "Quote the daily rate and the refundable holding deposit. To close: review_basket first, so they " +
  "see the full breakdown, and only once they confirm again, go_to_checkout. Two confirmations, " +
  "never one.";

/**
 * What to do when the call can't finish the job — which is most support calls.
 *
 * A voice call leaves no trace for the customer, so anything needing follow-up
 * has to land somewhere they can find it again. Signed-in callers already have
 * a thread Gaffer answers in; everyone else needs either an email or an account.
 */
const FOLLOW_UP =
  "The moment you have taken someone's name, number, email or a requirement you can't settle on " +
  "the call, use log_enquiry — that is what puts it in front of the team. Details you only say " +
  "back to the caller are lost the second the call ends. Do it before you wrap up, every time. " +
  "Then: if they're signed in, say you'll reply in their chat and use open_chat so they know " +
  "where to look. If they're not, ask for their email and use send_follow_up to put it in " +
  "writing; then offer them an account with offer_account, because a signed-in customer gets a " +
  "chat you answer directly instead of waiting on email. Ask once, naturally, and don't push it " +
  "if they say no.";

/**
 * Fill the silence, and stop paying for it twice.
 *
 * The lookups themselves are quick — those endpoints answer in well under a
 * second — but each one costs a full model round-trip, so a three-item request
 * chains seven of them and the caller sits through half a minute of nothing.
 * There's no spinner on a phone call. One short line before the lookups turns
 * dead air into a pause someone will happily wait through.
 *
 * The second half is the bigger win. find_gear and browse_for are already given
 * the dates and already report what's free, and the agent was following them
 * with check_availability for the very same item and dates — doubling the wait
 * to learn what it had just been told.
 */
const SPOKEN_PACE =
  "Checking something takes a few seconds, and the caller hears silence the whole time with nothing " +
  "on screen to say you're working. So say what you're doing before you do it — one short line, " +
  "'let me check those dates for you', then make the call. If they've asked about several items at " +
  "once, say it once up front ('give me a moment, I'll check all three') rather than before each " +
  "one, then tell them everything you found together. Never go quiet mid-lookup. " +
  "And don't ask the same question twice: find_gear and browse_for already tell you what's free for " +
  "the dates you gave them, so never follow one with check_availability for the same item and dates.";

/**
 * Don't narrate an action that didn't happen.
 *
 * Observed on a real call on the sister site: the agent announced "I've pulled
 * that up on your screen" three times while every tool was returning an error.
 * The caller is then looking at a screen that contradicts the voice, which is
 * worse than never offering — it reads as the whole thing being broken.
 */
const TOOL_HONESTY =
  "Every tool hands you back a result — read it before you speak. Never claim you have shown, " +
  "added, filed or changed something unless the tool said it worked. If it returns an error or " +
  "says it couldn't find something, say so plainly and offer another way.";

export function pageBrief(pathname: string, topic?: string): CallBrief {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const named = topic ? ` They opened it from: "${topic}".` : "";

  // the two intents that mean "they already have the kit and need a hand"
  const SUPPORT_INTENTS = new Set(["setup-help", "troubleshoot"]);

  const wrap = (intent: string, brief: string, opening: string): CallBrief => ({
    intent,
    mode: SUPPORT_INTENTS.has(intent) ? "support" : "sales",
    opening,
    brief:
      `[Context — not spoken by the caller] ` +
      (SUPPORT_INTENTS.has(intent)
        ? `THIS IS A SUPPORT CALL, not a sales call. They already have kit, or are about to use ` +
          `it, and something needs explaining or fixing. Do not pitch, upsell or steer them to the ` +
          `catalogue unless they ask to rent something. Your job is to get them working. `
        : `This is a sales call. `) +
      `They started this call from ${path} on the Db Cinema Rentals website.${named} ${brief} ` +
      `${FOLLOW_UP} ${SPOKEN_PACE} ${TOOL_HONESTY} Don't read this context aloud, and don't re-introduce ` +
      `yourself — you've already opened the call.`,
  });

  // a specific guide → they are mid-task and want to be walked through it
  if (seg[0] === "guides" && seg[1]) {
    return wrap(
      "setup-help",
      `They are reading the "${title(seg[1])}" guide, so assume hands-on setup help — rigging, ` +
        `balancing, mounting, menu settings. Walk them through it one step at a time and wait for ` +
        `them to confirm each step before moving on. Don't try to sell them anything unless they ask.`,
      `Gaffer here — you're on the ${topic ?? title(seg[1])} guide. Want me to talk you through it, ` +
        `or is there one bit that's not behaving?`,
    );
  }
  if (seg[0] === "guides") {
    return wrap(
      "setup-help",
      "They are browsing the setup guides, so assume they want practical help using kit they " +
        "already have out. Find out which piece, then talk them through it step by step.",
      "Gaffer here. Which bit of kit are you setting up? I'll walk you through it.",
    );
  }

  if (seg[0] === "faq") {
    return wrap(
      "troubleshoot",
      "They are on the FAQ, so assume something is wrong or unclear — a fault with the kit, a " +
        "damage or deposit question, a late return, delivery or collection. Diagnose before you " +
        "advise, give a direct answer, and if it needs a human say so and take their details. " +
        "If it turns out to be a how-do-I question about using the kit rather than a policy one, " +
        "take them to the guides with navigate_to and walk them through it there.",
      "Gaffer here. What's the problem — something not working, or a question about deposits, " +
        "dates or returns?",
    );
  }

  if (seg[0] === "contact") {
    return wrap(
      "enquiry",
      "They were on the contact page about to write a message, so they have a specific question " +
        "and would rather not type it. Find out what it is. If it turns into a booking or needs " +
        "following up, capture their name and how to reach them before the call ends.",
      "Gaffer here — saves you typing it out. What did you want to ask?",
    );
  }

  // shopping surfaces → sell, and actually close
  if (seg[0] === "gear" && seg[1]) {
    return wrap(
      "sell",
      `They are looking at the "${title(seg[1])}" listing. Help them decide whether it's right for ` +
        `their shoot, and suggest what pairs with it. ${SELL_CLOSE}`,
      `Gaffer here — that's the ${topic ?? title(seg[1])}. Want me to check if it's free for your dates?`,
    );
  }
  if (seg[0] === "gear") {
    return wrap(
      "sell",
      `They are browsing the catalogue. Find out what they're shooting and build them a kit. ${SELL_CLOSE}`,
      "Gaffer here. What are you shooting, and when? I'll pull up what's free.",
    );
  }
  if (seg[0] === "cart" || seg[0] === "checkout") {
    return wrap(
      "close",
      "They already have kit in the basket, so this is the last hurdle — expect a question about " +
        "dates, deposit, delivery or something they're unsure about. Run check_basket early: if a " +
        "line has gone unavailable, say so plainly and offer either a swap (suggest_alternatives) " +
        "or remove_unavailable, rather than letting them hit a blocked checkout. Once it's clean, " +
        "go_to_checkout.",
      "Gaffer here. Anything you want checking before you book — dates, deposit, delivery?",
    );
  }

  if (seg[0] === "membership" || seg[0] === "join") {
    return wrap(
      "membership",
      "They are looking at membership. Explain what the tiers actually save them for the kind of " +
        "work they do, and sign them up if it's a fit.",
      "Gaffer here. Tell me how often you shoot and I'll tell you if membership actually pays off.",
    );
  }
  if (seg[0] === "how-it-works" || seg[0] === "about") {
    return wrap(
      "enquiry",
      "They are new and working out how renting here works. Keep it plain — dates, deposit, " +
        "collection or delivery — then steer them toward the kit they need.",
      "Gaffer here. First time renting with us? Ask me anything — dates, deposits, collection.",
    );
  }

  return wrap(
    "general",
    "They are on the home page, so you don't know yet what they want. Ask, then either help them " +
      "find kit or answer the question.",
    "Gaffer here. What are you after — kit for a shoot, or a hand with something?",
  );
}

/**
 * Caller signing off.
 *
 * Substring matching is not good enough here — "that's all I need to know about
 * the deposit, but what about Friday?" contains "that's all" and is the opposite
 * of a sign-off. Getting this wrong hangs up on a paying customer mid-sentence,
 * so a sign-off has to be the *whole* utterance: strip the filler off both ends
 * and what's left must be a closing phrase and nothing more.
 *
 * "thanks" on its own is deliberately not a sign-off. People say it constantly
 * mid-call.
 */
// "no" is filler in "no, that's everything" but load-bearing in "no more
// questions" — don't eat it there.
const LEAD = /^(ok(ay)?|alright|right|yeah|yep|yes|no(?!\s+more)|nope|erm|um|uh|well|cool|great|perfect|brilliant|lovely|nice|super)\b\s*/;
const TAIL =
  /\s*\b(thanks|thank you|thanks a lot|cheers|mate|then|so much|very much|bye bye|bye|goodbye|see you|see ya|take care|have a (good|great|nice) (one|day|evening|weekend))\b\s*$/;
const FAREWELL = /\b(bye|goodbye|see you|see ya|take care|have a (good|great|nice) (one|day|evening|weekend))\b/;

/** What's left after the filler comes off, matched whole. */
const CORE =
  /^(thats (all|it|everything|us)|that is (all|it|everything)|thatll be all|that will be all|nothing else|no more questions|im (all )?(good|done|sorted|set)|i am (all )?(good|done|sorted|set)|were (all )?done|we are (all )?done|all (done|good|set)|thats me)$/;

export function isSignOff(message: string): boolean {
  // normalise away punctuation and apostrophes: "That's all, thanks!" -> "thats all thanks"
  let s = String(message ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return false;
  // anything this long is a real sentence, not someone hanging up
  if (s.split(" ").length > 8) return false;

  const hadFarewell = FAREWELL.test(s);

  // peel filler off both ends until it stops shrinking
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(LEAD, "").replace(TAIL, "").trim();
  }

  if (CORE.test(s)) return true;
  // nothing left but pleasantries — only a sign-off if one of them was a farewell
  return s === "" && hadFarewell;
}
