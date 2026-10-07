# Active rental experience goal

This checklist extends the original goal; no original integration requirement is removed.

## Paired review checkpoint

- [x] Make compatible local changes reviewable in draft [website PR #58](https://github.com/daniels-project-space/db-cinema-v2/pull/58) and [Rental Manager PR #65](https://github.com/daniels-project-space/rental-manager-v2/pull/65). Preserve the latest manager invoice-statistics/reconciliation improvements by merging current main before review.
- [x] Run actual read-only live preflight: the public website uses `zany-wolf-18`; manager targets the older backend, has mismatched credentials and lacks a registered/enforced private owner. No private imports, financial writes or customer messages were enabled. See manager `LIVE-READINESS.md`.
- [ ] Resolve private owner setup, pair compatible deployments/credentials, verify hosted UI and actual provider/storage/calendar/stock/settlement behavior. Draft PRs and passing local fixtures do not complete production acceptance or the remaining reference/image requirements.

## Full customer-directory checkpoint

- [x] Replace the recent-50 directory slice with bounded server cursors, case-insensitive name/email search and membership/verification filtering across every account. Automatically continue through sparse batches; distinguish loaded counts from complete counts and clear stale selected profiles on query/authentication changes.
- [x] Verify real query handlers with 221 synthetic accounts, the complete existing npm test suite, Next build and native 23-page desktop/mobile interaction through actual handlers. Inspect `/root/dbc-customer-directory-review`.
- [ ] Publish compatible directory queries/frontend and verify actual production customer search, access controls and the rest of the requested reference fidelity. The broader goal remains unfinished.

## Equipment reference-input checkpoint

- [x] Confirm current Render Engine main and the actual pinned project worker. Exercise its real parser: the existing pilot request passes, but candidate/root reference-image inputs fail. Record the current empty-latent text-only path and immutable source hashes in `ernie-reference-input-audit.json`; no model changes or paid dispatches.
- [x] Add four source-linked manufacturer model/family reviews and revalidate live canonical ownership. Reproduce the 39-description catalog and 32-candidate 16/16 drafts, preserving seven configuration blocks and 43 pending description reviews.
- [ ] Choose and qualify a faithful image-generation approach, resolve equipment identities/configurations, render and inspect all owned items, verify project R2 bytes/receipts and connect accepted assets. Neither rejected drone pilot is accepted; the full asset requirement remains open.

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

### 7 October 2026 — invoice details and permanent ownership

- [x] Add a selected-document panel to the actual admin/renter invoice library, with protected customer/rental data, equipment, applied credits, confirmed refunds, separate deposit/authorisation records and issued return deductions. Subscription credit is explicitly a portion of total credit; it is not deducted twice. Return details use the issued statement date; rows label their rental-creation date.
- [x] Protect invoice access with permanent account ownership, preserving normalised email compatibility only for unlinked legacy rentals. A customer changing email keeps access; a different linked account with the old booking email is denied. Add actual query regression checks for owner/admin, expired/foreign sessions, private-field exclusion and unknown legacy refund amounts.
- [x] Inspect native desktop/mobile paired/stacked panels and authenticated PDF preview/download using actual query/PDF GET/renderer with synthetic account/rental data. Build/typecheck and return/PDF regressions pass; screenshots are in `/root/dbc-invoice-layout-review`. A failed generated-font cache build was resolved by cleaning only generated Next output and rebuilding.
- [ ] Publish compatible source/backend changes and verify actual live customer and admin document access. Full reference fidelity, remaining management screens, equipment assets and the broader goal remain open.

### 7 October 2026 — ERNIE equipment pilot

- [x] Validate one reviewed aircraft-only candidate with the current engine parser, preserve the full Base quality contract, recheck DB Cinema R2 binding and submit the existing workflow with deterministic idempotency.
- [x] Verify the real job is running: `jd78hms12daqs0e34hq67ffj1h8fv0g9`. Record request/receipt and the per-attempt budget/retry semantics; do not treat submission as a dry run.
- [x] Follow pilot to completion and terminated GPU; independently verify the 1,286,349-byte 1264×848 PNG in DB Cinema R2 and record server-revalidated native receipt. Recorded GPU cost $0.0165. Inspect output against manufacturer imagery.
- [ ] First output rejected for wrong hardware geometry and view. Tighten appearance-specific prompt and deliberately retry one candidate before larger batches. No inaccurate image is bound to cards. Remaining batches, factual reviews and management image binding stay open.

### 7 October 2026 — second equipment pilot and model identity review

- [x] Run a deliberate model-specific folded Mini 4 Pro pilot under the same full-quality ERNIE Base contract. Verify completed job `jd77gbyts0phpv8gpr82r86s918ftvwh`, terminated GPU, owned R2 PNG bytes/hash/native geometry and server-revalidated native receipt. Recorded GPU cost $0.0167.
- [x] Inspect native browser output against manufacturer page-14 aircraft diagram. Reject inaccurate camera/nose geometry and loose framing; neither pilot is bound to cards.
- [x] Add source-linked original Ninja V and CineBloom family reviews, retaining filter-configuration uncertainty. Regenerate live inventory brief and deterministic 35-item catalog / 30-candidate drafts. Extend actual verification helper to immutable pilot revisions without losing visual-review evidence.
- [ ] Investigate stronger model-specific/reference-guided rendering; finish accurate images and card binding. Resolve pending lens-generation/other model identities, remaining 47 factual reviews and five configuration blocks. Full UI/integration/live acceptance scope remains open.

### 7 October 2026 — effective document retention and scoped viewing

- [x] Share one retention decision between the account documents query, protected document reads and deletion worker. Show active linked rentals, automatic open damage-case preservation, manual insurance reasons, unknown closure dates and the latest linked closure plus 30-day deadline.
- [x] Deny document reads at expiry even before scheduled byte cleanup; preserve access when active rentals or genuine case holds apply. Keep deleted-file audit metadata and authenticated/audited viewing.
- [x] Replace the browser prompt with an inline insurance reason form, show saved reasons and distinguish removal of an admin hold from automatic case retention. Label identity/address copies clearly.
- [x] Abort/ignore stale document requests and clear/revoke previews on account/token changes. Bind preview rendering to the same account/token before effects run; close cancels pending viewing. Scope asynchronous mutation errors and state to the originating account.
- [x] Actual archive/worker regressions, exact expiry/case/reuse projection checks, TypeScript and final production build pass. Native actual component/query/mutation/protected HTTP fixture verifies saved/removed holds, decoded private PNG, account-switch race protection, token revocation, expiry 403 before cleanup and mobile overflow. Inspect final desktop/mobile screenshots at `/root/dbc-document-retention-review`. Fixture accounts/storage are synthetic; no live provider/customer mutations.
- [ ] Publish compatible source and verify real provider copies, account/rental associations, actual admin viewing, retry recovery and deployed retention/insurance behavior. Full reference redesign, accurate equipment images and remaining Rental Manager/live acceptance requirements stay open.

### 7 October 2026 — renter equipment showcase and visible progress

- [x] Give the first non-history rental a larger equipment image and secondary unique kit thumbnails beside its actual title, dates, saved logistics, visible labelled progress and separate deposit/card-authorisation amounts. Keep remaining cards/history compact and preserve original quantities and per-period kit contents.
- [x] Include direct and nested-kit drone requirements and saved manual licence status in the actual account projection. Keep upload/replacement/review current until approval; do not expose private document storage IDs. Use one progress list in the larger card while retaining its verification-page link.
- [x] Full test suite and final production build pass. Native actual-components/actual-account-handler fixture checks unpaid, current, drone-review and history groups, security values, conversation and authenticated document/calendar links, scoped draft action/error, mobile navigation and overflow. Inspect final screenshots in `/root/dbc-renter-showcase-review`; accounts, images-missing state and action transports are synthetic.
- [ ] Complete full reference visual fidelity and accepted equipment photographs, publish compatible frontend/backend, and verify actual signed-in hosted rental controls and document access. These local fixtures do not prove live financial or provider acceptance.
