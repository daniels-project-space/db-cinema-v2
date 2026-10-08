# Messaging visual rebuild — 8 October 2026

The renter and admin inboxes now share a dedicated, scoped dark conversation design: charcoal surfaces, copper controls, serif identity headings, a booking summary, sender/time metadata above readable bubbles, date separators, and a bordered composer. The old management CSS that flattened every message and moved tools ahead of the chat has been removed.

Admin chat retains protected rental actions and drone review. Its operations column adds booking total, refundable-deposit amount and card-authorisation amount from the existing protected rental details query; these amounts do not assert that a payment or hold has already succeeded. Renter chat retains its own rental journey, kit-change requests, extension flow, kit details and human support. Admin controls are not passed to the renter view. On phones and tablets, the conversation precedes the tools. The 768–1023px layout explicitly handles the existing inbox visibility breakpoint.

The booking strip uses the actual selected booking's dates, listing count and catalogue image when present. It does not manufacture a kit photograph. Existing chat pagination, visibility-based read receipts, credit/review/payment cards, draft suggestions and async scope fencing remain connected.

## Visual evidence and limitations

`/root/dbc-chat-upgrade-review/pass-1-{admin,renter}-{desktop,mobile}.png` records the initial shared conversation review. Passes 2–6 record five complete inbox reviews with the actual RentalInbox/RenterChat, RentalConversation and rental controls at 1488×1058 and 390×844. All images were inspected. Refinements cover directory rows, copper tabs, 14px message text, identity size, actual financial summary, removing the duplicate page heading and tablet layout. Final mobile composer screenshots were inspected separately.

The reference is `admin-chat.png`, adapted to the requested dark theme and existing management navigation. This is not pixel-perfect acceptance of the entire approved reference: its full-width header differs from the shared sidebar shell; synthetic records lack real equipment/customer images, and the fixtures contain fewer conversations. Remaining management screens and production visual acceptance stay open. No placeholder controls were added for attachment or emoji features that are not wired.

## Validation

- Default test suite, TypeScript check and final Next production build passed.
- Actual protected chat handlers still pass ownership, expiry, unread/read-marker, duplicate-request and handoff tests.
- Native React scope tests pass late send/error response fencing, A/B/A reopen, next draft preservation, session rotation, concurrent suggestions and stale handoff errors.
- Actual complete inbox browser checks submit an admin and renter message through protected handlers, confirm sender and account/rental linkage, empty composer, owner-only control exclusion, handoff and renter request form. 800px/390px checks confirm no horizontal page overflow and tools follow the conversation.
- Browser/API fixtures use isolated synthetic tables. Outbound scheduler work is recorded but never executed; no customer messages, provider payments, production records or deployments were changed.
- Fresh built HTTP routes `/`, `/gear`, `/checkout`, `/account`, `/admin` returned 200. Public landing/gear/checkout HTML contains no management shell or admin manifest.
- Local code graph updated after the changes.
