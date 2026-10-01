import type Stripe from "stripe";
import { MEMBERSHIP_CREDIT_START } from "../../shared/membership";

/** No credit for free invoices, rentals, taxes, trial days or proration adjustments. */
export function paidRecurringMembership(invoice: Stripe.Invoice, lines: Stripe.InvoiceLineItem[], subscription: Stripe.Subscription) {
  if (invoice.status !== "paid" || invoice.currency !== "gbp" || invoice.amount_paid <= 0 || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason ?? "")) return null;
  const ids = new Set(subscription.items.data.map(i => i.id));
  const recurring = lines.filter(l => l.currency === "gbp" && l.parent?.type === "subscription_item_details" &&
    !l.parent.subscription_item_details?.proration && ids.has(l.parent.subscription_item_details?.subscription_item ?? "") && l.amount > 0 && l.period.start * 1000 >= MEMBERSHIP_CREDIT_START);
  const fee = recurring.reduce((sum, l) => sum + Math.max(0, l.amount - (l.discount_amounts ?? []).reduce((n, d) => n + d.amount, 0)), 0);
  const paidMembershipPence = Math.min(invoice.amount_paid, fee);
  if (!Number.isSafeInteger(paidMembershipPence) || paidMembershipPence <= 0) return null;
  const periodEnd = Math.max(...recurring.map(l => l.period.end)) * 1000;
  if (!Number.isSafeInteger(periodEnd)) return null;
  return { paidMembershipPence, periodEnd };
}
