/** Version for operator previews. It contains stock, dates, charges and workflow
 * state; identity documents and payment credentials never enter this value. */
export function rentalControlsSnapshot(
  booking: any,
  refunds: any[] = [],
): string {
  return JSON.stringify([
    String(booking._id),
    booking.status,
    booking.total,
    booking.depositHoldAmount ?? null,
    booking.depositHoldStatus ?? null,
    booking.activeAdditionId ?? null,
    booking.activeExtensionId ?? null,
    !!booking.cancellationDecision,
    !!booking.returnDecision,
    (booking.lineItems ?? []).map((line: any) => [
      String(line.listingId),
      line.qty,
      line.start,
      line.end,
      line.pickupTime ?? null,
      line.returnTime ?? null,
      line.lineTotal ?? null,
    ]),
    refunds
      .map((refund) => [
        String(refund._id),
        refund.status,
        refund.amountPence ?? null,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}
