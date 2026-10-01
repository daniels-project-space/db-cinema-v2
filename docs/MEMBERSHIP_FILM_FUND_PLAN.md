# Membership and Film Fund release acceptance

Full objective: user goal attachment f94374b4-9888-4912-a0fa-56230633bf8a. This checklist does not narrow it.

Agreed prices remain £19 Starter (legacy key plus), £49 Pro, £99 Studio. Monthly credit is the paid membership fee ×1.30, individually expiring after one year and stackable. £20 was an example, not a new subscription price. Intro choice: seven-day free trial (no membership deposit exemption until paid) OR one-time £20 store-credit introduction. Film Fund entry £15, once per project, included with Pro/Studio, no multiple tickets.

## Required implementation and evidence

- [x] Single shared tier contract; old rental percent/coupon/free-accessory entitlements removed from calculation and marketing.
- [x] Paid member refundable upfront security charge £0; full hold retained; free-trial exclusion; faithful checkout and membership labels.
- [x] Authenticated repeat renters with safely completed same exact kit get charge exemption, full hold retained; abuse/damage/late settlement guards.
- [x] +30% monthly credits from actual paid subscription invoices only; idempotency, expiry, stacking, refund/chargeback handling and account balance.
- [x] One-time introductory choice and eligibility; seven-day recurring trial with renewal/cancellation disclosure; £20 credit alternative; no credit before fee collection.
- [x] Pro/Studio Fri–Sun 2-for-1/3-for-2, maximum £100 aggregate saving per rental, no stacking other discounts on weekend orders.
- [x] Delivery Starter −10%, Pro −30%, Studio one eligible London delivery/month; atomic reservation/consumption, cancellation and renewal coverage.
- [x] Accurate basket-based recommendations, paid/trial/add-on quote breakdown; membership added in same checkout/payment, no unintended second subscription.
- [x] Elevated subscriber checkout/savings field, grey glowing nonmember field, concise benefits overlay, membership page, badge/avatar treatments.
- [x] Account automatic checkout creation with secure ownership/sign-in, existing-account protection, account-benefit overlay and marketing.
- [x] Account settings cancellation/management accessible and provider-backed; legal version and accurate membership/rental/credit terms.
- [x] Owner pickup/return controls connected to verification/hold guards and existing financial settlement; stage-aware renter chat progress with authored SVG icons and reduced-motion animation.
- [x] Film Fund landing, homepage placement directly after camera disassembly, twice-yearly schedule/deadlines/announcements, seven-day first and two-day second gear prizes, producer credit terms.
- [x] Complete application model and submission validation: project tags, crew profiles/info, 250-word bio/letter, script/moodboard/documents, one-minute pitch video; authorized uploads and owner review.
- [x] £15 once-per-project ticket/payment or Pro/Studio included entry; paid/failed/refunded/duplicate states and owner controls.
- [x] Fund launch is Coming soon/greyed, closed applications/ticket purchases, real consented notify signup/count in admin; access remains truthful.
- [x] Recovery emails unpaused, consent/delivery/availability/payment-state protections retained and resume links useful in current deployment.
- [x] Meaningful handler/payment sandbox tests, full suite/typecheck/build, actual desktop/mobile rendered UI, provider deployment and exact live alias.
- [x] Final requirement-by-requirement audit before goal complete.

No production partial marketing/financial activation before corresponding wiring is ready. Existing public Stripe test mode is authoritative; do not silently switch providers or keys.

## Staging evidence · 1 October 2026, 15:40 UTC

- Convex functions verified on `deafening-stoat-340`, the isolated rental checkout development deployment. Public backend/alias unchanged.
- Real Stripe sandbox hosted checkout collected £72 in GBP in one subscription checkout: £53 rental + £19 Starter fee; upfront security charge £0, separate £50 manual card hold held. Adaptive currency conversion disabled to prevent an unexpected FX uplift.
- Account received exactly £44.70 (£24.70 monthly grant + £20 one-time bonus), active Starter entitlement and paid-through date. Repeating finalize left credit unchanged.
- Owner cancellation refunded £53 only. Separate membership credit note refunded £19; reconciliation revoked the £44.70 credit. Test subscription cancelled, £50 hold cancelled without capture. Original staging checkout flag restored.
- Fresh email sign-in links for automatic checkout accounts: hashed secrets, 15-minute expiry, single use, send limits, generic unknown-email response and exact rental invitation routing. Ownership/expiry/replay/rate-limit/route tests passed.
- Refund regressions cover membership vs rental refunds on a combined payment, available-cash caps, pending/failed refunds, repeated revocations, checkout credit reservations and future-credit offsets.
- Film Fund owner review opens submitted letters/crew/private file links and saves shortlist/winner/runner-up/rejection plus private notes. Atomic one-winner/one-runner-up guards and forged-access tests passed.
- £15 entry wiring added: authenticated owner, verified files/current terms/open-round gate, atomic checkout reservation, persisted provider params/idempotency, paid/expired/refunded states, linked round, GBP only and provider receipt. Duplicate purchases blocked even after refund. Fund remains Coming soon; no ticket payment opened.
- Full npm test suite passed; staging Convex typecheck/deploy succeeded. Production build passed; repeat the final build after remaining edits.
- Chromium desktop 1440px and mobile 390px membership/Film Fund screenshots inspected; no horizontal overflow. Mobile account exposes email-link sign-in. Film Fund heading/anchor semantics corrected.

Still required before release/completion: combined checkout trial/credit-only edge cases; actual fund upload/video/payment acceptance where appropriate; notification opt-out; webhook event configuration; effective-expiry/dispute audit; pending compound membership rental edit safety; checkout/owner/chat visuals; recovery activation and public deployment/alias verification. Checklist remains open until the full original task is audited.

Additional live staging acceptance: actual Convex file upload/attachment succeeded for script, moodboard, supporting document and an ffmpeg-generated 60-second MP4. Node verification read and validated the stored video. Coming-soon entry payment was denied by the actual API; private draft excluded from owner submitted-application view. QA fixtures are isolated in staging. Public rate-limit API now rejects account/fund server-owned counter keys so clients cannot reset the new send/upload limits.

## Additional staging work · 1 October 2026, 16:10 UTC

- Rental Stripe sandbox webhook now subscribes to membership lifecycle, paid/failed invoices, refunds and credit notes in addition to checkout events. Only the rental staging endpoint was changed; other projects' endpoints were untouched. Public endpoint remains a release task.
- Clock-based membership entitlement now protects rental pricing, delivery, Film Fund entry and account presentation against delayed lifecycle events. Explicit complimentary grants remain supported.
- Repeat rental fidelity corrected: completed and financially settled same exact kit/quantities qualify even if documented late/damage fees were paid. Provider proof accepts settled partial security refunds and terminal captured damage holds, rejects unsettled prior authorizations/refunds. Review-email eligibility still excludes retained deposits independently.
- Film Fund confirmation emails now include signed unsubscribe links using a dedicated staging signing secret. Consent/rate-limited opt-in schedules confirmation once per active signup; authenticated token verification deactivates only its bound email. A public deployment needs its own `FILM_FUND_EMAIL_SECRET` provisioned.
- Real Stripe trial checkout collected £78 (£53 rental + £25 refundable security), monthly fee £0 initially and £19/month after seven days; separate £50 hold held, trial membership active, no paid-through and £0 credit. Finalize retry did not issue credit. Cleanup refunded £78, cancelled trial subscription and released the hold without capture; staging checkout flag restored.
- New password signup no longer issues sessions before email ownership confirmation. Dedicated confirmation links activate only their matching pending credential. Rental/email recovery and verified Google login remove an unverified pre-registered password and evict pre-verification sessions. Legacy existing password/Google accounts are retained. Verified email/Google users without a password can set one in settings; expired sessions cannot change passwords.
- Ownership handler tests cover pre-verification denial, password activation after explicit signup confirmation, session eviction and pre-registration/recovery credential takeover prevention. Actual staging API ownership tests are recorded separately below once finished.

Remaining required work stays as previously listed: pending compound membership rental edit support, credit-only/setup-mode checkout acceptance, final checkout/chat/owner visuals, public configuration/recovery activation/deployment/alias and full requirement audit. Do not mark complete from this staging progress.

Actual staging ownership API acceptance completed: password signup returned no authenticated token; pre-confirmation password login denied; manually supplied isolated QA email-proof token activated the matching password. Separate email recovery cleared an unverified pre-registered password; its old password denied, and the verified email owner successfully set and signed in with a new password. These fixtures verify the actual auth API/state transitions, not delivery to `.invalid` email addresses. Full npm test suite passed after all ownership changes.

Production Next build passed after auth/notification changes (55 routes, including Film Fund unsubscribe). Email-link sign-in now claims the authenticated renter's earlier Gaffer follow-up history once the verified account profile resolves, retaining the pre-signup conversation continuity.

## Additional acceptance · 1 October 2026, 17:10 UTC

- Owner editing an unpaid combined membership order now expires its original checkout, preserves one recurring membership/trial, reprices the rental and renews inventory holds. Actual Stripe sandbox replacement collected £127: £108 additional rental plus £19 membership, with the original £53 rental paid by existing credit. Cancellation refunded only £108 and restored £53 credit; membership remained active until separate fixture cleanup.
- Pure-credit rental completed a real Stripe Setup checkout in GBP, redeemed £53 credit once and held £50 without a cash charge. Retry did not spend credit again. Owner cancellation restored £53 and released the authorization without capture. Fixed missing Setup currency, trusted provider-create rejection cleanup, and cancellation that previously skipped redeemed credit when no PaymentIntent existed. Handler regressions cover unbound rejection vs bound provider state and exactly one credit restoration.
- Sandbox memberships/holds/rentals cleaned up and staging financial gate restored. Membership fee refunded separately via credit note; monthly credit reconciliation uses the documented future-credit offset for already redeemed grants.
- Production-rendered staging checkout inspected at 1440/390px with actual server quotes: selected £19 Starter fee, £24.70 monthly credit, £0 upfront security, £50 separate hold and existing credit correctly shown. Owner/renter scoped chats rendered with no page overflow. Membership benefits overlay inspected on mobile. Mobile protection heading corrected to wrap; Starter no longer displays a weekend benefit line.
- Retired member-coupon creation/control removed; ordinary public promotions remain, with weekend nonstacking enforced in pricing.
- Public Convex functions uploaded explicitly to veracious-wombat-196; matching public sandbox webhook created because none existed, signing secret stored server-side, lifecycle/invoice/refund/credit-note events enabled. Dedicated public Film Fund email signing secret provisioned. Recovery email flag enabled as requested, retaining consent/stock/payment checks. Frontend publication and exact alias verification remain pending.
- Local diagnostic inadvertently exposed voice credentials. No tracked source contains either value. ElevenLabs replacement requested directly into Hub vault; dashboard rotation remains an explicit outstanding security item and is not claimed complete.

## Final Fund acceptance · 1 October 2026, 18:12 UTC

- Added owner opening/closing controls, current-window/date guards and explicit notification confirmation. UTC date inputs are interpreted as UTC. Public rounds remain Coming soon.
- Consented opening email queue persists one announcement per signup/round, rechecks consent/window, uses leases, bounded retries and signed opt-out links. Transport and sender credentials/domain checked; no real opening emails sent during testing.
- Real Stripe sandbox £15 GBP hosted payment automatically submitted the validated project with four actual private files. Finalize retry was idempotent; another purchase was blocked without a second submission click.
- Fully settled refund receipts invalidate the paid entry and selection; partial, pending and foreign-deployment receipts are ignored. Actual sandbox refund reconciled before browser return; test funds and round restored.
- Last-minute checkout starts retain Stripe's minimum lifetime but are separately expired at the real deadline; late/invalid payment receipts refund instead of entering. A refunded failed draft can be corrected without buying extra valid entries; submitted projects remain locked.
- Full suite, both Convex checks and production build passed; graph updated. Prior published membership/UI/financial sandbox evidence is recorded in the release memory.

Feature checklist is audited. Financial launch remains disabled/test mode as previously configured. The separately reported ElevenLabs dashboard key replacement remains pending and is not claimed resolved.
