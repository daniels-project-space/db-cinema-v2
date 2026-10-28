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
  const requested = quote.requests.map(request => request.quantity + " × " + request.subject).join("; ") || "the requested items";
  const counts = quote.requests.map(request => request.fulfilled === null
    ? "no quantity confirmed for " + request.quantity + " requested " + request.subject
    : request.fulfilled + " of " + request.quantity + " requested " + request.subject + " confirmed").join("; ");
  const issueText = (request: GafferEmailQuote["requests"][number]) => request.availabilityIssue === "combined_stock_changed"
    ? (request.fulfilled === null
      ? "the final basket check did not return a confirmed quantity for " + request.quantity + " requested " + request.subject
      : "the final basket check confirmed " + request.fulfilled + " of " + request.quantity + " requested " + request.subject + "; the remaining " + Math.max(0, request.quantity - request.fulfilled) + " did not fit at those times")
    : request.availabilityIssue === "no_common_window"
      ? "no shared pickup/return window could be confirmed for " + request.quantity + " requested " + request.subject
      : request.availabilityIssue === "stock_check_failed"
        ? "the live stock check failed for " + request.quantity + " requested " + request.subject + "; no quantity is confirmed"
        : "availability is not confirmed for " + request.quantity + " requested " + request.subject;
  if (quote.estimated) return "I need pickup and return dates before I can check availability for " + requested + ".";
  const itemIssues = quote.requests.filter(request => request.availabilityIssue);
  if (itemIssues.length) {
    const confirmed = quote.requests.filter(request => request.fulfilled !== null &&
      (!request.availabilityIssue || request.availabilityIssue === "combined_stock_changed"))
      .map(request => request.fulfilled + " of " + request.quantity + " " + request.subject).join("; ");
    return (confirmed ? "Confirmed: " + confirmed + ". " : "") + itemIssues.map(issueText).join(". ") + ".";
  }
  if (quote.availabilityIssue === "no_common_window") {
    return "The requested items (" + requested + ") do not share one pickup/return window on those dates. Send a preferred time window and I will check them together.";
  }
  if (quote.availabilityIssue === "combined_stock_changed") {
    return "The final basket check did not confirm the whole set. Item-by-item result: " + counts + ". The remaining quantity did not fit together at those times.";
  }
  if (quote.availabilityIssue === "stock_check_failed") {
    return "The final live stock check did not return a result. Item-by-item result: " + counts + ". I will recheck those exact items before confirming a quote.";
  }
  if (!quote.stockVerified) {
    if (!quote.timed && !quote.availabilityWindow) return "I need pickup and return times for " + requested + " on these dates before I can confirm availability. No quantity is confirmed yet.";
    return "I could not verify these requested quantities for the selected dates and times: " + requested + ". Item-by-item result: " + counts + ". I will recheck those exact items.";
  }
  if (!quote.requirementsComplete) return "Item-by-item result for the listed items: " + counts + ". I still need the remaining requirements before I can confirm the whole request.";
  const alternatives = quote.requests.some(request => request.lines.some(line => line.alternative));
  if (!quote.complete) {
    const shortfalls = quote.requests.filter(request => request.fulfilled !== null && request.fulfilled < request.quantity)
      .map(request => (request.quantity - (request.fulfilled ?? 0)) + " " + request.subject).join("; ");
    return "For this window, I can supply " + counts + ". " + (shortfalls ? "Short by " + shortfalls + ". " : "") + "Would another time or a listed alternative work?";
  }
  if (quote.availabilityWindow) {
    return "I can confirm " + counts + " with a suggested " + quote.availabilityWindow.pickupTime + " pickup and " + quote.availabilityWindow.returnTime + " return (London). Does that window work for you?";
  }
  if (alternatives) return "I can cover the full quantity with the alternatives below. Please confirm the substitutions.";
  return "I can confirm " + counts + " for your dates and times. Here's the gear-only quote.";
}
