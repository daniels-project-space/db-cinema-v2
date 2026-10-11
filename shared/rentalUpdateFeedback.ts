/** Equipment completion and card-authorisation progress are separate facts. */
export function rentalUpdateFeedback(update: { applied: boolean; kind?: string; status?: string | null }) {
  if (update.status === "swap_refund_pending") return {
    title: "Deposit paid · rental refund processing",
    body: "The additional refundable deposit is paid. Your separate rental-price refund is processing to the original payment method. Your original kit remains reserved until the bank confirms it. Please do not pay again.",
  };
  if (update.status === "swap_refund_failed" || update.status === "swap_settlement_review") return {
    title: "Deposit paid · replacement needs team review",
    body: "Your additional refundable deposit is recorded, but the replacement is not confirmed. Your original kit remains in place. Open your rental conversation so the team can review the separate refund and equipment settlement. Please do not pay again.",
  };
  if (update.status === "refund_pending") return {
    title: "Equipment update withdrawn · refund in progress",
    body: "The equipment update was not applied. Its payment is being returned to the original payment method. Open your rental conversation to check progress.",
  };
  if (["refunded", "expired"].includes(update.status ?? "")) return {
    title: "Equipment update closed",
    body: "This equipment update was withdrawn. Open your rental conversation for the current booking and refund details.",
  };
  if (update.applied) {
    const title = update.kind === "swap" ? "Replacement applied to your rental" :
      update.kind === "draft" ? "Updated kit saved" : "Items added to your rental";
    const kit = update.kind === "swap" ? "Your rental and conversation now show the agreed replacement." :
      update.kind === "draft" ? "Your paid checkout now includes the updated kit. Continue verification in your rental account." :
      "Your rental and conversation now include the extra items.";
    const security = update.status === "scheduled" ? " Your card authorisation is scheduled for your agreed pickup time." :
      update.status === "requires_action" ? " Your card still needs bank approval; open your rental account to complete it." :
      ["failed", "requires_payment_method", "requires_confirmation"].includes(update.status ?? "") ? " Your security card needs attention. Open your rental account to resolve it before collection." : "";
    return { title, body: kit + security };
  }
  return {
    title: "Payment received · equipment update pending",
    body: update.status === "requires_action"
      ? "Complete the bank approval to finish the equipment update. You can resume it in your rental conversation."
      : "Your payment is received, but the equipment update is not yet confirmed. Open your rental conversation to check progress. Please do not pay again.",
  };
}
