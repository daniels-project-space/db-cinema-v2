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

## Current evidence

Existing rental chat is Gaffer-first with human handoff, but its state is a small text label. `submitNative` currently accepts expired sessions and any owned booking without checking returned/security settlement; it also drops the profile image. Catalogue images select a single preferred source without alternatives, and SmartImage reveals even failed images. Crew cards resolve only their stored `headshot` URL, rather than current account/uploaded image sources. These findings will be verified against actual rendered/provider data before selecting fixes.

## Acceptance checklist

- [ ] Images and source fallback, including actual rendered gear/people.
- [ ] Distinctive default Gaffer/team handoff and owner queue.
- [ ] Bell-controlled phone push and persistence.
- [ ] Contextual AI drafts and quick replies inserted into composer.
- [ ] Connected structured rental/document updates.
- [ ] Eligible in-chat native reviews and homepage carousel/profile pictures.
- [ ] One-year full-value consented credit policy and checkout/account flow.
- [ ] Verification reuse, expiry/recheck rules and server handover protection.
- [ ] Tests, provider acceptance and desktop/mobile visual revisions.
- [ ] Reviewable PR, deployment and exact live alias verification.

## Progress

Gear sources now retain real migrated/source/gallery alternatives; failed images try the next source, then show an explicit camera placeholder. Account cards, owner cards/inbox, storefront cards and detail images use the alternatives. Crew profile images resolve current uploaded account photos or their approved application photo instead of relying only on the URL saved during approval. Source changes reset failed headshot state.

Rental chat now visually separates emerald Gaffer, amber company, violet renter and dashed blue automatic updates, with persistent sender labels and icons. Company replies use the existing DB Cinema logo; renters use their own uploaded/Google avatar with initials fallback. The Gaffer/team header and handoff button have distinct states. Pickup address is withheld from Gaffer's context unless the rental is confirmed/on hire and collects at the depot. These changes are not published yet and require staging/browser acceptance.

Public browser diagnosis found the initial visible gear images loaded successfully and the Cinematographer roster images loaded at 80×80. Further coverage is needed for other roles, older rentals and source failures; this is not evidence that every reported image issue is resolved.

Owner AI suggestions now use actual rental facts and company hours/location rules, generate up to three draft cards, and insert into the composer without sending. Suggestions are invalidated when the latest message changes or the owner switches conversations. Quick replies are generated from recorded stage/time/verification facts; pending rentals only get an unpaid-checkout reply, never confirmation/location/document notifications.

Staging deployed on 1 October. TypeScript and the full existing regression suite pass, plus new real handler tests for pending depot privacy and pure template tests for dates/times/verification/source alternatives. Actual provider/browser acceptance generated three drafts, selected one without adding a message, and found no desktop/mobile document overflow. Screenshots were inspected; mobile draft cards were changed to a horizontal rail to keep the composer closer. The remaining checklist is still incomplete, and no follow-up runtime changes have been published.
