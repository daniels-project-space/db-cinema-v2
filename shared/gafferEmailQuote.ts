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
  availabilityIssue?: "no_common_window" | "combined_stock_changed" | "stock_check_failed";
  availabilityWindow?: { pickupTime: string; returnTime: string; suggested: true };
  requirementsComplete: boolean;
  complete: boolean;
  total: number | null;
  requests: {
    subject: string;
    quantity: number;
    quantityUnit?: string;
    fulfilled: number | null;
    availabilityIssue?: "no_common_window" | "combined_stock_changed" | "stock_check_failed";
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
  const counts = quote.requests.map(request => request.fulfilled === null
    ? request.quantity + " " + request.subject
    : request.fulfilled + " of " + request.quantity + " requested " + request.subject).join("; ");
  if (quote.estimated) return "I can give you an example price, but need pickup and return dates to check stock.";
  const itemIssues = quote.requests.filter(request => request.availabilityIssue);
  if (itemIssues.length) {
    const confirmed = quote.requests.filter(request => request.fulfilled !== null &&
      (!request.availabilityIssue || request.availabilityIssue === "combined_stock_changed"))
      .map(request => request.fulfilled + " of " + request.quantity + " " + request.subject).join("; ");
    const failed = itemIssues.map(request => request.availabilityIssue === "combined_stock_changed"
      ? "The final basket check couldn't fit the remaining requested quantity of " + request.subject
      : request.availabilityIssue === "no_common_window"
        ? "No shared pickup/return window fits " + request.subject
        : "The live stock check failed for " + request.subject + " (" + request.quantity + " requested)").join("; ");
    return (confirmed ? "I can confirm " + confirmed + ". " : "") + failed + ".";
  }
  if (quote.availabilityIssue === "no_common_window") return "The requested items don't share one pickup and return window on those dates. Send another time window or dates and I'll check the full set.";
  if (quote.availabilityIssue === "combined_stock_changed") return "The final stock check couldn't fit the whole basket at those times. I've listed only the quantities it confirmed: " + counts + ".";
  if (quote.availabilityIssue === "stock_check_failed") return "I couldn't complete the final live stock check for the whole basket, so I can't confirm its full quantity.";
  if (!quote.stockVerified) {
    if (!quote.timed && !quote.availabilityWindow) return "I need pickup and return times for these dates before I can confirm the quantity.";
    return "I couldn't confirm the requested quantities for those dates and times.";
  }
  if (!quote.requirementsComplete) return "I can confirm the items listed, but need the remaining requirements before I can confirm the full request.";
  const alternatives = quote.requests.some(request => request.lines.some(line => line.alternative));
  if (!quote.complete) return "I can supply " + counts + " for this window. The remaining quantity is unavailable; would another time or a listed alternative work?";
  if (quote.availabilityWindow) {
    return "I can confirm " + counts + " with a suggested " + quote.availabilityWindow.pickupTime + " pickup and " + quote.availabilityWindow.returnTime + " return (London). Does that window work for you?";
  }
  if (alternatives) return "I can cover the full quantity with the alternatives below. Please confirm the substitutions.";
  return "I can confirm " + counts + " for your dates and times. Here's the gear-only quote.";
}
