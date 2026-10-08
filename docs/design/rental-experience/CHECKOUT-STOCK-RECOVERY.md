# Checkout inventory holds and recovery

The website now checks the full order inside its hold-insertion mutation using the same component quantities, blocked dates and actual stock records as replacement validation. Missing, inactive and malformed physical inventory supplies no units. Listing availability reports complete kits rather than the last component's raw quantity and does not promise marketing-only inventory. Catalogue selection remains unchanged, including demand logging for marketing listings.

A repeated hold call preserves the original reservation rows and expiry. Partial, changed or duplicated legacy holds require reconciliation instead of inventing a repaired allocation. Pending payment retains occupancy beyond TTL until its payment outcome is reconciled.

When a newly created checkout cannot reserve stock, the action closes its unbound pending order and membership/credit reservation before attempting Stripe session creation. Existing/reused attempts enter the existing reconciliation branch. Cleanup refuses bound sessions or payment intents. Only a confirmed closure emits CHECKOUT_STOCK_REJECTED with freshAcceptanceRequired. The client then clears that originating attempt's consent and membership IDs and requires a fresh signature. Unknown outcomes retain original IDs; an older rejection cannot clear newer consent.

Validation:

- Actual hold, listing/cart availability and cleanup handler regressions cover kit capacities, concurrent competing orders, repeated/reordered holds, changed/partial holds, invalid stock/quantities/dates, blocked dates, marketing status, unresolved TTL and bound-payment protection. These run in the default test command.
- The actual checkout action test proves that stock rejection calls real pending-order cleanup, closes the order, returns the structured recovery instruction and never creates a Stripe session.
- Native Chrome executes the actual checkout component with controlled quote/action/account/cart transport. Confirmed rejection clears consent; a fresh retry changes both IDs; unknown and unreconciled errors preserve IDs; delayed rejection preserves newer consent; entered customer details survive. Desktop/mobile screenshots were inspected at /root/dbc-checkout-recovery-scope-review. The fixture makes no live payment or mail calls and is not an independent audit of its synthetic financial quote.

This fixes the website's local ledger. It does not establish a single atomic inventory claim across website and Hygglo/Rental Manager writers. Compatible backend publication, real source availability and distributed-claim acceptance remain required by the original goal.
