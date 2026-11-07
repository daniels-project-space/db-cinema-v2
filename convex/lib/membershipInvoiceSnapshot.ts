import type Stripe from "stripe";
import { MEMBERSHIP_CREDIT_START } from "../../shared/membership";

export type MembershipPriceSnapshot = {
  priceId: string;
  stripeAccountId: string;
  livemode: boolean;
  tier: "plus" | "pro" | "studio";
  bonusPercent: number;
  termsVersion: string;
};

type Resolution =
  | { state: "not_applicable" }
  | { state: "review"; reason: string }
  | { state: "ready"; snapshot: MembershipPriceSnapshot; paidMembershipPence: number; earnedCreditPence: number; periodEnd: number };

export function resolveMembershipInvoiceSnapshot(
  invoice: Stripe.Invoice,
  lines: Stripe.InvoiceLineItem[],
  subscriptionId: string,
  customerId: string,
  stripeAccountId: string,
  snapshots: MembershipPriceSnapshot[],
): Resolution {
  if (invoice.status !== "paid" || invoice.amount_paid <= 0 || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason ?? "")) return { state: "not_applicable" };
  const parent = invoice.parent?.subscription_details?.subscription;
  const invoiceSubscription = typeof parent === "string" ? parent : parent?.id;
  const invoiceCustomer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!stripeAccountId || !subscriptionId || !customerId || invoiceSubscription !== subscriptionId || invoiceCustomer !== customerId || invoice.currency !== "gbp" || !Number.isSafeInteger(invoice.amount_paid) || typeof invoice.livemode !== "boolean") return { state: "review", reason: "invoice_identity" };
  const recurring = lines.filter(line => line.parent?.type === "subscription_item_details" && !line.parent.subscription_item_details?.proration && line.amount > 0);
  if (recurring.length !== 1) return { state: "review", reason: "recurring_lines" };
  const line = recurring[0];
  const details = line.parent?.subscription_item_details;
  const price = line.pricing?.price_details?.price;
  const priceId = typeof price === "string" ? price : price?.id;
  if (details?.subscription !== subscriptionId || line.currency !== "gbp" || !priceId || !Number.isSafeInteger(line.amount) || !Number.isSafeInteger(line.period?.start) || !Number.isSafeInteger(line.period?.end) || line.period.end < line.period.start) return { state: "review", reason: "line_identity" };
  if (line.period.start * 1000 < MEMBERSHIP_CREDIT_START) return { state: "not_applicable" };
  const matching = snapshots.filter(snapshot => snapshot && typeof snapshot === "object" && snapshot.priceId === priceId && snapshot.stripeAccountId === stripeAccountId && snapshot.livemode === invoice.livemode);
  if (matching.length !== 1) return { state: "review", reason: "price_snapshot" };
  const snapshot = matching[0];
  if (!(["plus", "pro", "studio"] as string[]).includes(snapshot.tier) || !Number.isSafeInteger(snapshot.bonusPercent) || snapshot.bonusPercent < 0 || snapshot.bonusPercent > 100 || typeof snapshot.termsVersion !== "string" || !snapshot.termsVersion.trim()) return { state: "review", reason: "snapshot_invalid" };
  const discounts = line.discount_amounts ?? [];
  if (discounts.some(discount => !Number.isSafeInteger(discount.amount) || discount.amount < 0)) return { state: "review", reason: "discount_invalid" };
  const totalDiscount = discounts.reduce((sum, discount) => sum + discount.amount, 0);
  if (!Number.isSafeInteger(totalDiscount) || totalDiscount > line.amount) return { state: "review", reason: "discount_invalid" };
  const paidMembershipPence = Math.min(invoice.amount_paid, line.amount - totalDiscount);
  const periodEnd = line.period.end * 1000;
  const earnedCreditPence = Math.round(paidMembershipPence * (100 + snapshot.bonusPercent) / 100);
  if (!Number.isSafeInteger(paidMembershipPence) || !Number.isSafeInteger(periodEnd) || !Number.isSafeInteger(earnedCreditPence)) return { state: "review", reason: "amount_invalid" };
  if (paidMembershipPence <= 0) return { state: "not_applicable" };
  return { state: "ready", snapshot, paidMembershipPence, earnedCreditPence, periodEnd };
}
