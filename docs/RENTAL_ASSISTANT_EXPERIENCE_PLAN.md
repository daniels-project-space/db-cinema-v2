# Rental assistant experience follow-up

## Required outcome

- Fix missing crew profile icons/photos and gear images from their actual data sources, with visible failure fallbacks.
- Gaffer remains the default responder; distinctive assistant/team states, customer human request, automatic escalation and persistent owner attention queue.
- Owner phone notifications with a bell control and durable preferences, separate from optional in-page audio.
- Company/rental/context-aware AI draft cards and contextual quick replies; selecting inserts into the composer for owner review.
- Persisted approval, collection/return date/time/location and document-request updates, connected to actual rental transitions.
- In-chat rating/text review only after full security release/refund, server-enforced eligibility, profile image and native homepage score/carousel integration.
- Explicit renter-approved Gaffer cancellation credit option at least three days before start: full remaining paid value, one-year expiry, hold release and no duplicate cash/credit settlement. Visible account balance next to avatar and automatic checkout redemption.
- Inspect existing verification terms/provider outcomes, define reuse expiry and recheck triggers, wire account verification reuse without allowing unverified rentals through handover.
- Meaningful handler/provider/browser tests, repeated desktop/mobile visual checks, reviewable PR and exact authorized production release. Financial launch guards remain unchanged.
- Additional 1 October instruction: substantially restructure rental cards across account history and all other account/admin panels, including how ordered/cart/requested items are represented. Use a visual item/quantity/date/status hierarchy, reduce default prose, and make order details progressively accessible. This requires layout and information-flow changes plus repeated rendered inspection.

## Current evidence

Existing rental chat is Gaffer-first with human handoff, but its state is a small text label. `submitNative` currently accepts expired sessions and any owned booking without checking returned/security settlement; it also drops the profile image. Catalogue images select a single preferred source without alternatives, and SmartImage reveals even failed images. Crew cards resolve only their stored `headshot` URL, rather than current account/uploaded image sources. These findings will be verified against actual rendered/provider data before selecting fixes.

## Acceptance checklist

- [x] Images and source fallback, including actual rendered gear/people.
- [x] Distinctive default Gaffer/team handoff and owner queue.
- [ ] Bell-controlled phone push and persistence.
- [x] Contextual AI drafts and quick replies inserted into composer.
- [x] Connected structured rental/document updates.
- [x] Eligible in-chat native reviews and homepage carousel/profile pictures.
- [x] One-year full-value consented credit policy and checkout/account flow.
- [x] Verification reuse, expiry/recheck rules and server handover protection.
- [x] Tests, provider acceptance and desktop/mobile visual revisions.
- [ ] Reviewable PR, deployment and exact live alias verification.

## Progress

Gear sources now retain real migrated/source/gallery alternatives; failed images try the next source, then show an explicit camera placeholder. Account cards, owner cards/inbox, storefront cards and detail images use the alternatives. Crew profile images resolve current uploaded account photos or their approved application photo instead of relying only on the URL saved during approval. Source changes reset failed headshot state.

Rental chat now visually separates emerald Gaffer, amber company, violet renter and dashed blue automatic updates, with persistent sender labels and icons. Company replies use the existing DB Cinema logo; renters use their own uploaded/Google avatar with initials fallback. The Gaffer/team header and handoff button have distinct states. Pickup address is withheld from Gaffer's context unless the rental is confirmed/on hire and collects at the depot. These changes are not published yet and require staging/browser acceptance.

Public browser diagnosis found the initial visible gear images loaded successfully and the Cinematographer roster images loaded at 80×80. Further coverage is needed for other roles, older rentals and source failures; this is not evidence that every reported image issue is resolved.

Owner AI suggestions now use actual rental facts and company hours/location rules, generate up to three draft cards, and insert into the composer without sending. Suggestions are invalidated when the latest message changes or the owner switches conversations. Quick replies are generated from recorded stage/time/verification facts; pending rentals only get an unpaid-checkout reply, never confirmation/location/document notifications.

Staging deployed on 1 October. TypeScript and the full existing regression suite pass, plus new real handler tests for pending depot privacy and pure template tests for dates/times/verification/source alternatives. Actual provider/browser acceptance generated three drafts, selected one without adding a message, and found no desktop/mobile document overflow. Screenshots were inspected; mobile draft cards were changed to a horizontal rail to keep the composer closer. The remaining checklist is still incomplete, and no follow-up runtime changes have been published.

## 1 October implementation and acceptance

- Shared visual kit summaries now group repeated listing/date entries, preserve quantities/charges and separate dates, and show each source photo once. Fuller image frames replace inset cutout thumbnails. History uses compact rows; open rentals and owner cards use a visual kit; account/owner conversations and the owner order workspace share the expandable full inventory. Enquiries expand to their full message and reply address; cart-demand items use actual catalogue images and distinguish interest from cart additions.
- Booking confirmation now checks the live paid/open stage and writes its message receipt in one mutation, so delayed cancelled/unpaid/returned jobs cannot announce confirmation/location and retries cannot duplicate it. Document transitions post stage-gated persistent updates. Human-review, resubmission and declined quick replies describe their actual states.
- Native reviews use a current provider-attested security-settlement fingerprint, ownership/session checks and unique booking reviews. Actual staging Stripe checks authorized one invitation after full multi-payment refunds and released holds. Native submissions update the main score and carousel and resolve the account's current uploaded/Google picture. Carousel interval is 12 seconds.
- Owner notifications have persistent attention records, enabled device subscriptions, unique events, claimed delivery jobs, retries, expiry suppression and acknowledgement races. Actual Chrome registration/subscription and durable bell passed. The real Google push endpoint accepted the test message (`sent` delivery receipt), but the headless browser did not display it; an actual owner phone receipt is not yet demonstrated. No live customer notification was used for acceptance.
- Gaffer can request a server-quoted full remaining-paid-value credit offer. Only explicit renter consent accepts it; cash/credit choices are mutually exclusive, holds release before finalization, retries reuse their receipt and credit is issued once for 365 days. Actual browser/Stripe sandbox acceptance converted £25, released a £10 hold, and created no cash refund. A subsequent rental automatically applied £20 credit, charged £5 on the test card, and left £5 credit. Financial launch guards were preserved; the staging self-service guard was enabled only during this bounded sandbox acceptance and restored to false.
- Automatic Didit reuse is capped at 90 days and documented ID expiry, never reset by provider reconciliation. Exact name/address and rental start must match; the original provider decision is read again before reuse. Manual/legacy approvals are not reusable. Source revocation, account detail changes, expiry and recorded owner risk review require a fresh check. Server handover rejects missing, expired or revoked verification. Legal version is now `2026-10-v4`; existing credit expiry records are not rewritten.
- TypeScript, the full handler regression suite and production build passed. Rendered owner/account cards were inspected at 1440 and 390 pixels, with no document overflow. Duplicate kit photos were removed after the user's visual correction.
- Deployment note: an initial `convex deploy` selected the project's default `zany-wolf-18` deployment rather than the intended development staging deployment. The public site uses `veracious-wombat-196`, so that operation did not update its backend. Staging was subsequently pushed explicitly using `convex dev --once` against `deafening-stoat-340`. The final public release must target `veracious-wombat-196` explicitly and verify the Vercel alias/commit.

Actual in-chat browser acceptance selected five stars, entered review text and published the review. The saved profile picture loaded in the real homepage carousel, and the native score/count increased. The source graph was updated after implementation. Phone subscription and provider transport are tested; actual phone notification display remains a device acceptance item.
