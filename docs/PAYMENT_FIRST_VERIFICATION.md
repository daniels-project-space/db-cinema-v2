# Payment-first rental verification

The checkout collects the rental fee and refundable security payment first. Its server-attested payment confirmation then authorises any separate card hold. Didit can open only after those steps succeed (including a successful zero-charge/setup checkout when account credit covers the rental and security policy requires no upfront payment).

`/checkout/success` promotes the verification panel above the receipt. `/account/verification/[bookingId]` is the dedicated live screen; each open account booking links to it and displays a progress bar. ID, selfie/face-match and address states come from signed Didit feature decisions and the existing reconciliation worker. Unknown results are shown as waiting. Upload/replacement links target the booking's current Didit workflow; approved/reused checks do not request new uploads. A failed automatic open retries only after an explicit click. Eligible previous checks are revalidated before a new upload workflow opens; reuse and fresh verification both wait for the required hold. Concurrent starts cannot overwrite an already-bound upload session.

Read access requires the linked account's valid session or that booking's exact paid Checkout session bearer. Permanent account ownership is respected. Feature results, an update time and equipment aggregates are returned; raw documents, DOB, document numbers, provider credentials and identity keys are never exposed by the progress query. Didit's callback returns to this exact screen. First-party camera permission enables browser delegation; third-party camera/microphone access is granted only to the validated `https://verify.didit.me` iframe; Gaffer's first-party microphone permission is preserved.

## £15,000 limit

The limit is equipment replacement value, not rental price, charged deposits or card holds. Rental days are inclusive; adjacent days are separate, and a same-day handover/return counts as overlapping. Quantities are included. Accepted per-listing replacement values are saved at checkout/addition; catalogue decreases cannot erase them. Current higher catalogue values apply conservatively. Historical unsnapshotted rentals use current catalogue values; unknown values require a team review rather than a zero assumption.

Indexed, bounded queries count pending checkouts, confirmed rentals, collected kit and reserved additions/extensions. Unresolved payments retain their allocation until the existing payment lifecycle closes them. Collected overdue kit extends through the current London day until its actual return is recorded. The limit is checked again at handover, so an expected return cannot silently clear equipment still held by the renter. Closing/returning an allocation releases it.

Checks run transactionally before checkout reservation, addition proposals/applications, extension quote/approval/application, both reschedule paths and handover. A provider-attested normalized full name and DOB are HMACed with the existing invoice secret under a separate `dbc-person-v1` domain; the key joins matching people across account emails. Pending allocations on the attested account are linked too. A changed identity or absent provider identity fields requires review; no person key means handover is blocked. Manual/reused approval still respects the limit.

This matching is conservative biographical matching, not a claim of biometric deduplication: identical names/DOB may need owner review, and legal name changes require identity reconciliation. Preserve the invoice secret or migrate person keys before rotating it. Previously approved/manual cases lacking an identity key need provider reconciliation before release; the pre-existing hard release gate remains unchanged.

## Stripe bank account

This is a direct merchant Stripe Checkout integration. Add the company payout bank account in the same live Stripe business account's payout settings; Stripe delivers that account's available balance to its configured destination. No bank details are stored by this website and no Connect account/transfer flow is needed for DB Cinema's own rental income.

The public backend was read back as Stripe **test mode** during this change. The Stripe app connection requires reauthentication, so an existing live payout bank was not independently verified. A live launch needs the correctly matched live server/publishable keys, live payment-method configuration, required signed webhook endpoint and existing rental launch/release readiness checks. This change does not enable real charges, automatic collection, payouts or handover.

## Validation

`npm test`, TypeScript, a production build and actual staging desktop/mobile browser checks cover the payment/hold boundary, live required/processing/resubmission/review/approval states, exact account links and no overflow. The focused handler test covers exact-cap/over-cap cases, inclusive overlap, quantities, pending/proposal reservations, overdue kit, returns, immutable values, signed cross-account identity joining, scoped reads, transaction-level checkout denial, session-binding races and bounded fail-closed reads. Browser fixtures use isolated stage data and do not attest a paid production checkout or completed real identity verification.
