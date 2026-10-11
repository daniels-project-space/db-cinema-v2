# Messaging visual rebuild — 8 October 2026

The renter and admin inboxes now share a dedicated, scoped dark conversation design: charcoal surfaces, copper controls, serif identity headings, a booking summary, sender/time metadata above readable bubbles, date separators, and a bordered composer. The old management CSS that flattened every message and moved tools ahead of the chat has been removed.

Admin chat retains protected rental actions and drone review. Its operations column adds booking total, refundable-deposit amount and card-authorisation amount from the existing protected rental details query; these amounts do not assert that a payment or hold has already succeeded. Renter chat retains its own rental journey, kit-change requests, extension flow, kit details and human support. Admin controls are not passed to the renter view. On phones and tablets, the conversation precedes the tools. The 768–1023px layout explicitly handles the existing inbox visibility breakpoint.

The booking strip uses the actual selected booking's dates, listing count and catalogue image when present. It does not manufacture a kit photograph. Existing chat pagination, visibility-based read receipts, credit/review/payment cards, draft suggestions and async scope fencing remain connected.

## Visual evidence and limitations

`/root/dbc-chat-upgrade-review/pass-1-{admin,renter}-{desktop,mobile}.png` records the initial shared conversation review. Passes 2–6 record five complete inbox reviews with the actual RentalInbox/RenterChat, RentalConversation and rental controls at 1488×1058 and 390×844. All images were inspected. Refinements cover directory rows, copper tabs, 14px message text, identity size, actual financial summary, removing the duplicate page heading and tablet layout. Final mobile composer screenshots were inspected separately.

The reference is `admin-chat.png`, adapted to the requested dark theme and existing management navigation. This is not pixel-perfect acceptance of the entire approved reference: its full-width header differs from the shared sidebar shell; synthetic records lack real equipment/customer images, and the fixtures contain fewer conversations. Remaining management screens and production visual acceptance stay open. No placeholder controls were added for attachment or emoji features that are not wired.

## Contact and message-detail comparison, 10 October

The actual admin conversation header now includes the permanent account's current email and phone from the existing authenticated message query. Renter responses omit both fields; missing associated accounts never fall back to historical booking email. Message rows use the reference's larger circular avatar and metadata proportions, with smaller avatars and stacked contacts on phones. The booking panel places its working admin actions above a titled payment breakdown, preserving distinct deposit and recorded card-authorisation states.

Five local capture/review passes at 1440 and 390 are retained in `/root/CODEX_ARTIFACTS/db-cinema/chat-details-reference-2026-10-10`. They inspect multiline messages, contact wrapping, the actual composer sending once into the correct account/rental, extension shortcut expansion/focus and missing-account contact suppression, with the actual management shell/components and isolated native handlers. No provider/customer/email/payment writes occurred. This is an additional conversation refinement cycle, not proof of five complete passes for every reference or exact full-screen parity.

## Missing-account conversation recovery

The authorised message response governs whether conversation controls are available. Loading, missing linked accounts and invalid sessions disable the composer, handoff and Gaffer suggestions; resolved missing accounts show an explicit review/sign-in state. Cached messages and suggestion cards are hidden while the conversation is unavailable. The current draft remains on the screen for restoration of the same account and rental; changing conversation scope still clears it through the existing scope reset. Admin financial operations retain their separate authenticated provider/ledger checks.

Actual component/handler acceptance at 1440 and 390 is saved under `/root/CODEX_ARTIFACTS/db-cinema/chat-account-recovery-2026-10-10`. Deleting the isolated linked account hides contacts/history and disables controls; attempts to click or programmatically submit create no messaging/handoff/drafting calls. Restoring it preserves the draft and sends it exactly once to that account/rental. Desktop/mobile unavailable and restored screenshots were inspected; no overflow/runtime errors or provider writes occurred. Genuine customer production acceptance and complete reference fidelity remain open.

## Validation

- Default test suite, TypeScript check and final Next production build passed.
- Actual protected chat handlers still pass ownership, expiry, unread/read-marker, duplicate-request and handoff tests.
- Native React scope tests pass late send/error response fencing, A/B/A reopen, next draft preservation, session rotation, concurrent suggestions and stale handoff errors.
- Actual complete inbox browser checks submit an admin and renter message through protected handlers, confirm sender and account/rental linkage, empty composer, owner-only control exclusion, handoff and renter request form. 800px/390px checks confirm no horizontal page overflow and tools follow the conversation.
- Browser/API fixtures use isolated synthetic tables. Outbound scheduler work is recorded but never executed; no customer messages, provider payments, production records or deployments were changed.
- Fresh built HTTP routes `/`, `/gear`, `/checkout`, `/account`, `/admin` returned 200. Public landing/gear/checkout HTML contains no management shell or admin manifest.
- Local code graph updated after the changes.
