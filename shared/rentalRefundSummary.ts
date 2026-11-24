export type RentalRefundRecord = {
  amountPence: number;
  status: string;
  parts?: { amountPence: number; status: string }[];
};

export function confirmedRentalRefundPence(refund: RentalRefundRecord): number {
  if (refund.parts) {
    return refund.parts.reduce(
      (total, part) => total + (part.status === "succeeded" ? part.amountPence : 0),
      0,
    );
  }
  return refund.status === "succeeded" ? refund.amountPence : 0;
}

export function pendingRentalRefundPence(refund: RentalRefundRecord): number {
  if (refund.parts) {
    return refund.parts.reduce(
      (total, part) => total + (part.status === "pending" ? part.amountPence : 0),
      0,
    );
  }
  return ["prepared", "pending"].includes(refund.status) ? refund.amountPence : 0;
}

export function rentalRefundSummary(
  rentalTotal: number,
  securityAmount: number,
  refunds: RentalRefundRecord[],
) {
  const rentalAmountPence = Math.max(
    0,
    Math.round(rentalTotal * 100) - Math.round(securityAmount * 100),
  );
  const confirmedRefundedPence = refunds.reduce(
    (total, refund) => total + confirmedRentalRefundPence(refund),
    0,
  );
  const pendingRefundPence = refunds.reduce(
    (total, refund) => total + pendingRentalRefundPence(refund),
    0,
  );
  const refundCapacityReservedPence = confirmedRefundedPence + pendingRefundPence;
  return {
    rentalAmountPence,
    confirmedRefundedPence,
    pendingRefundPence,
    remainingRefundCapPence: Math.max(0, rentalAmountPence - refundCapacityReservedPence),
  };
}
