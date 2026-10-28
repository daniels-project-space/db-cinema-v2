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
const CALLBACK_REQUEST_RE = /\b(?:please\s+)?(?:call|phone|ring)\s+me(?:\s+back)?(?:\s+please)?\b|\b(?:can|could|would)\s+(?:you|someone|somebody|anyone|the team|the owner|a person|a human)\s+(?:please\s+)?(?:call|phone|ring)\s+me(?:\s+back)?\b|\b(?:can|could|would|please)\s+(?:you\s+)?(?:arrange|schedule|set up)\s+(?:a\s+)?callback\b|\b(?:i(?:['’]d| would| want| need| prefer)\s+(?:a\s+)?callback)\b/i;

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

/** Preserve Gaffer's exact catalogue cards in email, where there is no separate card UI. */
export function formatGafferEmailReply(reply: string, cards: unknown, enquiry?: import("../../shared/gafferEmailQuote").GafferEmailQuote, preparedBasketUrl?: string): string {
  const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
  const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const label = (value: string) => value.replace(/\s+/g, " ").replace(/[\[\]]/g, "").trim();
  const link = (title: string, slug: string) => slug ? `[${label(title)}](https://dbcinemarentals.com/gear/${encodeURIComponent(slug)})` : label(title);
  const rows: any[] = Array.isArray(cards) ? cards : [];
  const sections = [String(reply ?? "").trim()];
  if (enquiry) {
    const period = enquiry.start === enquiry.end ? date(enquiry.start) : `${date(enquiry.start)} to ${date(enquiry.end)}`;
    sections.push(`${enquiry.estimated ? "Example dates: " : ""}${period}${enquiry.timed ? `, ${enquiry.pickupTime} pickup / ${enquiry.returnTime} return (London)` : ""}. ${enquiry.days} rental day${enquiry.days === 1 ? "" : "s"}${!enquiry.timed ? " (date-only estimate)" : ""}.`);
    const lines: string[] = [];
    for (const request of enquiry.requests) {
      for (const line of request.lines) {
        const card = rows.find(card => String(card?.item?.listingId) === line.listingId)?.item;
        const saving = Number.isFinite(card?.saved) && card.saved > 0 ? ` Includes ${gbp(card.saved * line.quantity)} multi-day saving.` : "";
        lines.push(`${line.quantity} × ${link(line.title, line.slug)}: ${gbp(line.total)}${line.alternative ? ` (suggested alternative to ${label(request.subject)}; please confirm)` : ""}.${line.providedUnits && line.providedUnits !== line.quantity ? ` Provides ${line.providedUnits} gear units in the package.` : ""}${saving}`);
      }
      if (request.quantityUnit) lines.push(`${request.quantity} × ${label(request.subject)}: please confirm the number of complete kits needed (${request.quantityUnit}).`);
      else if (!request.lines.length) lines.push(`${request.quantity} × ${label(request.subject)}: ${request.fulfilled === 0 && enquiry.stockVerified ? "unavailable for these times" : "not yet confirmed"}.`);
      if (request.fulfilled !== null && request.fulfilled < request.quantity) lines.push(`${request.fulfilled} covered; ${request.quantity - request.fulfilled} outstanding for ${label(request.subject)}.`);
    }
    if (lines.length) sections.push(lines.join("\n"));
    if (!enquiry.requests.some(request => request.lines.length) && !enquiry.stockVerified) {
      const options = rows.filter(card => card?.item?.availableUnits == null && Number.isFinite(card?.item?.total)).slice(0, 3);
      for (const { item } of options) sections.push(`${link(item.title, item.slug)}: ${gbp(item.total)} per unit for ${item.days} rental day${item.days === 1 ? "" : "s"}. Availability is unconfirmed.`);
    }
    if (enquiry.total !== null) sections.push(`${enquiry.complete ? "Gear-hire total" : enquiry.stockVerified ? "Total for the covered items only" : "Indicative gear-hire total"}: ${gbp(enquiry.total)}.`);
    if (enquiry.timed && !enquiry.stockVerified) sections.push("Availability is unconfirmed. Please check the basket before booking.");
    if (!enquiry.requirementsComplete) sections.push("This covers the items listed above. Please confirm the remaining requirements.");
    sections.push("This quote does not reserve the gear. Availability is checked again when you book.");
  } else {
    const seen = new Set<string>();
    for (const card of rows) {
      const item = card?.item;
      if (typeof item?.title !== "string") continue;
      const key = String(item.listingId ?? item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      const requested = item.itemType === "wireless-mic" && Number.isSafeInteger(item.requestedMicKitCount) ? item.requestedMicKitCount : null;
      const stock = item.needsTimes ? "Dates and times needed to confirm availability."
        : Number.isSafeInteger(item.availableUnits) && item.availableUnits >= 0 && requested !== null ? item.availableUnits < requested
          ? `${item.availableUnits} available; ${requested} kits requested, so this listing is short by ${requested - item.availableUnits}.`
          : `${item.availableUnits} available; enough to cover the ${requested} requested kits.`
        : Number.isSafeInteger(item.availableUnits) && item.availableUnits >= 0 ? `${item.availableUnits} ${item.stockAfterProposal ? "additional rental units available after the other proposed items" : "available for these times"}.`
        : "Availability unconfirmed.";
      sections.push(`${link(item.title, item.slug)}${Number.isFinite(item.total) && Number.isSafeInteger(item.days) && item.days > 0 ? `: ${gbp(item.total)} for ${item.days} rental day${item.days === 1 ? "" : "s"}` : Number.isFinite(item.perDay) ? `: ${gbp(item.perDay)}/day` : ""}. ${stock}`);
    }
  }
  if (preparedBasketUrl) sections.push(`[Review your rental basket](${preparedBasketUrl}) and continue booking. The private link lasts seven days; prices and stock are rechecked before payment.`);
  sections.push("DB Cinema Rentals team");
  return sections.filter(Boolean).join("\n\n");
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
