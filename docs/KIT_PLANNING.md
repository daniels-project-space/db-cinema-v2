# Repeat booking, shoot lists, alerts and checkout recovery

## Customer entry points

- Account rental cards → **Rent this kit again** → `/plan?booking=…`. Ownership is checked server-side. All current order lines and quantities are copied, removed lines excluded. Choose new dates for the whole kit.
- Basket → **Save shoot list**. Account → **Shoot lists** lists private kits, editing, booking, share creation/revocation and deletion. The planner can add/remove gear, edit quantities/title/dates and save.
- `/kit/<48-character-random-key>` is a publicly readable live quote, with no account/email/credit details. Editing that page creates a local variation or a separately saved copy, never edits the owner's list. Owners can revoke links; creating a new share link rotates the old one. No search indexing.
- Booked-out listing → **Notify me**. Dates are included in the email's listing link and preselected on arrival. Alerts can be cancelled in Shoot lists. Logged-in alert email comes from the actual account, not a spoofable input.
- Basket/checkout → separate unchecked **Email me once** consent; signed-in accounts only. Existing marketing preference does not opt customers in. Reminder destination comes from account data. Unchecking anywhere or clearing an existing basket stops its recovery record. An empty browser on a different device does not erase an existing recovery record.

## Pricing and stock

Quotes reprice the live catalog, quiet discounts and minimum duration, and check aggregate physical-unit stock across bundles/quantities. Preview numbers are rental estimates. Checkout still authoritatively calculates member/promo offers, available account credit, delivery, the 50% refundable security charge and separate full hold. Quote lines expand into uniquely keyed single-unit cart entries because payment checkout currently requires `qty=1` per line. Existing baskets require an explicit replacement click.

Fixed underlying stock issues: expired soft holds are ignored; missing capacity does not invent one owned unit; reservations without a website booking ID (external rentals) are included; capacity is evaluated inside proposed windows rather than unrelated historical overbookings. Empty component mappings fail closed.

## Email delivery and suppression

Availability cron runs every 15 minutes in paginated batches; claims and leases prevent overlapping cron sends. A failed provider call leaves the alert retryable. A sent receipt is stored only after transport acceptance. Today's date represents the entire London rental day rather than expiring at UTC midnight.

Recovery cron runs every 15 minutes. A waiting basket is due after two hours, expires after seven days or its rental start, and requires available stock and `RENTAL_CHECKOUT_ENABLED=true`. Provider failure retries after an hour, up to three attempts; at most one accepted recovery email per account per day. No actual customer test emails are sent for release testing.

`bookings.createPending` transactionally links matching recovery snapshots. Pending/processing payments defer reminders until the existing Stripe reconciler has confirmed payment or attested terminal unpaid expiry. Paid confirmation and explicit cancellation stop reminders transactionally. Stripe-attested unpaid expiry can recover the basket with fresh stock/prices. Comparison aggregates duplicate lines and quantities, so individual checkout lines still match saved quantity lines. Completed/explicitly cancelled attempts cannot be re-armed by another browser with the same basket. Recovery links require the owning account, refuse unresolved/paid/cancelled payment attempts, and refresh stock/prices; no checkout session/payment authorization is reused. Late/cancelled/finished bookings do not receive these reminders.

Consent is rechecked when claiming delivery. Opt-out after transport has already started cannot recall email; SMTP/provider acceptance and database commit are separate operations, so this is not a claim of externally guaranteed exactly-once delivery. Leases, receipts and no blind marking of failures reduce duplicate risk.

## Verification

`scripts/test-kit-planning.cjs` exercises real handlers: complete quantities and fresh prices; shared/external stock and expired holds; authentication; public quote privacy/revocation; date bounds; alert cancellation and failed delivery retries; recovery gate/leases/opt-out/transactional checkout suppression. The full rental regression suite and Next production build are also required.

Actual staging API and desktop/mobile browser acceptance covers save/share, planner → current-priced cart, consent opt-out, account lists/alert cancellation and guest shared quote. Public publishing retains existing financial launch guards; recovery delivery therefore remains paused while checkout is disabled.
