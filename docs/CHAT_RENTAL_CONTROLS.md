# Rental conversation controls — October 2026

- Renter account icon shows combined unread rental and support messages, including on 320px mobile. Opening and actually reading a thread clears its count. The desktop account menu links straight to Messages.
- Owner controls appear before the expandable kit at the top of the rental conversation: add items, remove items, change dates/reschedule, cancellation and eligible partial/full rental refunds. Existing payment links, provider settlement and operation locks are retained.
- Renter buttons request dates, kit changes or an active rental extension. Requests are authenticated, stage checked, deduplicated and rate limited. They create a persistent scoped message, hand the conversation to the owner and create the existing notification/push event. No request changes a rental automatically.
- Cancellation terms use the same London calendar-day policy as settlement. An unpaid checkout can be abandoned directly. Paid customer self-cancellation stays behind CUSTOMER_BOOKING_ACTIONS; when disabled, the button shows the policy and sends a team request. A request alone does not cancel or freeze refund eligibility.
- Item removal is for confirmed, unstarted direct rentals. It releases stock atomically, preserves captured charges/security and records the original billed line for receipts and final return statements. Use the existing refund control separately. The last item requires whole-rental cancellation.
- Changing duration requires explicit owner approval to keep the agreed charge (extra days complimentary). Availability is checked; no additional card charge is invented. Same-duration rescheduling preserves the existing price.
- Item removal preserves the agreed cancellation start. An agreed reschedule sets the new start. Pending refunds prevent rescheduling/removal; concurrent cancellation, return and addition locks are enforced.

## Evidence

`npm test`, `npx tsc --noEmit`, and the Next production build pass. New handler regressions cover ownership/session expiry, request deduplication, unread/read clearing, reservation release, invoice conservation, cancellation date and financial-operation locks.

Actual staging browser/API acceptance passed: account badge at 1440/390/320px, renter-only requests, displayed cancellation terms, owner-only controls, request handoff and owner item removal. The isolated Stripe test rental was fully refunded/cancelled afterward. Screenshots inspected; no horizontal page overflow. Existing checkout, paid renter actions and automatic late collection gates stay unchanged.
