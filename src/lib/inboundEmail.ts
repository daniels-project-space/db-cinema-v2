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
  const date = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const label = (value: string) => equipmentOfferLabel(value).replace(/[\[\]]/g, "");
  const link = (title: string, slug: string) => slug ? "[" + label(title) + "](https://dbcinemarentals.com/gear/" + encodeURIComponent(slug) + ")" : label(title);
  const rows: any[] = Array.isArray(cards) ? cards : [];
  const sections: string[] = [];

  if (enquiry) {
    const period = enquiry.start === enquiry.end ? date(enquiry.start) : date(enquiry.start) + " to " + date(enquiry.end);
    const exactWindow = enquiry.timed ? String(enquiry.pickupTime) + " pickup / " + String(enquiry.returnTime) + " return (London)" : "";
    const suggestedWindow = enquiry.availabilityWindow
      ? "suggested " + enquiry.availabilityWindow.pickupTime + " pickup / " + enquiry.availabilityWindow.returnTime + " return (London)"
      : "";
    const timing = exactWindow || suggestedWindow;
    const confirmed = enquiry.requests.map(request => {
      const subject = label(request.subject);
      if (request.fulfilled === null) return "unconfirmed quantity of " + subject + " (" + request.quantity + " requested)";
      return request.fulfilled + " of " + request.quantity + " requested " + subject;
    }).join("; ");
    const requestIssues = enquiry.requests.filter(request => request.availabilityIssue);
    const confirmedRequests = enquiry.requests.filter(request => request.fulfilled !== null &&
      (!request.availabilityIssue || request.availabilityIssue === "combined_stock_changed"));
    const issueText = (request: typeof enquiry.requests[number]) => request.availabilityIssue === "combined_stock_changed"
      ? "The final basket check couldn't fit the remaining requested quantity of " + label(request.subject)
      : request.availabilityIssue === "no_common_window"
        ? "No shared pickup/return window fits " + label(request.subject)
        : "The live stock check failed for " + label(request.subject) + " (" + request.quantity + " requested)";

    if (requestIssues.length) {
      const confirmedText = confirmedRequests.map(request => request.fulfilled + " of " + request.quantity + " requested " + label(request.subject)).join("; ");
      sections.push("Thanks for getting in touch. For " + period + (timing ? ", " + timing : "") + ", " +
        (confirmedText ? "I can confirm " + confirmedText + ". " : "") + requestIssues.map(issueText).join(". ") + ".");
    } else if (enquiry.stockVerified) {
      sections.push("Thanks for getting in touch. For " + period + (timing ? ", " + timing : "") + ", I can confirm " + confirmed + ".");
    } else if (enquiry.availabilityIssue === "no_common_window") {
      sections.push("Thanks for getting in touch. The requested items don't share one pickup and return window on " + period + ". Send a preferred time window or different dates and I'll check the full set again.");
    } else if (enquiry.availabilityIssue === "combined_stock_changed") {
      sections.push("Thanks for getting in touch. The final stock check found that the proposed quantities don't fit together for " + period + " at " + (exactWindow || "the selected times") + ". I've listed only items that passed that check.");
    } else if (enquiry.availabilityIssue === "stock_check_failed") {
      sections.push("Thanks for getting in touch. I couldn't complete the live stock check for " + period + ", so I can't confirm the requested quantities yet.");
    } else if (enquiry.estimated) {
      sections.push("Thanks for getting in touch. Please send your pickup and return dates so I can check the requested quantities.");
    } else if (!enquiry.timed) {
      sections.push("Thanks for getting in touch. I need pickup and return times for " + period + " to confirm the quantities.");
    } else {
      sections.push("Thanks for getting in touch. I couldn't verify the requested quantities for " + period + " at " + exactWindow + ".");
    }

    for (const request of enquiry.requests) {
      if (request.quantityUnit) {
        sections.push("Please confirm how many complete kits you need; " + request.quantityUnit + " describes individual components.");
      }
      if (request.availabilityIssue === "stock_check_failed") {
        sections.push("- No quantity of " + label(request.subject) + " is confirmed because its live stock check failed.");
      }
      if (request.availabilityIssue === "no_common_window") {
        sections.push("- " + label(request.subject) + " could not be confirmed in a shared pickup and return window.");
      }
      for (const line of request.lines) {
        const alternative = line.alternative ? " (alternative to " + label(request.subject) + "; please confirm)" : "";
        sections.push("- " + line.quantity + " × " + link(line.title, line.slug) + " — " + gbp(line.total) + alternative + ".");
      }
      if (!request.lines.length && request.fulfilled === 0 && enquiry.stockVerified) {
        sections.push("- No matching " + label(request.subject) + " are available for these dates and times.");
      }
    }

    if (enquiry.total !== null) {
      const totalLabel = enquiry.complete ? "Gear hire total" : enquiry.stockVerified ? "Gear hire for the confirmed items" : "Indicative gear hire";
      sections.push(totalLabel + ": " + gbp(enquiry.total) + " for " + enquiry.days + " rental day" + (enquiry.days === 1 ? "" : "s") + ".");
      if (rows.some(card => Number.isFinite(card?.item?.saved) && card.item.saved > 0)) sections.push("Any multi-day rate has already been applied.");
    }
    if (!enquiry.requirementsComplete) sections.push("This covers the items listed; please send the remaining requirements.");
    if (preparedBasketUrl) sections.push("[Review and book your basket](" + preparedBasketUrl + ").");
    sections.push("This quote doesn't reserve the gear; availability is checked again when you book.");
  } else if (String(reply ?? "").trim()) {
    sections.push(String(reply).trim());
  }

  const quotedIds = new Set((enquiry?.requests ?? []).flatMap(request => request.lines.map(line => line.listingId)));
  const options = [...new Map(rows.filter(card => card?.item?.listingId != null &&
    !(Number.isSafeInteger(card.item.availableUnits) && card.item.availableUnits === 0) && !quotedIds.has(String(card.item.listingId)))
    .map(card => [String(card.item.listingId), card])).values()];
  if (options.length) {
    sections.push((enquiry ? "Other listed options" : "Available gear options") + ":");
    for (const card of options) {
      const item = card.item;
      const details: string[] = [];
      const available = Number.isSafeInteger(item.availableUnits) && item.availableUnits >= 0 ? item.availableUnits : null;
      const requested = Number.isSafeInteger(item.requestedMicKitCount) && item.requestedMicKitCount > 0 ? item.requestedMicKitCount : null;
      if (available === null) details.push("stock count not verified");
      else if (requested !== null && available < requested) details.push(available + " available; " + requested + " kits requested, so this listing is short by " + (requested - available));
      else if (requested !== null) details.push(available + " available; " + requested + " kits requested");
      else details.push(available + " available");
      if (Number.isFinite(item.total) && Number.isSafeInteger(item.days) && item.days > 0) {
        details.push("gear hire " + gbp(item.total) + " for " + item.days + " rental day" + (item.days === 1 ? "" : "s") + (item.quoteTimed ? "" : " (provisional until pickup/return times are confirmed)"));
      } else if (Number.isFinite(item.perDay)) {
        details.push("from " + gbp(item.perDay) + " per rental day");
      }
      sections.push("- " + link(String(item.title ?? "Gear option"), String(item.slug ?? "")) + " — " + details.join("; ") + ".");
    }
  }

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
import { equipmentOfferLabel } from "../../shared/equipmentIdentity";
