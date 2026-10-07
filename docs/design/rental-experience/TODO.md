# Active rental experience goal

This checklist extends the original goal; no original integration requirement is removed.

## Layout and visual scope — added 7 October 2026

- [ ] Rebuild renter account, rental conversations and management screens in standard dark mode, using the approved concept's layout and visual hierarchy.
- [ ] Bring the concept's left sidebar into account/rental management: role-appropriate Dashboard, Rentals, Calendar, Inventory, Customers/Members, Messages, Invoices, Reports and Settings; customer accounts must only expose their authorised functions.
- [ ] Preserve separate, clearly labelled equipment items with accurate photos, quantities and identifiers where available.
- [ ] Implement per-item Good condition / Issues found controls, issue descriptions and Mark all good.
- [ ] Implement custom retained amount, paid-deposit and uncaptured-hold breakdown, damage-case selection, reason, invoice preview and renter-email preview, with correct actual settlement arithmetic.
- [x] Generate GPT concepts for remaining invoice screens (`dark-invoices.png`).
- [x] Generate GPT concepts for remaining customers/members screens (`dark-members.png`).
- [ ] Generate additional management screen concepts as needed, consistently using dark mode.
- [ ] Inspect desktop/mobile implementation screenshots against the selected concepts before claiming visual completion.
- [ ] Keep all redesign styles and navigation scoped to account/rental management; verify landing, gear selection and checkout retain their current designs.

## Equipment hero images — added 7 October 2026

- [ ] Request and verify an Earnie image-render lane through Render Engine in parallel with interface development; inspect current admission, provider and cost state before spending.
- [x] Create the dedicated `db-cinema-rentals` Render Engine workspace/R2 bucket and a real ERNIE Base workflow; live readiness verified. See `EQUIPMENT-RENDERS.md` and `ernie-workspace-receipt.json`. Image batches, price/release checks and completed output verification remain outstanding.
- [x] Export actual individual inventory items, canonical identifiers and quantities from the Rental Manager master inventory (`master-inventory.json`, 108 records).
- [ ] Enrich and verify factual descriptions from actual listing data and reference photos. Current live snapshot: 82 owned/active items among 108 master rows; 16 have reviewed descriptions/source URLs and prepared owned candidates, 66 owned items still need review. Appearance/reference checks and image generation remain outstanding.
- [ ] Prepare a consistent image prompt per inventory item; match the actual equipment model and supplied reference photos.
- [ ] Render each item as a side-view kit showcase, filling the absolute majority of the frame, in a dark room with a cool overhead spotlight; maintain matching framing, scale, lighting and background across the set.
- [ ] Verify factual equipment accuracy and image quality; avoid inventing included accessories or misleading stock.
- [ ] Save final images in DB Cinema Rentals' own R2 bucket; verify object hashes and receipts before publication.
- [ ] Connect verified assets to account and management equipment tiles; preserve the public catalogue/checkout/landing design scope.

## Original integration requirements

- [ ] Archive every Didit ID/proof-of-address upload into DB Cinema storage, linked to the same account/rental, with integrity hashes, retry recovery, visible incomplete state and authenticated/audited admin viewing for insurance purposes. User confirmed 30 days after rental closure, with open insurance/case holds and preservation while reused by active rentals. Verify actual provider downloads and deployed viewing/retention before completion.

- [ ] Modern renter/admin cards and rental conversation rebuilt from the approved concepts.
- [ ] Drone operator licence upload and an additional admin assessment, visible only for drone rentals and enforced before handover; verify deployed end to end.
- [ ] Canonical live master-stock quantities and ongoing/upcoming reservations drive full-cart availability.
- [ ] Over-requested/marketing-only items remain addable for demand logging, then show unavailable/booked-out status and available alternatives on the full cart.
- [ ] Multi-item replacement sets respect requested quantities, shared units, retained cart demand, compatibility and original dates; offer horizontal cards, individual addition and atomic Add all.
- [ ] Booking creation and double-booking protection are transactional, and checkout saves precise collection/return periods.
- [ ] Website bookings and changes update Rental Manager notifications, calendar and operational flows.
- [ ] Returns can close rentals from either management surface; damage decisions, reasons, custom retention and cases synchronise.
- [ ] Automatic itemised settlement invoice and renter email describe actual charges/refunds and case reasons.
- [ ] DB Cinema Web has a consistent distinct colour on Rental Manager cards, calendar rows and all-time revenue graph, with correct equipment images.
- [ ] Verify every relevant Hygglo management integration also supports website bookings, without duplicate stock/revenue entries.

## Evidence so far

- Four initial GPT concepts saved locally. Generated financial text is illustrative only.
- Drone licence implementation committed as `121760e`; focused ownership/review tests, TypeScript and production build passed locally. Production acceptance still outstanding.
- Read-only live master inventory query returned 108 records, all carrying quantities.
- Quantity-aware replacement sets and management shell are implemented and tested locally, including native browser checks; production acceptance remains outstanding.
- Per-item return inspection, account-linked damage cases, email/PDF detail and case-aware document retention are implemented and tested locally; Rental Manager return bridge and live finance acceptance remain outstanding.
- Durable lifecycle delivery, revision ordering, paged fallback and website booking notifications are implemented locally. Both builds and 43 focused manager tests pass; development API authorisation/paging checked. See `RENTAL-MANAGER-DELIVERY.md`; production integration remains outstanding.

- Customers & Members source now has a dark directory/profile layout with real credit, rental/chat navigation, account documents and internal notes. Handler tests, 1488/390 native component fixtures and authorised development API reads pass; the Next build passes. Full-directory search/pagination, complete reference fidelity and production acceptance remain outstanding. See `CUSTOMERS-MEMBERS.md`.

- Rental Manager website revenue now has a separate emerald historical/current series, account-filtered hourly refresh and versioned cache admission, preserving aggregate totals. Build, 13 focused checks and actual native 1440/390 bars/lines/toggle fixtures pass. Mirror/pattern repository checks expose unchanged existing failures; production/cache rollout remains outstanding. See Rental Manager `docs/dbc-website-integration/REVENUE-COLOUR.md`.

- Individual physical-window pickup/return clocks now survive the website feed and manager stock ledger, including distinct extension deadlines and explicit unagreed times. Timed inventory search uses those clocks with the return buffer; actual source handlers and 27 manager checks pass. Booking-wide Gantt/weekly/strip views and deployed acceptance remain outstanding. See manager `docs/dbc-website-integration/CLOCK-WINDOWS.md`.

### 7 October 2026 — individual equipment calendar periods

- [x] Local Rental Manager strip, weekly and fullscreen Gantt now display the saved website physical windows and per-window clocks. Exact equal periods group together; separate dates or clocks stay separate, and gap dates remain empty. Equipment quantities and source rental IDs are retained. A return for one item cannot hide another item's away event.
- [x] Old calendar snapshots are bypassed until compatible version-2 snapshots refresh. Search and progress use the appropriate source/period identities.
- [x] 29 focused RM handler/item-window/grouping/geometry checks, TypeScript and Next production build pass. Actual Gantt native browser fixture checks pass at desktop/mobile widths; screenshots inspected. No live customer/financial writes or RM backend deploy for this checkpoint.
- [ ] Roll out compatible DB feed/RM calendar source together, correct the production DB binding, refresh calendar caches and verify real production rentals, photos and stock. Remaining full-goal work stays open.

### 7 October 2026 — quote clocks and return delivery status

- [x] Local manager quoting uses the saved pickup/return clock of each physical website allocation, preserves explicit nulls, supports older windows and carries the one-hour return buffer across midnight. Actual chat availability now leaves equipment-window gaps free and reports the correct upcoming period/quantity across the shared account pool.
- [x] Corrected the safe return context to report the return-statement email status rather than an unrelated late-fee email. Manager's completed settlement refreshes that status and shows queued/sending/sent/failed separately from completed financial settlement. Late rental amounts are labelled assessed, not yet collected.
- [x] 66 focused manager stock/calendar/geometry/bridge checks pass; DB return-context and return-inspection checks pass. Both TypeScript checks and manager Next production build pass. Native actual return-component fixture verifies the failure/retry delivery label; no live email or payment execution.
- [ ] Still required: exact production binding and deploy acceptance, statement/invoice pre-confirmation preview, real insurance-case linkage, remaining operational Hygglo parity, complete reference UI fidelity and verified owned-equipment renders. This checkpoint does not complete the full goal.


### 7 October 2026 — return statement review

- [x] Local website and manager return controls require an up-to-date server review, with private draft PDF and renter-email preview, before confirmation. Editing the decision invalidates confirmation; saved retries preserve the exact original decision.
- [x] Preview and execution share actual-balance/pence-based security arithmetic. Cash refunds, uncaptured authorisation releases, damage/cash splits and separate uncollected late assessments are displayed distinctly. Reduced/expired holds and insufficient captured security are covered.
- [x] Actual handler/PDF tests, both TypeScript checks/builds and desktop/mobile native component checks pass with isolated synthetic payments/email. Development preview endpoint checks cover unauthorised access. See `RETURN-INSPECTION.md`.
- [ ] Production rollout and actual provider/PDF-email acceptance, exact production connection/owner setup, damage-case pipeline integration, remaining operational parity, full visual fidelity and verified owned-equipment renders remain open. This checkpoint does not complete the full goal.


### 7 October 2026 — source damage-case pipeline

- [x] Local current booking feeds carry real source cases, physical item/evidence/customer bindings and closure outcomes. Opening/resolving cases queues durable revisions; manager imports deduplicate and preserve assessed payouts and pipeline progress.
- [x] Existing manager case drawer/fullscreen panel show the source case and rental/document link with documented owner-gated resolution. Manager deletion and generic website Open Case bypass are blocked. Repair-stage stock uses mapped affected units.
- [x] New private case imports require enforced manager owner authentication. Handler/retention/sync/stock regressions and native desktop/mobile interface/source-closure fixtures pass; both builds pass.
- [ ] Register/verify live owner and enforce query protection, correct production binding and publish both compatible halves, then verify real source-case/retention/document/stock/notification acceptance. Complete reference visuals and owned-equipment images remain open with the rest of the full goal.

### 7 October 2026 — equipment facts and reference audit

- [x] Read actual inventory/photos without changing provider or customer state: 108 master entries, 82 owned, 48 owned with 29 distinct cached photos. Visually inspect 28 downloaded references; record 12 incorrect bindings and accept none as exact owned-unit reference evidence.
- [x] Add 17 primary manufacturer fact reviews alongside 16 reviewed master descriptions. Preserve distinct local provenance and block four unconfirmed kit/region configurations. Forty-nine owned entries still need description review.
- [x] Add reproducible offline catalog/batch preparation with stable identities, owned-only selection and the 16-candidate API limit (draft batches 16/13). No job submitted, price invented, paid lane released or image claimed complete.
- [ ] Resolve remaining facts/configurations, check current execution pricing and stage/release semantics, obtain verified project R2 output receipts, inspect actual appearance/quality, and wire accepted assets. Full goal remains unfinished.

### 7 October 2026 — dark return-inspection layout

- [x] Rework the actual admin conversation return drawer into distinct item condition cards, a damage-case switch, paired payment/settlement panels, and separate private PDF and renter-email preview cards. Custom deductions/evidence stay wired to the same saved decision and server review. Scope is the return drawer only; public pages are untouched.
- [x] Verify production build/typecheck and actual preview/PDF handler regressions. Exercise native desktop/mobile inspection, issue/case selection, custom retention, review invalidation, PDF bytes and a single confirmation against real application handlers with isolated synthetic Stripe/mail. Inspect final desktop/mobile screenshots in `/root/dbc-return-layout-review`.
- [ ] Accepted item photographs, full conversation/reference parity, remaining management screens, deployed acceptance and the rest of the goal remain outstanding. This is a local source checkpoint, not a production release.

### 7 October 2026 — admin conversation structure

- [x] Replace the arbitrary sidebar grid-row span with actual conversation/controls columns. Preserve the same extension, return, messaging and composer components; stack controls above the thread on smaller screens. Scope the reference-style message presentation to admin conversations inside the management shell.
- [x] Add real message-date groups while retaining message identities, pagination, read observers and current local timestamp behavior. Keep ordinary account conversation controls in the same main wrapper.
- [x] Verify typecheck/build, actual rental-chat authorization/read/handoff regressions, and native 1440px/390px screenshots. Native fixture uses the real management shell, conversation, rental tools and isolated real query/send/handoff handlers. One keyboard-sent owner reply is bound to the synthetic account/rental and clears its composer; handoff/takeover create their expected system messages. Inspect `/root/dbc-conversation-layout-review`.
- [ ] Full inbox/booking-details reference parity, remaining management views, real deployed acceptance and the other integration/render requirements remain open. No production publishing or live customer messages occurred.
