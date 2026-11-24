export type CheckoutStartResult =
  | { url: string }
  | { bookingId: string; alreadyPaid: true; sessionId: string };

/** Reopening a completed checkout should resume its success page, never send
 * the renter to an empty payment URL or create a second payment. */
export function checkoutStartDestination(result: CheckoutStartResult): string {
  return "alreadyPaid" in result
    ? `/checkout/success?session_id=${encodeURIComponent(result.sessionId)}`
    : result.url;
}
