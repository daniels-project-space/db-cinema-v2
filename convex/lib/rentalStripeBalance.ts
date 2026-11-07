import type Stripe from "stripe";
import { RefundReviewRequired } from "./approvedRefund";
import { rentalRefundBalance } from "./rentalRefundBalance";

export async function remainingRentalPayment(stripe: Stripe, payment: Stripe.PaymentIntent, maxPaidPence?: number) {
  const refunds: Stripe.Refund[] = [];
  for await (const refund of stripe.refunds.list({ payment_intent:payment.id, limit:100 })) {
    if (refunds.length >= 100) throw new RefundReviewRequired("Refund history exceeds the safe review bound. No new refund was issued.");
    refunds.push(refund);
  }
  const memberRefunds = new Map<string, number>();
  if (maxPaidPence !== undefined && maxPaidPence < payment.amount_received && refunds.length) {
    const payments = await stripe.invoicePayments.list({ payment:{type:"payment_intent",payment_intent:payment.id}, status:"paid", limit:100 });
    for (const paid of payments.data) {
      const invoiceId = typeof paid.invoice === "string" ? paid.invoice : paid.invoice.id;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const parent = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof parent === "string" ? parent : parent?.id;
      if (!subscriptionId) continue;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const items = new Set(subscription.items.data.map(item => item.id)), memberLines = new Set<string>();
      for await (const line of stripe.invoices.listLineItems(invoiceId, {limit:100})) if (line.parent?.type === "subscription_item_details" && items.has(line.parent.subscription_item_details?.subscription_item ?? "")) memberLines.add(line.id);
      for await (const note of stripe.creditNotes.list({invoice:invoiceId,limit:100})) {
        if (note.status !== "issued" || !note.refunds.length) continue;
        const lines: Stripe.CreditNoteLineItem[] = [];
        for await (const line of stripe.creditNotes.listLineItems(note.id,{limit:100})) lines.push(line);
        if (!lines.length || lines.some(line => !line.invoice_line_item || !memberLines.has(line.invoice_line_item))) continue;
        for (const allocation of note.refunds) {
          const id = typeof allocation.refund === "string" ? allocation.refund : allocation.refund.id;
          memberRefunds.set(id,(memberRefunds.get(id) ?? 0) + allocation.amount_refunded);
        }
      }
    }
  }
  return rentalRefundBalance(payment.amount_received,maxPaidPence,refunds,memberRefunds);
}
