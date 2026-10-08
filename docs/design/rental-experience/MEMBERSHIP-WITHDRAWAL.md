# Membership withdrawal follows the checkout subscription

A completed zero-payment membership trial must be canceled when its pending rental replacement is withdrawn. Previously this session was treated as a payment still processing, leaving the operation and stock locked indefinitely. Paid withdrawals also repeated subscription cancellation on each pending-refund retry.

The withdrawal action retrieves the exact saved membership checkout, account, Stripe customer and subscription. It validates booking, checkout, plan and account email metadata before and after provider cancellation, retrieves an already canceled subscription without canceling twice, and reconciles the real membership account state. The membership checkout is expired and any consumed trial remains consumed. Cancellation uses no immediate invoice or proration. A completed £0 checkout creates neither a cash refund nor a new account credit. A paid checkout keeps the existing separate durable original-payment refund flow.

An unavailable or unconfirmed cancellation keeps the operation and stock locked. An accepted cancellation whose response is lost is recovered by retrieving its provider state. Provider identity mismatches never release the operation. Actual account and membership mutations run in the handler fixture; controlled Stripe transport does not prove live provider execution.

Validation: `npm test`, `node scripts/test-addition-withdrawal.cjs`, `npx tsc --noEmit`, production build and Graphify update. Prior actual 3a464da action reproduces the completed £0 processing lock using the same fixture (`/tmp/dbc-membership-withdrawal-negative.log`). The archive regression group separately confirms the requested 30 days after latest linked closure, active reuse and insurance-case preservation.

Live compatible deployment, provider cancellation/refund/credit reconciliation, shared atomic reservation authority and the remaining full goal are still pending. Prior hosted run 37743065013 passed source checks and build but failed the browser secure-checkout-enabled wait; that assertion has not been weakened.
