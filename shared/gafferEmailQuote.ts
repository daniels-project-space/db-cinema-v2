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
      providedUnits?: number;
      perDay: number;
      total: number;
      alternative: boolean;
    }[];
  }[];
};

/** The email lead is evidence, not an LLM availability assurance. */
export function gafferEmailQuoteIntro(quote: GafferEmailQuote): string {
  if (quote.estimated) return "Here are some options with example prices. What dates and times would you like to collect and return the gear?";
  if (!quote.timed) return "Here’s a provisional quote for your dates. What times would you like to collect and return the gear? I’ll need those to confirm availability and the final price.";
  if (!quote.requirementsComplete) return "Here’s a quote for the items I could identify. Could you clarify the remaining requirements?";
  if (!quote.stockVerified) return "I couldn’t confirm availability for the whole request. The details below show what still needs checking.";
  if (!quote.complete) return "Some of the requested gear is available, but there’s a shortfall shown below. Would different dates or an alternative work for you?";
  const alternatives = quote.requests.some(request => request.lines.some(line => line.alternative));
  return alternatives
    ? "We can cover your quantities using the alternatives below. Would those substitutions work for you?"
    : "The requested gear is available for your times. Here’s your rental quote.";
}
