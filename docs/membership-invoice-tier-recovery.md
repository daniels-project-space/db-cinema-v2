# Membership invoice tier recovery

The current paid-invoice grant uses the account's current plan to calculate the bonus. A delayed Starter invoice can therefore receive a Studio bonus after a plan change. Existing credit grants must not be silently rewritten.

`convex/lib/membershipInvoiceSnapshot.ts` is connected to a read-only admin invoice diagnostic, **not** to credit issuance. It accepts trusted price snapshots scoped to the Stripe account and live/test mode, checks invoice and line ownership, rejects ambiguous or unknown subscription lines, and calculates the credit using the recorded historical bonus. Its fixture uses the three price IDs observed in the live recurring-price inventory; the fixture's account ID is synthetic and is not production configuration. Without an approved `MEMBERSHIP_INVOICE_PRICE_SNAPSHOTS` configuration the diagnostic reports that evidence needs review; no production mapping has been installed or verified.

Before integration:

1. Record an append-only, authenticated account/mode/price-ID mapping with the actual plan, bonus and terms applicable to each price. Reject conflicting records and capture every future price before issuing checkout sessions. Validate legacy and deactivated prices as well as active prices; never infer a historical plan from today's subscription, a mutable lookup key or an invoice amount.
2. Add a durable invoice review/retry queue with an actionable admin alert for missing, ambiguous or conflicting evidence. Recording a review must not stop a paid rental from reaching its normal confirmation flow or lose the invoice for later reconciliation.
3. Check for an existing grant before applying a new snapshot, preserve its recorded amount on retries, and reconcile refunds and any disputed historic grants separately. Record the price and terms snapshot on each new grant; use the stored earned amount for later refunds.
4. Verify the complete provider event, checkout, renewal, plan-change, retries, mixed-line, refund and recovery paths in an isolated Stripe environment. Confirm production mapping and alert readiness before enabling it.

The resolver does not change live billing, create credits, process payments, or prove that any existing customer received an incorrect credit.
