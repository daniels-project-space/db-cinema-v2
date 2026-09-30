# Rental workspace delivery

## Required outcome

- Persistent renter/company conversation for every pending and later rental; histories remain accessible after cancellation/return.
- Gaffer is the default responder, knows the exact rental, current stage, included contents and customer-visible settlement facts; per-rental human handoff.
- Owner inbox sorted and categorized by rental stage, quick entry from rental cards, persistent unread badges and opt-in audible pings.
- Owner-only tools inside the conversation: add actual catalog items to the order, reschedule with stock/price checks, cancel, partial/full refunds with Stripe reconciliation and audit trail.
- Cancellation follows the existing three London calendar-day refund window: zero rental cash refund afterwards, rental value becomes 90-day account credit; refundable security remains separate. Credits must redeem once against a real later checkout.
- Major admin redesign across every section; clearer rental cards with images, shorter names, progressive detail disclosure and fewer default words.
- Matching renter account redesign, clearer stage flow, images and concise cards, persistent rental chats and readable credit balance.
- Multiple visual revision passes on desktop/mobile for both account and admin, actual browser/API acceptance and meaningful payment/security tests.
- Preserve verified source contents, deposit/identity gates, invoice/receipt correctness, review suppression and project isolation. Production messaging and financial execution stay gated; financial acceptance uses sandbox.

## Initial findings

Account-wide chat blends multiple rentals. Focus falls back to one of only ten recent bookings. Bot replies lose bookingId. Chat session lookup does not enforce expiry, and send accepts a bookingId without proving ownership. Owner cancellation currently always chooses full refund. Existing admin cards expose long names and all payment/verification detail at once. Owner inbox currently contains contact-form enquiries instead of rental conversations.

## Implementation and acceptance

Implemented on `feat/rental-workspace`. Staging acceptance passed; live release remains pending.

- [x] Persistent rental and general threads, ownership/session checks, cursor history and per-message read visibility.
- [x] Exact rental/stage Gaffer facts, verified seller contents, duplicate/stale reply protection and per-thread owner handoff.
- [x] Stage-based owner inbox and cards, separate general support, unread counters/migration and opt-in audio pings.
- [x] Owner item proposals, catalogue pricing and whole-order stock checks, hosted payment, security uplift/replacement hold, payment ledger and withdrawal/recovery.
- [x] Owner rescheduling, partial/full rental cash refunds inside the agreed window, cancellation and 90-day account credits afterwards. Transactional locks prevent conflicting settlement operations.
- [x] Account credit reserves/redeems once; cancellation restores redeemed credit without refunding it as cash.
- [x] Owner detail workspace with order, verification and return panels; cleaner account, rental cards, navigation, settings and progressive details across the remaining sections.
- [x] Reviewed desktop/mobile screenshots in repeated passes. All account/admin navigation sections rendered, no document overflow. Owner conversation/detail panels and return form inspected.
- [x] Relevant handler tests and actual Stripe sandbox/staging acceptance.
- [x] Updated production-build PDF endpoint: prior rental refunds deducted, net card paid £0 for the fully refunded two-payment fixture, unauthorized account denied and non-VAT wording verified. Final build and all-section desktop/mobile pass 4 pass. Pass 5 verifies bounded chat scrolling, latest messages and reachable composer after the final visual fix.
- [ ] Reviewable PR and approved live release, followed by exact production alias/provider acceptance.

## Evidence — 30 September 2026

`npm test` covers chat isolation, expired/foreign sessions, forged legacy rows, unread/read races, migration retries, owner financial authorization, quantity/component availability, saved operation identity, refund/cancellation retries and provider event ordering. Existing contents, Gaffer, identity, cancellation/DST, late-fee and review-email regressions remain passing.

Actual isolated staging and Stripe test mode accepted:

- Persistent pending-rental chat, invalid owner/foreign renter rejection, general/rental isolation and cursor history.
- SDK 22.6.2 Checkout parameters and a manual card hold with provider capture deadline and release.
- Partial rental refund followed by cancellation: exactly the remaining captured cash returned.
- Late cancellation: rental cash refund denied; refundable security returned and 90-day account credit issued.
- Credit reserved once, competing checkout rejected, redeemed once, then restored on cancellation; only captured cash refunded.
- Owner item addition through real hosted Checkout: extra rental/security charge, replacement hold, old hold release, one attachment across duplicate finalization, separate captured-payment ledger.
- Full rental refund across both payments, security preserved, reschedule and return, correct security refund split and no duplicate refund on return retry.
- Actual Gaffer provider recognised the exact confirmed rental and correctly counted four FX3 cameras across its two kits.
- Browser owner unread badge and WebAudio ping; hidden messages stayed unread, viewing the actual latest message cleared only that conversation.

The first provider test found the staging Gaffer key absent. It was configured securely from this project's existing provider configuration and the actual reply retested successfully. Staging RMv2 pushes and Telegram are unconfigured, preventing test fixtures reaching live operations. Checkout guards remain disabled on both public and staging deployments outside narrowly bounded sandbox fixture setup.

Return statements now subtract confirmed prior rental refunds from net card paid. Review eligibility also waits for successful provider refunds of security charged on withdrawn/unapplied proposals. These are covered by final regression/PDF acceptance before release.

All financial acceptance uses Stripe sandbox and `.invalid` test accounts. No real customer messages or live card charges were sent. Search filters loaded pages; the UI names this limit and cursor buttons expose all older rental/conversation history.

Graph outputs are excluded from Git and Vercel uploads. The preexisting `.serena/project.yml` change belongs to the workspace and is excluded from the feature commit.
