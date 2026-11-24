import { BUSINESS_CONTACT_EMAIL } from "./businessEmail";

export type GafferSupportEligibility = {
  latestCustomerMessage: string;
  humanRequested: boolean;
  resolvedInquiry: boolean;
  asksDates: boolean;
  asksTimes: boolean;
  hasQuote: boolean;
};

const EXPLICIT_SUPPORT_REQUEST = /\b(?:how|where)\s+(?:can|do|should)\s+i\b[^.!?\n]{0,80}\b(?:contact|email|call|reach|speak|talk|support|human|person)\b|\b(?:contact|support)\s+(?:page|form|email|address|details)\b|\b(?:email|phone)\s+address\b|\b(?:can|could|may|would)\s+i\s+(?:please\s+)?(?:contact|email|call|speak|talk|reach|message)\b|\b(?:can|could|may|would|will)\s+you\s+(?:please\s+)?(?:contact|email|call|speak(?:\s+to)?|talk(?:\s+to)?|reach|message)\b|\b(?:please|i(?:'d| would| want to| need to))\s+(?:contact|email|call|speak to|talk to|reach|message)\b|\b(?:speak|talk)\s+to\s+(?:a\s+)?(?:human|person|someone|the team|support)\b|\b(?:get|put|connect)\s+me\s+through\s+to\s+(?:a\s+)?(?:human|person|someone|the team|support)\b/i;
const DIRECT_TEAM_REQUEST = /\b(?:can|could|may|would|will)\s+you\s+(?:please\s+)?(?:put|connect|get)\s+me\s+(?:through\s+to|to|with)\s+(?:a\s+)?(?:human|person|someone|the team|support)\b/i;

export function renterExplicitlyRequestedSupport(text: string): boolean {
  return EXPLICIT_SUPPORT_REQUEST.test(text) || DIRECT_TEAM_REQUEST.test(text);
}
export function mayOfferGafferSupportActions(input: GafferSupportEligibility): boolean {
  if (renterExplicitlyRequestedSupport(input.latestCustomerMessage) || input.humanRequested) return true;
  return !input.resolvedInquiry && !input.asksDates && !input.asksTimes && !input.hasQuote;
}

function supportReferencePattern() {
  const email = BUSINESS_CONTACT_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\[[^\\]\\n]+\\]\\((?:https?:\\/\\/(?:www\\.)?dbcinemarentals\\.com\\/contact\\/?(?:[?#][^\\s)]*)?|\\/contact\\/?(?:[?#][^\\s)]*)?|mailto:${email}(?:\\?subject=[^\\s)]*)?)\\)|https?:\\/\\/(?:www\\.)?dbcinemarentals\\.com\\/contact\\/?(?:[?#][^\\s<>()]*)?|\\/contact\\/?(?:[?#][^\\s<>()]*)?|mailto:${email}(?:\\?subject=[^\\s<>()]*)?|${email})(?![A-Za-z0-9_/-])`,
    "gi",
  );
}

/**
 * Remove contact-channel sentences from otherwise resolved answers when Gaffer
 * has no reason to hand off. This is a deterministic backstop for model drift;
 * message rendering still owns validation and presentation of approved links.
 */
export function suppressIneligibleGafferSupportActions(reply: string, eligible: boolean): string {
  if (eligible || !reply) return reply;
  const supportReference = supportReferencePattern();
  const paragraphs = reply.split(/(\n\s*\n)/);
  const retained = paragraphs.map((paragraph) => {
    if (/^\n\s*\n$/.test(paragraph) || !supportReference.test(paragraph)) return paragraph;
    supportReference.lastIndex = 0;
    const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z“"'[])/);
    const safeSentences = sentences.filter((sentence) => {
      supportReference.lastIndex = 0;
      return !supportReference.test(sentence);
    });
    return safeSentences
      .join(" ")
      .replace(/\s+([,.;!?])/g, "$1")
      .replace(/(?:,\s*|\s+)(?:please\s+)?(?:contact|email|call|reach|write to|message|speak to|talk to)(?:\s+(?:us|the team|our team|support|someone|a person|a human))?(?:\s+(?:at|via|through))?\s*$/i, "")
      .replace(/\b(?:contact|email|reach)\s+(?:us|the team|our team|support)\s*$/i, "")
      .replace(/[,:;\s]+$/, "");
  });
  const clean = retained.join("").replace(/\n\s*\n(?:\s*\n)+/g, "\n\n").trim();
  return clean || "I can help with equipment, rental dates, availability and booking questions. What would you like to know?";
}
