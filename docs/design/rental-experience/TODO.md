# Active rental experience goal

This checklist extends the original goal; no original integration requirement is removed.

### 8 October 2026 — private inventory bridge

- [x] Replace all anonymous website source reads with the existing configured server synchronization credential, validated HTTPS manager endpoint, redirect refusal, timeout and versioned path-bound receipt. Reject errors before source writes.
- [x] Add a registered private manager POST route with a fixed read-only allowlist and exact DB Cinema account arguments. Use actual typed internal counterparts while retaining the public owner boundary; remove unnecessary renter/private metadata from responses.
- [x] Actual client/server handler tests and the paired native HTTP fixture pass under owner enforcement, including exact stock import, upstream occupancy blocking the cart, demand refresh and failed credentials preserving stock. See PRIVATE-INVENTORY-BRIDGE.md.
- [x] Full local website tests/typecheck/build and manager 2144 tests/typecheck/Next build/owner audits pass; both graphs are current.
- [ ] Complete source-matched hosted checks, manager-first paired backend rollout and live connection acceptance. Canonical kit mapping, live freshness and shared atomic claims remain required by the full goal.

### 8 October 2026 — exact master stock quantities

- [x] Remove historical maximum retention and listing-demand stock inflation. Mirror exact eligible master quantities, including decreases and zero, while preserving shared pools, rental occupancy, owner tags/photos and selectable zero-stock catalogue cards.
- [x] Validate all source quantities/conflicts before writes and version the sync fingerprint. Protect the old quantity maintenance mutation and report shortages without manufacturing units. Pair manager eligibility export and actual handler tests; see MASTER-STOCK-SYNC.md.
- [x] Reproduce inflation with the previous actual sync handler. Full local website default tests/typecheck/build and manager 2131 tests/typecheck/Next build/owner audits pass.
- [x] Hosted website CI 37726913850 and manager CI 37726916354 are SUCCESS; source-matched previews are READY. Read-only live source confirms 108 records still lack eligibility fields and 135 of 405 priced listings lack a known master identity. Unknown mapping is not a marketing-only classification.
- [ ] Complete manager-first compatible rollout/real stock acceptance. Complete canonical kit mapping, live authenticated bridge acceptance and shared atomic reservation claims remain required alongside the original full goal.

### 8 October 2026 — checkout stock and consent recovery

- [x] Validate full-order stock inside hold insertion, including real active inventory, shared component quantities and date blocks; count complete kits in listing availability and avoid promising marketing inventory through that query. Keep catalogue selection and demand logging unchanged.
- [x] Preserve one exact hold allocation and original expiry on retry; reject changed/partial/duplicate allocations for reconciliation. Close a newly rejected, unbound pending order before Stripe creation, while preserving bound or ambiguous payment outcomes.
- [x] Native actual checkout recovery verifies fresh consent/IDs after confirmed closure, original IDs on unknown outcomes, preserved customer details and protection against delayed rejection clearing newer consent. See CHECKOUT-STOCK-RECOVERY.md for handler/native evidence and boundaries.
- [x] Full default tests, TypeScript, production build and graph update pass locally.
- [x] Hosted CI 37726023012 for 028a7a7 is terminal SUCCESS, including the complete checkout browser regression. Matching preview dpl_4hKDyc7S17F3sJ2ihFNym1uYFT1Y is READY.
- [ ] Complete compatible backend/live acceptance. A single authoritative cross-project stock claim, the remaining full integration, private documents, reference fidelity and accurate equipment renders are still open.

### 8 October 2026 — photographed return cards and inspection ownership

- [x] Add exact rental-bound item photos beside independent condition controls, with explicit missing-photo fallback, two-column desktop and one-column mobile layouts. Exclude kit/pack/incorrect-name photos and keep photo metadata outside frozen financial records. Protected schedule/context handlers share the projection.
- [x] Reproduce stale A/B/A inspection acceptance with the previous component. Remount for each rental/session and prevent delayed reviews or settlement results from affecting another drawer; bind private PDF object URLs to current bytes.
- [x] Full local tests and final production build pass. Inspected actual-component desktop/mobile fixtures cover delayed success/error, A/B/A, session rotation, private PDF, pending settlement, reopen and exact photo fallback. The full actual-handler/PDF inspection-to-settlement fixture passes with synthetic Stripe/email. Default tests now include all return review/PDF/inspection checks. See RETURN-CARDS.md for precise evidence and limits.
- [x] Push the return-card source 4a31955 and portable CI/PDF checks through 50b6f88. Hosted CI 37723610259 is terminal SUCCESS, including typecheck, the complete default tests, real PDF extraction/rasterization, production build and full checkout browser regression. The application preview dpl_CAeec13xvxFnaQsv4bjDgtNHAhxt is READY; later revisions change only CI/test tooling and documentation.
- [ ] Perform compatible backend/private live acceptance. Remaining original visual fidelity, accurate owned equipment images, authoritative cross-project stock claims and full integration requirements remain open.

### 8 October 2026 — checkout reload confirmation

- [x] Reproduce the complete native reload failure with passive frame/network/lifecycle events. It opens a before-unload dialog and waits unanswered. This direct evidence supersedes a renderer-hang claim for that run; do not attribute the prompt's listener without further evidence.
- [x] Confirm before-unload only during deliberate test navigation/reload; unexpected dialogs and confirmation errors still fail. Preserve all application behavior, UI/security/membership/persistence assertions and timeouts. The full native suite passes twice, including a passive trace of the real confirmation and subsequent document load. Actual Chrome calibration verifies both native confirmation and unexpected-alert rejection using the real helper.
- [x] Verify source-matched hosted CI 37721183227 for adc7a89: typecheck, tests, production build and complete browser regression are terminal SUCCESS. Matching Vercel preview dpl_4BTBAmqYL2xH8zKZ6KwTMw8JX2DH is READY. The preceding website stock run 37720165776 failed browser reload; manager 37720168821 is SUCCESS.
- [ ] Complete private, live financial/document, cross-project reservation, remaining visual and equipment-asset acceptance. Preview readiness does not publish compatible backend functions or establish production integration.


### 8 October 2026 — physical custody and unresolved stock holds

- [x] Extend Rental Manager's shared live quoting path beyond the dashboard's seven-day grace assumption: overdue delivered equipment blocks future quotes until return, retaining per-item website windows and excluding obsolete/recorded-return rows. Actual frozen-clock quote regressions cover ancient custody, ongoing status, future dates, recorded return, own-request exclusion and latest-window quantities; full checks/publication are tracked with manager PR #65.
- [x] Share stock occupancy semantics between full-cart availability, listing availability, replacement inventory checks and atomic checkout holds. A physically active rental overdue by date remains occupied until return; planned dates remain unchanged. An expired TTL does not free a pending-payment booking before provider reconciliation.
- [x] Preserve DELIVERED/confirmed custody when mirroring older manager rentals. Exclude RETURNED, REVIEWED, completed, cancelled and obsolete source rows from mirrored stock. Actual source/feed/cart/replacement/hold regressions verify blocking well beyond the old return date and release after actual return or terminal payment reconciliation.
- [ ] Publish the compatible manager feed/index and website occupancy source, then verify real source stock and deployed cart alternatives. The manager feed fix is paired in PR #65.
- [ ] Establish and verify a single authoritative reservation claim across website and Hygglo writers. Website hold insertion serializes only against its local mirrored ledger; asynchronous cross-project mirroring alone does not establish a distributed no-double-booking guarantee. Preserve this original requirement alongside the remaining full-goal work.


### 8 October 2026 — management sidebar reference treatment

- [x] Bring the shared account/admin sidebar to the reference's 237px desktop width, reduce excess spacing above navigation, use the copper/white serif wordmark and add the existing camera poster above the stacked brand footer. Treat the poster as decorative brand imagery, not an accepted owned-equipment ERNIE render.
- [x] Keep all styling inside the management CSS module. Native actual shell/customer component checks verify the decoded poster, desktop/mobile overflow, nine navigation controls, mobile close button, Escape and selection closure. Inspected screenshots are at `/root/dbc-management-sidebar-review`; synthetic customer/query transport does not establish live account acceptance or full concept pixel fidelity.
- [ ] Complete remaining page/reference fidelity and verify deployed account/admin layouts. Hosted CI 37718931122 for preceding conversation commit d4ecf81 is SUCCESS; broader live, private document, financial, equipment render and paired-manager acceptance remain open.


### 8 October 2026 — conversation response isolation

- [x] Bind send, handoff, suggested-reply and read-error responses to their originating conversation, account, role and session. Revisiting a conversation creates a fresh scope, so a prior request cannot erase its new draft or finish a newer pending operation. Preserve new text typed while a previous message sends.
- [x] Native actual React component checks pass with controlled deferred transport: A/B/A switching, delayed success/error, new drafts while sending, token rotation, concurrent reply suggestions and handoff errors. Mutation payloads retain their originating rental. The previous source fails the first assertion by clearing B's draft on A's success. Desktop/mobile screenshots at `/root/dbc-conversation-scope-review` are inspected for overflow; the fixture is not a full concept-fidelity or live messaging acceptance claim.
- [ ] Verify real authenticated conversation actions on the deployed account/admin screens. Remaining design fidelity, inventory images, paired-manager and financial/document acceptance remain open. Hosted CI 37718462957 for document linking commit 64d2c1a is terminal SUCCESS.


### 8 October 2026 — verification copies captured before account creation

- [x] Link existing verification archives and document metadata inside paid-account creation, using permanent rental ownership. Existing archive recovery repairs unlinked copies as well. Preserve storage bytes, integrity hashes, session binding, retention dates and deletion status.
- [x] Reject conflicting account, rental or session bindings before metadata repair. Never move copies to a new holder of an old email address. Actual paid-account/query/save/recovery handlers verify pre-account capture, later account creation, private directory visibility, in-flight worker completion, payment replay and foreign owner/session rejection.
- [ ] Verify this account-creation order with real Didit and deployed private document access after compatible backend publication. Hosted CI 37718088311 for the previous historical-backfill commit 62bf23d is SUCCESS, including the unchanged complete membership browser suite; intermittent reload reliability remains open because earlier source-equivalent runs failed.


### 8 October 2026 — complete historical verification backfill

- [x] Replace the latest-100-rentals cutoff with indexed 25-rental transactions and scheduled continuations covering all permanently owned rentals and unlinked current-email rentals. The existing admin document action invokes the real pipeline; each continuation is internal.
- [x] Apply the same retention decision used by private viewing and deletion before copying historical verifications. Preserve older copies needed by active reuse, open claims or unknown closure; exclude expired verifications and previously deleted archives.
- [x] Exercise 195 eligible rentals through actual handlers and a synthetic scheduled queue: changed-email ownership, unrelated/foreign exclusion, both ownership indexes, bounded page sizes, termination, retry deduplication, deleted-byte protection and denied admin access pass. Archive and real worker regressions pass. Add all three to the default CI test command.
- [ ] Verify deployed scheduled continuations, real Didit copies and private admin viewing after compatible backend publication. Source/fixture success does not establish live provider acceptance.


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

### 8 October 2026 — permanent rental ownership in paginated account views

- [x] Reproduce loss of permanently linked rentals from the account feed after an email change. Merge indexed account-ID bookings with unlinked legacy bookings at the current email; exclude bookings belonging to other accounts even when their email matches.
- [x] Use the actual composable query-stream implementation and its reactive pagination hook, with indexed ownership lookups, bounded reads, stable timestamp/ID ordering, page-size validation and fixed end cursors. Add the matching account/email index and pin the helper release compatible with the current Convex SDK.
- [x] Real-handler tests cover 137 mixed rentals, old/reused mailboxes, equal timestamps, complete paging without duplicates, bounded reads, new records across bound pages and foreign cursor isolation. Full existing tests and Next build pass. Native actual helper-hook/query fixture confirms all 137 records, end-cursor propagation, account switching and desktop/mobile overflow; inspected screenshots in `/root/dbc-account-pagination-review`.
- [ ] Publish the matching backend index/query and account hook together, then verify signed-in hosted paging. Latest earlier hosted CI failed at the existing checkout-browser `Page.reload` timeout, twice; investigate before treating CI as green. Local full checkout runs also stalled at screenshot/navigation. Verified temporary Next output and a stopped test-browser profile were cleaned up after Chrome reported a full disk, restoring about 1.6 GB, but another navigation stall remains. Browser diagnostics now log each screenshot/reload, remove per-navigation listeners and await command/event promises together to avoid unhandled rejection. No assertion or timeout was weakened.

### 8 October 2026 — retention confirmation and browser investigation

- [x] Reconfirm the requested 30-day retention rule and rerun actual archive/worker regressions: account/rental links, required copies, integrity/readback, retry repair, admin-only access, exact expiry and active-rental/insurance exceptions pass. Live Didit copying and deployed admin viewing remain separate acceptance checks.
- [x] Narrow the browser reload failure to security summaries followed by full-cart clearing. Checkout/cart contain no video elements at the failing point. Foregrounding, known navigation flags, enabled GPU rendering, omitted screenshots, blocked Stripe loading, enabled cache and resetting scroll do not resolve it; no such workaround was retained in source or production.
- [x] Two focused controls complete all security, clear, persistence and drawer assertions when the global headline observer is omitted or its callback is empty. The original observer still reproduces the lock, including with top-frame scope, pre-navigation disconnect, delayed body attachment and microtask-deferred reads. Keep the continuous headline assertions until an equivalent, verified observation mechanism is available; this is diagnostic evidence, not a fixed full-suite run.
- [ ] Resolve the observer-related reproduction, rerun the complete browser regression and obtain hosted CI success. Native fixture/local checks and ready previews do not prove live payment, private-document or paired-manager acceptance.

### 8 October 2026 — operational dark admin overview

- [x] Lead the admin overview with actual active/confirmed rentals, unread messages, recent alerts and equipment cards in the dark management shell. Preserve protected traffic/demand reports and connect every management/calendar/inbox/report action to the existing handlers.
- [x] Keep long-overdue collected equipment visible until return; separate confirmations awaiting collection/delivery. Use complete indexed counts, six-card previews and actual paginated-rental navigation. Preserve quantities, independent periods, real catalog photo fallbacks, unknown date/time labels and per-line London return deadlines without executing charges.
- [x] Actual query regressions, the full existing test suite and TypeScript pass. Build and native desktop/mobile handler/component fixture validate counts, overdue/unagreed labels, record-bound actions, complete-count links, denied access and overflow. Inspect `/root/dbc-admin-dashboard-review`; rental database/transport are synthetic, photos are current public catalog sources.
- [ ] Finish reference parity/accepted equipment assets, resolve the separate checkout observer failure, publish compatible frontend/backend and verify hosted operations. Fresh public binding/preflight still shows the same manager owner, enforcement, target and credential blockers; no live writes or financial execution were enabled.
- [x] Push dashboard source `fcc54cb1898006f91c647c2ad8a01ea1de519169` to draft PR #58 and verify its Vercel preview `dpl_AVM9vHPeSbTJ2wrcZ9hskHNLQRYA` is READY. Native final screenshots and old-response/access-denial checks pass. Hosted CI `37711378016` passes typecheck/tests, but is terminal failed at the unchanged Google-font/Turbopack loader (`next/font/google queries have exactly one entry`) before the browser step. Keep this separate from the independently reproduced checkout reload failure; preview readiness is not live/private acceptance. Investigate font asset handling without changing the agreed typography or public-page appearance.

- Font-loader build recovery: vendored the exact successful-build WOFF2 bytes, 43 faces/fallback metrics and six preloads with five licences. Local production build, typecheck and full npm suite pass; native landing/gear/empty-checkout font definitions and loading are unchanged; the gear page’s first 15 main heading/button dimensions are unchanged. See LOCAL-FONTS.md; hosted CI/preview pass, while the repeated native Chrome 154 post-clear reload timeout remains open.

- [x] Verify source cd2fdf9: hosted CI 37713153863 is terminal SUCCESS, including the previously failing full membership/cart/checkout clear/reload regression with unchanged assertions. Matching Vercel preview dpl_3BHuDTK6ZttqEb1VfyuEjJZWUYFT is READY. Local archive and worker fixtures also pass 30-day expiry, active-rental/insurance preservation, binding, private viewing and incomplete/corrupt-copy repair. Live Didit/private owner/integration acceptance remains pending.

- [ ] Native Chrome 154 still times out at Page.reload after clear on cd2fdf9, despite the unchanged complete hosted suite passing. Preserve this exact distinction and continue diagnosis; do not mark native acceptance complete. Log /tmp/dbc-local-font-native-browser.log.

### 8 October 2026 — customer profile mutation isolation

- [x] Reproduce the old UI clearing a different customer's note when a prior account save completes. Scope note/access result messages, draft clearing and busy changes to the initiating account/admin session; invalidate scope on profile change/close and preserve independent concurrent saves.
- [x] Native actual-component/actual-handler fixture passes success/error delays, original mutation account IDs, close/reopen, token revocation/restoration, pending inputs and desktop/mobile overflow. Synthetic records only; final screenshots at /root/dbc-customer-scope-review. Production build/typecheck and admin/customer/directory handler suites pass.
- [ ] Push and verify hosted source/preview checks, then include this in compatible management publication and actual authenticated account acceptance. All original visual, equipment, manager and live document requirements remain open.

### 8 October 2026 — NP-F970 pilot and hosted profile checkpoint

- [x] Revalidate live Base provider availability, unchanged engine revision/strict request contract and the DB Cinema output bucket. Inspect Sony's dimensional drawing, record its digest and prepare a faithful one-pack side-profile prompt with tight framing and no invented rental-set contents.
- [x] Submit one unchanged-quality Base pilot: jd7ekk89x7w07zach9vpj0y6058fwkw8. Authoritative 202 receipt and real Jarvis A30 running attempt confirmed; 15-second job polling is active. Remaining candidate drafts stay unsubmitted.
- [ ] Follow this exact job to terminal state, verify PNG/hash/native receipt/owned R2 binding, inspect hardware proportions/framing/lighting, then accept or reject explicitly before any card use or larger batch.
- [ ] Hosted CI 37714731154 for customer-profile source ec03963 is terminal failed at a later membership checkout Page.reload timeout, despite passing typecheck/tests/build. Earlier cd2fdf9 hosted run passed the complete suite. Keep intermittent hosted/native reload reliability open; do not describe the profile-only source change as a proven checkout cause.

- [x] Pilot 3 completed and GPU terminated; independent PNG/native receipt/R2 checks pass. Reject its hardware proportions/grip/interface and loose framing explicitly. Evidence in ernie-pilot-3-output-verification.json; no accepted card image and no bulk release. Add primary NP-FW50/NP-F570 family descriptions with unresolved OEM/casing blocks (41 descriptions, nine blocks, 32 drafts, 41 remaining reviews).
- [x] Customer-profile preview dpl_Du2Y8ZJykAPcM6Mubg34Qgjx82CC is READY for ec03963. Hosted CI remains terminal failed at a later checkout reload, with typecheck/tests/build passing; private/live acceptance still open.

### 8 October 2026 — complete browser controls and error propagation

- [x] Verify hosted CI 37715627010 for source 2d24b2e is SUCCESS. Retain the earlier terminal failure as evidence of intermittent reload behaviour.
- [x] Correct the causal claim: full native global-observer omission still fails, although the smaller raw-collector/no-observer controls pass. DevTools and batch-reconstruction replacements did not fix the complete reproduction and were removed. Fresh isolated Chrome 145 with profile/cache in shared memory also fails; no test assertion/timeout was weakened.
- [x] Reproduce and fix CDP page exceptions silently returning undefined. Actual-browser calibration verifies normal/async/undefined results and syntax/runtime/async rejection; the old helper fails the same negative check. Wire it into CI before the unchanged membership suite. See BROWSER-RELOAD.md for scope and terminal logs.
- [ ] Resolve complete native/hosted reload reliability and finish all original visual, equipment and live paired-manager/private-document acceptance requirements.
