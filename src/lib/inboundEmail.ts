/**
 * Parsing for inbound email replies to Gaffer follow-ups.
 *
 * Lives here rather than in the route so it can be tested directly — a Next
 * route file may only export handlers and config, and this is the part most
 * likely to break quietly when a mail provider changes its payload shape.
 *
 * Handles the Resend / Postmark / SendGrid shapes, which disagree about
 * capitalisation, nesting and whether recipients are strings or arrays.
 */

/** gaffer+<key>@domain — the key that says which conversation this belongs to. */
export function replyKeyFrom(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = typeof c === "string" ? c : Array.isArray(c) ? c.join(",") : "";
    const m = s.match(/gaffer\+([a-f0-9]{8,64})@/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Just the new text.
 *
 * Without this Gaffer answers the entire quoted history every time, and each
 * round-trip gets longer — by the third reply it is reading the whole thread
 * back to the customer.
 */
export function newTextOnly(body: string): string {
  return String(body ?? "")
    .replace(/\r/g, "")
    .split(/^\s*(?:On .+?wrote:|-{2,}\s*Original Message|_{5,}|>{1,}\s?)/m)[0]
    .trim()
    .slice(0, 4000);
}

/** "Dan <dan@x.com>" and "dan@x.com" both mean dan@x.com. */
export function senderFrom(payload: any): string {
  const raw =
    payload?.from?.email ??
    payload?.From ??
    payload?.from ??
    payload?.sender ??
    payload?.envelope?.from ??
    "";
  const s = typeof raw === "string" ? raw : "";
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

const HUMAN_CONTACT_REQUEST_RE = /\b(?:can you|could you|would you|may i|can i|could i|please|i(?:['’]d like| would like| want| need| prefer| request))\b[^.!?;,\n]{0,40}\b(?:speak|talk|chat|connect|transfer|put me through|escalate|hand(?: me)? off|contact|email|call|phone|ring|reach out|get back|respond|reply)\b[^.!?;,\n]{0,40}\b(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b/i;
const PERSON_CONTACT_REQUEST_RE = /\b(?:can|could|would|please)\s+(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b[^.!?;,\n]{0,40}\b(?:call|phone|ring|email|contact|reach(?: out)?|get back|follow up|respond|reply)\b[^.!?;,\n]{0,20}\b(?:me|us)\b|\b(?:can you|could you|would you|please)\b[^.!?;,\n]{0,35}\b(?:have|ask|send|connect|put|pass|forward)\b[^.!?;,\n]{0,35}\b(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b[^.!?;,\n]{0,35}\b(?:call|phone|ring|email|contact|reach(?: out)?|get back|follow up|respond|reply)\b[^.!?;,\n]{0,20}\b(?:me|us)\b/i;
const HUMAN_DIRECT_REQUEST_RE = /\b(?:i(?:['’]d| would| want| need| prefer| request)|can i|could i|may i)\b[^.!?;,\n]{0,24}\b(?:human|real person|person|live agent|support agent|someone|somebody)\b(?:\s+to\s+(?:speak|talk|chat)\s+(?:to|with))?\s*(?:please)?$/i;
const NEGATED_HUMAN_REQUEST_RE = /\b(?:(?:i\s+)?(?:do not|don't|dont|never|not looking for|not asking for|don't want|do not want|don't need|do not need|no need for|no need to|not interested in|unable to|not able to|can't|cannot)|(?:can|could|would)\s+you\s+not)\b[^.!?;,\n]{0,55}\b(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b/i;
const NEGATED_CALLBACK_REQUEST_RE = /\b(?:do not|don't|dont|never|not|can't|cannot)\b[^.!?;,\n]{0,20}\b(?:call|phone|ring|callback)\b/i;
const CALLBACK_REQUEST_RE = /\b(?:please\s+)?(?:call|phone|ring)\s+me(?:\s+back)?(?:\s+please)?\b|\b(?:can|could|would)\s+(?:you|someone|somebody|anyone|the team|the owner|a person|a human)\s+(?:please\s+)?(?:call|phone|ring)\s+me(?:\s+back)?\b|\b(?:i(?:['’]d| would| want| need| prefer)\s+(?:a\s+)?callback)\b/i;

/** Escalate only an explicit request for a person or a callback. Include the subject,
 * and evaluate clauses independently so a negated mention does not trigger a handoff. */
export function isHumanHandoffRequested(subject: string, body: string): boolean {
  const clauses = `${subject ?? ""}\n${body ?? ""}`.split(/[.!?;,\n]+/);
  return clauses.some((value) => {
    const clause = value.trim();
    if (!clause || NEGATED_HUMAN_REQUEST_RE.test(clause) || NEGATED_CALLBACK_REQUEST_RE.test(clause)) return false;
    return CALLBACK_REQUEST_RE.test(clause) || HUMAN_CONTACT_REQUEST_RE.test(clause) || PERSON_CONTACT_REQUEST_RE.test(clause) || HUMAN_DIRECT_REQUEST_RE.test(clause);
  });
}

/** Every place a provider might put the recipient address. */
export function recipientCandidates(msg: any): unknown[] {
  return [
    msg?.to,
    msg?.To,
    msg?.envelope?.to,
    msg?.OriginalRecipient,
    msg?.recipient,
    msg?.headers?.to,
  ];
}

/** Providers disagree on where the plain-text body lives. */
export function plainBody(msg: any): string {
  return msg?.text ?? msg?.TextBody ?? msg?.plain ?? msg?.["body-plain"] ?? "";
}
