import type Stripe from "stripe";

export type RefundReceipt = {
  paymentIntentId: string; amountPence: number; attemptedAt: number;
  stripeRefundId?: string; approvalRequestId?: string; approvalUrl?: string;
  status: "unknown" | "awaiting_approval" | "pending" | "succeeded" | "failed";
};
export class RefundReviewRequired extends Error {}

function approvalUrl(candidate: unknown, id: string): string | undefined {
  if (typeof candidate !== "string" || !new RegExp(`^https://dashboard\\.stripe\\.com/(?:acct_[A-Za-z0-9]+/)?settings/approvals/requests/${id}(?:[?#].*)?$`).test(candidate)) return undefined;
  return candidate.split(/[?#]/)[0];
}

function approvalId(error: any): string | undefined {
  const candidate = error?.raw?.approval_request ?? error?.approval_request;
  if (typeof candidate === "string" && /^apreq_[A-Za-z0-9]+$/.test(candidate)) return candidate;
  // Stripe's approval-required exception currently includes the request URL.
  return String(error?.raw?.message ?? error?.message ?? "").match(/\bapreq_[A-Za-z0-9]+\b/)?.[0];
}

function checkedRefund(refund: Stripe.Refund, receipt: RefundReceipt, currency: string): RefundReceipt {
  const payment = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (payment !== receipt.paymentIntentId || refund.amount !== receipt.amountPence ||
      refund.currency !== currency.toLowerCase() || !refund.id.startsWith("re_"))
    throw new RefundReviewRequired("The Stripe refund does not match the frozen rental settlement. The team must review it.");
  return { ...receipt, stripeRefundId: refund.id, status: refund.status === "succeeded" ? "succeeded" :
    refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending" };
}

/** Read the exact approved action's result; never approve it or issue a second refund. */
async function approvedResult(stripe: Stripe, receipt: RefundReceipt, currency: string): Promise<RefundReceipt> {
  const approval = await stripe.rawRequest("GET", `/v2/core/approval_requests/${receipt.approvalRequestId}`,
    undefined, { apiVersion: "2026-08-26.preview" });
  if (approval.id !== receipt.approvalRequestId || approval.object !== "v2.core.approval_request" || approval.action !== "refund.create")
    throw new RefundReviewRequired("Stripe approval does not match this refund request.");
  receipt = { ...receipt, approvalUrl: approvalUrl(approval.dashboard_url, approval.id) ?? receipt.approvalUrl };
  if (approval.status === "succeeded") {
    const result = approval.status_details?.succeeded?.result;
    if (result?.object !== "refund" || typeof result.id !== "string" || !/^re_[A-Za-z0-9]+$/.test(result.id))
      throw new RefundReviewRequired("Stripe has not supplied a valid refund receipt for this approval.");
    return checkedRefund(await stripe.refunds.retrieve(result.id), receipt, currency);
  }
  return { ...receipt, status: ["rejected", "expired", "failed", "canceled"].includes(approval.status) ? "failed" : "awaiting_approval" };
}

export async function recoverApprovedRefund(stripe: Stripe, receipt: RefundReceipt, options: {
  currency: string; idempotencyKey: string; metadata?: Record<string, string>; now: number;
  persist: (receipt: RefundReceipt) => Promise<void>;
}): Promise<RefundReceipt> {
  if (receipt.stripeRefundId) return checkedRefund(await stripe.refunds.retrieve(receipt.stripeRefundId), receipt, options.currency);
  if (receipt.approvalRequestId) return approvedResult(stripe, receipt, options.currency);
  // Recover an ambiguous network response by our unique metadata, never by amount alone.
  if (options.metadata) {
    const matches: Stripe.Refund[] = [];
    for await (const refund of stripe.refunds.list({ payment_intent: receipt.paymentIntentId, limit: 100 })) {
      if (Object.entries(options.metadata).every(([key, value]) => refund.metadata?.[key] === value)) matches.push(refund);
    }
    if (matches.length > 1) throw new RefundReviewRequired("Multiple Stripe receipts need review before this cancellation can finish.");
    if (matches.length === 1) return checkedRefund(matches[0], receipt, options.currency);
  }
  // Stripe may prune idempotency keys after 24 hours. Never recreate an ambiguous old request.
  if (options.now - receipt.attemptedAt >= 23 * 60 * 60 * 1000)
    throw new RefundReviewRequired("An older Stripe refund request needs receipt review. No second refund has been issued.");
  try {
    return checkedRefund(await stripe.refunds.create({ payment_intent: receipt.paymentIntentId,
      amount: receipt.amountPence, ...(options.metadata ? { metadata: options.metadata } : {}) },
    { idempotencyKey: options.idempotencyKey }), receipt, options.currency);
  } catch (error) {
    const id = approvalId(error);
    if (!id) throw error;
    const url = String((error as any)?.raw?.message ?? (error as any)?.message ?? "").match(/https:\/\/dashboard\.stripe\.com\/[^\s"']+/)?.[0];
    const pending: RefundReceipt = { ...receipt, approvalRequestId: id, approvalUrl: approvalUrl(url, id), status: "awaiting_approval" };
    // Save the approval ID before the GET: provider/API failures must not lose it.
    await options.persist(pending);
    return approvedResult(stripe, pending, options.currency);
  }
}
