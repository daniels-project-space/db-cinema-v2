# Membership offers in rental checkout — 2 October 2026

## Agreed contract

- Starter (legacy key plus): £19/month, £20.90 credit. Recommended from £100 of eligible charges, with a one-time £5 joining discount.
- Pro: £49/month, £58.80 credit. Recommended from £200, with a one-time £10 rental discount when starting paid membership.
- Studio: £99/month, £128.70 credit. Recommended from £300, sharing the one-time £10 signup discount with Pro.
- Thresholds use rental plus delivery charges after existing discounts, before VAT and credit payments. Refundable security, holds and membership fees never count. The business remains not VAT registered; no invented VAT deduction or collection.
- First paid month credit pays this order's rental charge after existing account credit. It cannot pay delivery, security or the subscription fee. Unused credit is issued after successful payment; subsequent monthly credit stacks and lasts one year.
- A higher eligible tier is recommended when it genuinely saves money. If that tier would not save, the next eligible saving tier can be recommended. No unsolicited offer at or below zero net saving. The net comparison includes the first subscription fee, ignores refundable security, and counts no unused future credit.
- The free week remains available but earns no first-month credit or £10 discount. Membership added at checkout retains the first rental’s verification, upfront security payment and full hold. Only credit and the joining offer apply now; other perks start after the booking is confirmed for future bookings. A separately purchased paid membership activates perks after payment. Weekend rules and £100 cap stay intact. Credit is tender, not a second promotional discount. The £5/£10 joining discount cannot stack with a member weekend deal.
- Paid joining offer across all plans is recorded per account when the initial paid invoice settles. Cancellation, refund and rejoining never reset it. Old accepted £20 welcome-credit checkouts remain legacy; no new £20 bonus is offered.

Examples without delivery, other discounts or existing credit: £100 Starter → £93.10 combined charge/save £6.90; £200 Pro → £180.20/save £19.80; £300 Studio → £260.30/save £39.70. Security/hold is separate.

## Wiring and safety

Authoritative rentalPrice computes fees, discounts and tender. priceQuote compares genuine payable amounts and chooses an eligible paid/trial offer. createPending recomputes credit and promo eligibility atomically, reserves the first invoice allocation on the membership checkout and excludes it from existing-credit reservations. Stripe reduces only one-time rental lines, keeping the recurring price intact. The first paid invoice marks its allocation spent once; renewal invoices grant the full monthly amount. Booking confirmation requires the settled receipt and spends only pre-existing credit through FIFO.

Cancellation restores the immediate credit linked to its originating membership grant. Membership refunds revoke linked restored balances too. If membership was reversed first, rental cancellation clears the future-credit offset rather than manufacturing credit. A later debt cannot steal an allocation promised to an open checkout. Late payment of an already-closed rental leaves its purchased monthly credit unspent.

Receipt email uses an internal full receipt query; public status queries are unchanged. Customer-authorised PDF includes first-month credit used within total store credit. Stripe separately itemises the subscription fee/renewal. Membership terms version 2026-10-membership-v6 requires fresh acceptance.

## Acceptance evidence

- Full tests, Convex typecheck/deploy and production build passed. Regression exercises exact £99/100/199/200/299/300 thresholds despite a much larger deposit; net fee maths, unpaid/retry/double-spend guards, capped/unused credit, renewal, reversal/cancellation ordering and receipt email caller.
- Real staging catalogue/browser: large weekday Studio offer shows £39.70 net saving; desktop/mobile cart, drawer and checkout one-click carry, precise API totals, reload consent reset, unclipped modal, checkout first viewport CTA, small/no-saving offer suppression and homepage Fund placement passed. Screenshots inspected.
- Actual Stripe sandbox hosted subscription checkout: £300 rental, £10 discount, £58.80 first-month credit, £49 recurring fee; £280.20 provider charge with separate £200 hold. Successful payment confirmed rental, spent credit once, retained no unspent balance; repeated finalize retained the same grant. Actual customer-authorised receipt PDF checked.
- Sandbox cleanup refunded £231.20 rental and £49 membership, cancelled subscription, released the uncaptured hold, reconciled credit to zero, and proved the one-time £10 offer is unavailable on rejoin. Staging checkout gate restored. No live transaction or launch activation.

## First-booking perks and Encore (follow-up)

- Membership checkout binding blocks perks until its initial rental is confirmed, including trial lifecycle events. This first rental gets no security waiver, weekend or delivery benefit. Paid invoice credit is still spent once.
- Encore unlocks after three returned website rentals with distinct payment checkouts and distinct rental date windows. Multiple items, shared checkouts, same dates, cancellation and unpaid bookings cannot inflate progress. Historical owned bookings count. Return writes unlock atomically; authenticated queries also derive historical eligibility.
- Encore automatically discounts rental charges by 10% after ordinary rental reductions; delivery, security, holds and membership fees remain untouched. Neither existing subscription benefits nor a newly added subscription can stack with Encore. Pending booking creation revalidates entitlement and amount.
- A custom drawn lens/film crest, staged reveal, light rays and particle burst celebrate the unlock. The account retains progress and benefit, and authenticated acknowledgement persists across devices. Reduced motion, focus management, scroll locking and mobile bounds are verified using a local visual fixture of the actual component (not a customer earning claim). The fixture is removed before deployment.
- Updated real Stripe test: £300 rental minus £10 joining discount and £58.80 credit, plus £100 security and £49 subscription = £380.20. Security line remains £100; full £200 hold remains separate. Paid confirmation/retry verified.

- Follow-up sandbox cleanup refunded £331.20 rental/security and £49 membership, cancelled the subscription, released the £200 hold and restored/revoked credit to zero. Original staging launch gate restored.
