# Reliable website delivery to Rental Manager

Implementation is local; DB Cinema backend verified on development `veracious-wombat-196` only. No production deployment or customer notification was executed for these changes.

Every existing booking lifecycle push now commits an incremented revision and pending delivery state in the same booking transaction. A worker lease prevents concurrent sends. Delivery requires a successful HTTP response with `{ok:true}`; failures back off and retry through a one-minute cron, with twelve failures surfaced for admin retry. Expired leases recover stopped workers; acknowledgements for older revisions cannot clear newer pending changes. The admin rental controls display delivery status and offer an audited retry when necessary.

Rental Manager stores the website revision and ignores older payloads. The fallback poll uses pages of up to 100 bookings, including explicit cancellations, without cancelling reservations absent from a partial feed. Previously the 1,000-booking feed could falsely cancel older upcoming bookings. Updates clear obsolete times, order steps and image hints. Upcoming confirmations enqueue the existing notification pipeline once; historical imports and repeat polls remain quiet. Notification links open the website's actual scoped owner conversation.

Validation:

- `node scripts/test-rmv2-delivery.cjs`: queue, lease, stale acknowledgement, backoff, bounded attempts, worker recovery and response receipt checks passed.
- Rental Manager: 43 tests across sync handlers, push registration and notification copy passed. The sync suite exercises a 1,200-booking import, stalled pagination, repeat and out-of-order updates, explicit cancellation, historical import, and clearing stale fields.
- Both TypeScript checks and both Next production builds passed.
- Actual development queries: invalid token rejected; authorised paged feed returned two bookings with cursor/revisions; real delivery status query returned legacy `unknown` without inventing a receipt.
- Return inspection and replacement-set regression suites passed.
- Native Chromium against the actual development admin conversation rendered delivery status and its retry control, without horizontal overflow. Screenshot inspected: `/root/dbc-management-review/rental-manager-delivery.png`. No retry button was clicked and no external notification was sent.

Rollout must deploy the paged website API before enabling the new Rental Manager poll. Manager receipt/stale-revision support should precede live website retry activation. Verify the exact live deployments (`zany-wolf-18`, `hearty-oyster-600`) and their existing shared-secret/configuration pairing, then confirm a real authorised booking's notification/calendar/return updates without duplicate stock or revenue. Do not deploy Rental Manager to its unused default production deployment.

Still outstanding: per-line physical-stock windows and quantity mapping, native Rental Manager return inspection/financial bridge, document/provider download acceptance, visual completion, Render Engine images, and live end-to-end checks. Successful delivery is not proof of these remaining features.

## Physical reservation ledger — follow-up

The paged/single-booking feed now includes saved site reservation rows with canonical master IDs, component quantities and individual windows. Catalogue edits cannot change those saved allocations; cancelled/external rows are excluded, returned allocations remain available for historical inspection, and an existing empty ledger is distinguished from a legacy booking with no ledger. Guest names are preserved when no customer record exists.

Rental Manager consumes that ledger, rejects missing canonical mappings rather than acknowledging invented stock, uses peak concurrent component quantities for equipment displays, and stores the separate windows. Canonical images replace the current listing decomposition's thumbnails. `bookedUnitsOnDate` now counts each website component only on its saved dates, with and without the legacy allocation argument.

Additional evidence: actual feed-handler test covers catalogue edits, independent extension dates, quantities, statuses and legacy distinction. Twenty-two focused Rental Manager sync/availability/item-unit tests pass. Actual development feed query returned seven bookings, one with an empty cancelled ledger; it does not prove a live active booking's downstream windows. Remaining calendar, renter quoting and conflict consumers still need to use individual windows/time buffers, and live production acceptance remains outstanding.
