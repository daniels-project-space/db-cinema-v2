/** All amounts are integer pence; split payments never create extra refundable value. */
export type PaymentBalance = {
  paymentIntentId: string;
  availablePence: number;
  securityPence: number;
};
export type RefundAllocation = { paymentIntentId: string; amountPence: number };
function validate(payments: PaymentBalance[]) {
  const seen = new Set<string>();
  for (const p of payments) {
    if (
      !p.paymentIntentId ||
      seen.has(p.paymentIntentId) ||
      ![p.availablePence, p.securityPence].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      )
    )
      throw Error("Invalid rental payment balance");
    seen.add(p.paymentIntentId);
  }
}
export function rentalRefundPlan(
  payments: PaymentBalance[],
  amountPence: number,
): RefundAllocation[] {
  validate(payments);
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0)
    throw Error("Invalid refund amount");
  let left = amountPence;
  const allocations: RefundAllocation[] = [];
  for (const p of payments) {
    const amount = Math.min(
      left,
      Math.max(0, p.availablePence - p.securityPence),
    );
    if (amount > 0)
      allocations.push({
        paymentIntentId: p.paymentIntentId,
        amountPence: amount,
      });
    left -= amount;
  }
  if (left > 0)
    throw Error(
      "The available rental payment is lower than the requested refund. Check existing provider refunds before proceeding.",
    );
  return allocations;
}
export function cancellationPaymentPlan(
  kind: "full_refund" | "store_credit",
  payments: PaymentBalance[],
  restoredCreditPence: number,
) {
  validate(payments);
  if (!Number.isSafeInteger(restoredCreditPence) || restoredCreditPence < 0)
    throw Error("Invalid restored credit");
  const allocations = payments
    .map((p) => ({
      paymentIntentId: p.paymentIntentId,
      amountPence:
        kind === "full_refund"
          ? p.availablePence
          : Math.min(p.availablePence, p.securityPence),
    }))
    .filter((p) => p.amountPence > 0);
  const refundPence = allocations.reduce((n, p) => n + p.amountPence, 0),
    available = payments.reduce((n, p) => n + p.availablePence, 0);
  return {
    allocations,
    refundPence,
    creditPence:
      (kind === "store_credit" ? available - refundPence : 0) +
      restoredCreditPence,
  };
}
export function securityReturnPlan(
  payments: { paymentIntentId: string; securityPence: number }[],
  refundPence: number,
): RefundAllocation[] {
  validate(payments.map((p) => ({ ...p, availablePence: p.securityPence })));
  if (!Number.isSafeInteger(refundPence) || refundPence < 0)
    throw Error("Invalid security refund");
  let left = refundPence;
  const allocations: RefundAllocation[] = [];
  for (const p of payments) {
    const amount = Math.min(left, p.securityPence);
    if (amount > 0)
      allocations.push({
        paymentIntentId: p.paymentIntentId,
        amountPence: amount,
      });
    left -= amount;
  }
  if (left > 0)
    throw Error("Security refund exceeds captured security payments");
  return allocations;
}

/** Confirmed provider receipts only; a partially failed job may still have successful parts. */
export function confirmedRentalRefundPence(
  jobs: {
    amountPence: number;
    status: string;
    parts?: { status: string; amountPence: number }[];
  }[],
) {
  return jobs.reduce(
    (sum, r) =>
      sum +
      (r.parts
        ? r.parts
            .filter((p) => p.status === "succeeded")
            .reduce((n, p) => n + p.amountPence, 0)
        : r.status === "succeeded"
          ? r.amountPence
          : 0),
    0,
  );
}
