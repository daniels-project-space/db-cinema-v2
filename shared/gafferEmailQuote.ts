/** Public, read-only enquiry evidence. A quote never creates a reservation. */
export type GafferEmailQuote = {
  start: string;
  end: string;
  pickupTime?: string;
  returnTime?: string;
  days: number;
  estimated: boolean;
  timed: boolean;
  stockVerified: boolean;
  requirementsComplete: boolean;
  complete: boolean;
  total: number | null;
  requests: {
    subject: string;
    quantity: number;
    quantityUnit?: string;
    fulfilled: number | null;
    lines: {
      listingId: string;
      title: string;
      slug: string;
      quantity: number;
      perDay: number;
      total: number;
      alternative: boolean;
    }[];
  }[];
};

/** The email lead is evidence, not an LLM availability assurance. */
export function gafferEmailQuoteIntro(quote: GafferEmailQuote): string {
  if (quote.estimated) return "Here are catalogue options and example prices. What are your pickup and return dates and times? I need those before confirming quantities or a final period quote.";
  if (!quote.timed) return "I’ve listed a provisional gear quote for your dates. What are your pickup and return times? Those determine the billed duration and let me check the required quantities.";
  if (!quote.requirementsComplete) return "The proposal below covers the listed requirements only. Some of your enquiry still needs clarification; please confirm the remaining items before treating this as a complete kit.";
  if (!quote.stockVerified) return "I couldn’t verify a complete combined-stock proposal for your period. The options below show the checked stock or any unconfirmed availability; please review the quantities still outstanding.";
  if (!quote.complete) return "The live stock check can cover part of your enquiry. The proposal below lists the covered quantities and what is still outstanding. Would you like to adjust the items or the dates?";
  const alternatives = quote.requests.some(request => request.lines.some(line => line.alternative));
  return alternatives
    ? "The live stock check can cover all listed quantities with the proposed alternatives below. Please confirm those substitutions before booking; this quote does not reserve the gear."
    : "The live stock check can cover all listed quantities for your period. Your item totals and multi-day rates are below. Would you like to proceed to booking? This quote does not reserve the gear.";
}
