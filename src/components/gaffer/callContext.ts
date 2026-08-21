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

export type CallBrief = { intent: string; brief: string };

const title = (slug: string) =>
  slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const SELL_CLOSE =
  "Quote the daily rate and the holding deposit, offer to put it in the basket for their dates, " +
  "and ask for the dates if you don't have them.";

export function pageBrief(pathname: string, topic?: string): CallBrief {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const named = topic ? ` They opened it from: "${topic}".` : "";

  const wrap = (intent: string, brief: string): CallBrief => ({
    intent,
    brief:
      `[Context — not spoken by the caller] They started this call from ${path} on the Db Cinema ` +
      `Rentals website.${named} ${brief} Open by confirming what they need in one short sentence, ` +
      `then help. Don't read this context aloud.`,
  });

  // a specific guide → they are mid-task and want to be walked through it
  if (seg[0] === "guides" && seg[1]) {
    return wrap(
      "setup-help",
      `They are reading the "${title(seg[1])}" guide, so assume hands-on setup help — rigging, ` +
        `balancing, mounting, menu settings. Walk them through it one step at a time and wait for ` +
        `them to confirm each step before moving on. Don't try to sell them anything unless they ask.`,
    );
  }
  if (seg[0] === "guides") {
    return wrap(
      "setup-help",
      "They are browsing the setup guides, so assume they want practical help using kit they " +
        "already have out. Find out which piece, then talk them through it step by step.",
    );
  }

  if (seg[0] === "faq") {
    return wrap(
      "troubleshoot",
      "They are on the FAQ, so assume something is wrong or unclear — a fault with the kit, a " +
        "damage or deposit question, a late return, delivery or collection. Diagnose before you " +
        "advise, give a direct answer, and if it needs a human say so and take their details.",
    );
  }

  if (seg[0] === "contact") {
    return wrap(
      "enquiry",
      "They were on the contact page about to write a message, so they have a specific question " +
        "and would rather not type it. Find out what it is. If it turns into a booking or needs " +
        "following up, capture their name and how to reach them before the call ends.",
    );
  }

  // shopping surfaces → sell, and actually close
  if (seg[0] === "gear" && seg[1]) {
    return wrap(
      "sell",
      `They are looking at the "${title(seg[1])}" listing. Help them decide whether it's right for ` +
        `their shoot, and suggest what pairs with it. ${SELL_CLOSE}`,
    );
  }
  if (seg[0] === "gear") {
    return wrap("sell", `They are browsing the catalogue. Find out what they're shooting and build them a kit. ${SELL_CLOSE}`);
  }
  if (seg[0] === "cart" || seg[0] === "checkout") {
    return wrap(
      "close",
      "They already have kit in the basket and are at the checkout, so this is the last hurdle — " +
        "expect a question about dates, deposit, delivery or something they're unsure about. " +
        "Answer it and get the booking over the line.",
    );
  }

  if (seg[0] === "membership" || seg[0] === "join") {
    return wrap(
      "membership",
      "They are looking at membership. Explain what the tiers actually save them for the kind of " +
        "work they do, and sign them up if it's a fit.",
    );
  }
  if (seg[0] === "how-it-works" || seg[0] === "about") {
    return wrap(
      "enquiry",
      "They are new and working out how renting here works. Keep it plain — dates, deposit, " +
        "collection or delivery — then steer them toward the kit they need.",
    );
  }

  return wrap(
    "general",
    "They are on the home page, so you don't know yet what they want. Ask, then either help them " +
      "find kit or answer the question.",
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
