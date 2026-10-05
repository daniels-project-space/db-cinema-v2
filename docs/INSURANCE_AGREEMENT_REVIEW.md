# Rental agreement and insurance review — 5 October 2026

Reviewed changes against `ab18d4c34e8aeddd497935bb5ded629d33a805f5` in `/home/ubuntu/db-cinema-v2`. Initially prepared as a source-only review. On 5 October the operator explicitly authorised publication of the new terms and requested PDFs without personal data. The current public text omits the individual equipment owner’s name; PDFs are standalone terms without customer particulars. Publication does not authorise checkout activation, lifting handover review, payments, broker messages or customer data changes. The pre-existing `.serena/project.yml` work is excluded from this release.

## Implemented behaviour and limits

Legal version advances from the inspected `2026-10-v8` to `2026-10-v9`, following the existing increment convention. The full inspected v8 text is preserved in `shared/legal-history/2026-10-v8.ts`; v9 is the real legal-page and new agreement text. Current pages accept a version query for those two versions. Independent membership `2026-10-membership-v9` and referral `2026-10-referrals-v2` economics/text remain unchanged. The checkout reference to referrals is corrected to its actual independent version. Earlier legal versions remain in existing Git history and booking records; no fabricated full copy is attached to an older booking.

New acceptance records store an immutable `agreementSnapshot` with the signer, server timestamp, actual accepted document text, identity/contact/address, canonical saved item/date/rate/charge/security particulars and London local pickup/return times. Only the booking transaction creates it. A random attempt identifier and indexed transactional comparison return the original pending booking on identical retries, reject changed particulars under that identifier, and reject completed/closed attempts. A repeated checkout can reuse its bound open Stripe session; an unbound interrupted attempt remains pending reconciliation instead of creating another payment obligation. No new automatic provider recovery or duplicate-payment charge is introduced.

The authorised existing receipt endpoint includes the retained copy and the PDF renders its full terms and original particulars. Receipt email attaches the snapshot independently of PDF availability. Existing ownership/secret authorization is retained; public booking status does not expose the snapshot. No raw identity or biometric documents are added. The tests render the actual PDF and stub email delivery; no real emails were sent.

Changing the signer, customer identity/address or handover/return details resets checkout assent. Versioned links show which terms are being accepted. Existing quote repricing also resets assent. Historical bookings are never backfilled, re-signed, migrated or assigned v9 merely by viewing or downloading them. Existing amendments/extension/removal financial rules remain unchanged; original snapshot particulars remain intact when later booking fields change.

Handover now requires retained agreement acceptance in addition to the existing verification and booking-specific active-hold checks. **`RENTAL_DRAFT_RELEASE_READY=false` blocks future handover in this proposed source for all bookings pending broker/legal/operational review.** This deliberately includes historic/manual/legacy verification, since an old signature or provider boolean cannot certify the unresolved verification conditions. It does not change historical contract text, mark an existing rental as uncollected, or change agreed security amounts. It is an implementation review gate, not an invented insurer condition or evidence of approval. Publication of the terms does not lift this gate. There is no environment/admin override for this gate; lifting it requires reviewed implementation and separate launch authority.

The storefront has no actual serial/accessory/condition schedule or two-established-source evidence model sufficient to certify these requirements. The new snapshot explicitly says the serial/condition schedule is pending agreed handover, and release stays blocked. Adding a real approved schedule/acknowledgement and evidence workflow is required before the gate can be lifted; no fake evidence fields, expanded identity-document storage, or pretend release-ready status were added.

## Evidence and clause-to-source matrix

Broker thread: reviewed private correspondence (mailbox link omitted). Messages read include September 28/30, October 2 and October 4. The October 2 11:51 UTC message `1a0fc74691a53926` calls the quote v2, but its downloaded/extracted attachment is **Quotation v3**. Q3 and TMRS v5 first relevant pages were independently read from the Gmail attachment extraction. The extraction tool marks the inline extraction incomplete; no claim is made that every page/image of every attachment was independently reviewed. Base wording and September 6/26 details below use the user's verified findings where the source was not independently retrieved. Insurance correspondence and source PDFs containing risk-address details are not copied into the repository.

| Item / type | Source | Actual wording or workflow | Status / blocker |
|---|---|---|---|
| Written hire and pre-hire acceptance — policy condition | TMRS v5 p1 clause 5(a); base p5 Damage definition; September 6 broker finding | Rental agreement parties/particulars, responsibility and incidents; strict checkout assent; immutable copy; handover guard | Implemented for new checkout acceptance. Serial/condition schedule and material-amendment acknowledgement are operational blockers; older contracts are preserved, not re-signed. |
| Durable agreement evidence — implementation safeguard | TMRS 5(a), existing booking signer/version fields, existing receipt route and account ownership | Canonical text + particulars stored; private PDF/account download and email snapshot attachment | Implemented. Original record is not overwritten on retries or later field amendments. Real-customer mail/account download acceptance remains untested; fixtures exercise the actual implementation without sending messages. No separate PDF requirement is asserted. |
| Repeat/interrupted assent — implementation safeguard | Existing checkout/createPending/Stripe session binding | Indexed attempt identity; duplicate returns original, changed details/closed attempts rejected; unbound attempt stops for reconciliation | Fixture handlers and browser signer-change test pass. Real Convex serializable concurrency and provider-interruption tests remain outside this publication-only scope; no customer-write exercise was performed. |
| Renter loss/theft/damage and valuation — policy condition + proposed legal safeguard | TMRS 5; base Damage definition; September 6 finding; CRA/CMA references below | Rental terms/agreement/deposit: reasonable repair vs equivalent pre-loss replacement, fair wear/pre-existing/DB-fault exclusions, evidence/notice/dispute, no double recovery | Implemented draft; solicitor must approve allocation of responsibility and valuation/recovery language. No automatic new collection flow. |
| Deposit/hold vs liability/excess — clarification | TMRS 5 contains no mandatory deposit amount; Q3 p6 excess; existing security pricing source | Contract, checkout, pricing labels, email, FAQ/guide, bot and voice distinguish sums | Implemented. Existing bands/waivers/member benefits/booking charges preserved. No excess automatically becomes a renter charge/cap. |
| Optional renter insurance — broker clarification | September 26 verified finding, declared owned/declared leased kit | Rental agreement, insurance page, checkout, receipt, FAQ/guide, bot | Implemented. No Markel mandatory insurance or hobbyist exclusion, no comprehensive renter protection purchase. |
| Identity AND address, two different established sources — policy condition | TMRS v5 p1 clause 5(b); September 30 reply approved the described photo-ID/Stripe Identity/separate address/card/serial/signature process | Verification wording and hard release-review gate | Wording and blocking control implemented. Didit source types/issuer evidence and retained decision model are not expressly approved or certified by a pass. Broker approval and real minimised evidence workflow required. |
| 60-day current-account exception — policy wording / unresolved interpretation | TMRS 5(b) | Website login/account age is not substituted for a current account | Blocker. Broker must define qualifying current account and evidence; no new exception implemented. |
| Didit/reuse — existing product behaviour, not insurer requirement | Actual Didit flow and verificationReuse implementation; prior approval described Stripe Identity | Truthful 90-day/earlier-ID-expiry/name/address/provider-recheck wording; no verify-once claim | Existing actual reuse regressions pass. Approval of provider, retained evidence and reuse/exception is outstanding. No raw ID/biometric storage or sensitive-access expansion. |
| Transit packing — policy condition + broker clarification | TMRS v5 p2 clause 7; September 30 reply | Purpose-designed supplied protective cases, secure packing before transit | Implemented. Does not require an external professional packer. Operator must demonstrate actual packing. |
| Vehicle security — policy condition | TMRS v5 p2 clause 9 | Lock vehicle, shut openings, security activated, kit concealed | Implemented draft. Base p28 £3,500 saloon/hatchback and overnight/transit pp37–38 conditions need consolidated broker confirmation. Clause 9 does not silently override them. |
| Third-party carriers — policy extension | TMRS v5 p2 clause 10 | Agreed carrier, acknowledgement and responsibility allocation; no courier exemption | Implemented draft. Quote extends carrier custody to acknowledged delivery/return; exact operative security/custody rules still require confirmation. |
| Incident notice/recovery — policy/broker discrepancy | Base p13: ASAP/14 days discovery/30-day written claim; broker email: 15 days occurrence | Immediate DB notice, immediate police theft report, evidence/cooperation; DB broker notice independently of customer recovery | Draft implemented. Operator reporting procedure and reconciled deadlines required. No court-judgment threshold invented. |
| UK territory — Q3 schedule | Q3 p6: UK £35,000, Europe/worldwide not insured; generic extension text also present | Separate itinerary approval and confirmed insurance; permission alone cannot grant cover | Implemented. No 60-day worldwide extension imported. Broker confirmation required for any overseas itinerary. |
| B2C/B2B liability — proposed legal safeguards | CRA 2015 ss31/65, UCTA 1977, CMA37 | Remove blanket rental-price/any-loss cap; consumer foreseeable loss and mandatory carve-outs; business cap requires reasonable expressly agreed review | Implemented draft; enforceability not certified. Solicitor decides any B2B cap rather than code inventing one. |
| Cancellation/early start — proposed legal safeguards / implementation gap | CCR 2013 regs28–36; CMA37; actual cancellation credit/refund handlers | Statutory explanation first, fixed dates not automatic exemption, express early-start/full-performance requirements, original-method statutory refunds vs commercial credit | Draft implemented; commercial economics unchanged. Classification, separate early-start consent and real statutory-refund workflow remain blockers. Current commercial refund/credit tests do not prove statutory compliance. |
| Cancellation/late fees, inspection/disputes — proposed legal safeguards | CMA37; existing London cancellation/late logic and security settlement | Actual loss/rehire/avoided costs, prompt inspection, undisputed security release, notice and dispute process | Draft implemented; operator/solicitor must approve and connect real fair-fee/dispute handling. Existing London/DST/hold tests retained. |
| Trader/controller — required information, factual blocker | Q3 insured name; repository receipt-configuration doc supplied a trading name/address, not complete verified legal identity | Name as quoted, verified existing contact email; explicit missing registration/authorised public address fields | Blocked for verified actual trader/controller and public address authority. Insurer risk/residential address not published or assumed to be contracting address. |
| Privacy/biometrics — legal/factual blockers | Actual Didit/Stripe/app record paths; ICO privacy/biometric guidance | Accurate app-versus-provider data distinction, rights/ICO route, explicit review fields for bases/roles/retention/transfers/special-category processing | Scoped draft implemented. No invented Article9 consent, DPIA, deletion timing or manual non-biometric alternative. Provider contracts and current lawful processing assessment required. |
| FAQ/guide/bot/voice — consistency | Existing guides, botKnowledge, voice API and pricing labels | Remove insurance-purchase/verify-once claims; voice separates existing refundable payment/hold and says final basket quote controls | Implemented; browser checks FAQ/checkout. Voice uses the unchanged shared security calculations. |
| Owner programme / personally leased kit — disclosure/underwriting blocker | Q3 p10 declared owner/lease; September 30/October 2 £0 cross-hire context, future cover by value/period | Join/provider terms qualify automatic cover/guaranteed compensation; About no longer says all items DB-owned | Implemented copy. Owner programme economics remain; broker and operator must approve a real item-specific arrangement before third-party hires. The disclosed leased kit is not treated as an undisclosed cross-hire. |
| Drones — Q3 disclosure / unresolved operation | Q3 p10 equipment including drones, liability excluded on hire; October 2 broker reply | Property disclosure retained without aviation liability promise | Implemented. Outdoor/in-flight damage and aircraft-exclusion precedence need explicit confirmation. |
| Fraudulent hire — favourable Q3 note / unresolved precedence | Q3 p10; September 30 email; base p28 exclusions 7(s)/(t) | Favourable note retained, no blanket theft/forced-entry exclusions invented | Exact override/precedence remains broker blocker; not silently treated as confirmed or deleted. |
| Sum insured/excess/additions — schedule / operational gap | Q3 pp6–7/p10; base p29 average finding | £35k equipment/transit and quoted excess distinguished; no £45k/v2/hired-in £10k or per-hire £12k limit introduced | Draft implemented. £35k adequacy/average, replacement values, single-hire exposure and any additions allowance need evidence. No business interruption/breakdown promise. |
| Premises/testing/EL — operational checks | Base conditions and user verified findings | No webpage certifies EICR, labels/tests/records, locks or employers-liability exemption | Operator blocker: EICR under five years, competent appliance testing/labels and five-year records, premises/security/residential adaptations and EL exemption. |
| Inception/final policy — unresolved fact | September 28 terms-before-cover, October 2 can-place-today, October 4 still requests terms | Quotation described as quotation, not active cover or proven absence | Broker must confirm exact inception, final schedule/policy number and outstanding subjectivities. |

## Decisions required before release (no messages sent)

- **Broker:** confirm inception/final schedule/policy number/subjectivities; fraudulent-hire/false-pretence/deliberate non-return precedence; approve actual Didit evidence/source types/retained result and reuse/current-account rules; consolidate vehicle/overnight/courier/acknowledged custody restrictions and notification deadlines; confirm outdoor/drone in-flight/aircraft/territory treatment; establish sums/average/additions/single-hire exposure and third-party-owner underwriting by item value and hire period.
- **Solicitor/privacy reviewer:** approve fair consumer responsibility, repair/replacement and no-double-recovery/subrogation, B2B caps if desired, court/statutory carve-outs, cancellation classification/exception/early-start wording and refund flow, commercial credit/fair fee/dispute handling; verify trader/controller/public address/company details, provider roles, purpose-specific bases, biometric special-category condition, any required DPIA, lawful alternative if needed, retention and transfer safeguards. The current ICO guidance itself is marked under review following the Data (Use and Access) Act; do not assume historic wording resolves current obligations.
- **Operator:** establish actual item/serial/accessory/condition schedule and renter acknowledgement, two-source evidence and authorised review controls without unnecessary sensitive storage, agreed collection/return/carrier responsibility, documented acceptance of material changes, prompt incident/insurer notification and inspection/dispute handling, fair late/cancellation review and a separately scoped statutory refund/early-start implementation. Verify values, premises/EICR/testing/security/EL facts. Keep current launch/payment/late collection gates. Do not lift the hard release-review gate solely because unit tests pass.

Membership economics and its existing consumer-rights wording are retained. Its actual early-service consent, statutory refund and spent-credit treatment should be reviewed together with rental cancellation; no new deduction, automatic card charge, subscription benefit or price is introduced here.

## Primary legal review references

- [Consumer Rights Act 2015 s31](https://www.legislation.gov.uk/ukpga/2015/15/section/31) and [s65](https://www.legislation.gov.uk/ukpga/2015/15/section/65).
- [Unfair Contract Terms Act 1977](https://www.legislation.gov.uk/ukpga/1977/50).
- [Consumer Contracts Regulations 2013](https://www.legislation.gov.uk/uksi/2013/3134), particularly statutory cancellation, exceptions and services supplied during the cancellation period. No fixed-date camera-hire exemption is assumed.
- [CMA unfair contract terms guidance](https://www.gov.uk/government/publications/unfair-contract-terms-cma37), current landing page updated 22 July 2026.
- [ICO privacy information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/) and [biometric lawful processing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/biometric-data-guidance-biometric-recognition/how-do-we-process-biometric-data-lawfully/).

These support drafting/review points, not professional approval. Some legislation direct opens failed on XHTML content type; primary-domain search retrieved the statutory cancellation exception and CRA s31 references. No legal certification is claimed.

## Validation and changed-file manifest

Check receipts and changed-file manifest follow below. No deployed API/UI verification or live provider-write acceptance is claimed; production remains untouched.

### Changed files

- `convex/bookings.ts`
- `convex/checkout.ts`
- `convex/invoice.ts`
- `convex/schema.ts`
- `docs/INSURANCE_AGREEMENT_REVIEW.md`
- `package.json`
- `scripts/test-gaffer-fixes.cjs`
- `scripts/test-rental-agreements.cjs`
- `shared/legal-history/2026-10-v8.ts`
- `shared/legal-history/2026-10-v9.ts`
- `shared/legalDocuments.ts`
- `shared/rentalAgreement.ts`
- `src/app/about/page.tsx`
- `src/app/api/voice/route.ts`
- `src/app/checkout/page.tsx`
- `src/app/join/page.tsx`
- `src/app/legal/[slug]/page.tsx`
- `src/lib/botKnowledge.ts`
- `src/lib/collective.ts`
- `src/lib/guides.ts`
- `src/lib/invoice/InvoiceDocument.tsx`
- `src/lib/legal.ts`
- `src/lib/pricing.ts`

### Completed automated checks

- `npm test`: all **36** existing/new regression scripts passed in the final run; receipt `/tmp/dbc-insurance-tests-complete.log`. Includes Didit and 90-day reuse/expiry/revocation, hold/security bands and exemptions, cancellation/DST/refund/credit, extensions/additions, and new agreement handler/PDF/email tests. The first pre-update run failed because old checkout fixtures omitted the new attempt and delivery-assent fields; fixtures were updated to exercise the real new contract, without weakening assertions, then the full suite passed.
- `npx tsc --noEmit`: passed; receipt `/tmp/dbc-insurance-typecheck-final.log` (empty error log).
- `NEXT_PUBLIC_CONVEX_URL=https://veracious-wombat-196.convex.cloud npm run build`: passed for final source; receipt `/tmp/dbc-insurance-build-final.log`. This is a local production build, not a deployment.
- `git diff --check`: passed. No repository lint script or ESLint dependency is configured; no separate lint success is claimed.
- Actual agreement PDF generated by the regression suite, decoded with `pdftotext`, and visually inspected. It contains original signer/particulars, London times, pending serial schedule and full accepted terms. Fixture `/tmp/dbc-agreement-fixture.pdf`.
- Native browser checks at 1440×900 and 390×844 on the local built app: rental agreement, insurance, cancellation, privacy, FAQ, About, Join and checkout; archived v8 accessible, signer changes require new assent, no horizontal overflow or browser exceptions, no payment submission. Screenshots under `/root/artifacts/db-cinema/insurance-review/`. Uses read-only canonical catalog/quote data and local browser basket fixtures; no customer session or real booking/payment/email action. Final rerun receipt is appended below.
- `graphify update .`: passed; 2,861 nodes / 6,436 edges at first final-source update. Code-only extraction, no semantic provider spend. It reported changed community labels and automatically used hub names; no LLM relabel was run. `graphify-out/` remains Git-ignored and explicitly excluded by `.vercelignore`.

### Blocked and bounded validation

No live Convex schema/index deployment, serializable concurrent-mutation/provider interruption test, deployed account download/mail delivery test, legal review, insurer cover/inception verification, operational serial/condition/two-source evidence proof, statutory early-start/refund path acceptance or physical handover was performed. The fixture DB is not a real Convex transactional runtime. No claim of full insurance/legal compliance or launch readiness follows from these checks.

The original immutable snapshot remains intact during amendments, but existing extension/addition/owner-reschedule operations do not yet create a separately signed complete amendment instrument. Release stays blocked until an approved material-amendment acceptance process is connected. Existing stored prices, payment/approval rules and history are preserved.

The commercial cancellation handlers still implement the existing commercial refund/credit schedule. A separately approved statutory classification/refund/early-start path is required before launch; this source does not falsely label the commercial path as a tested statutory refund. No new refund/capture/debt collection capability was added.

The hard review gate is deliberately not a final operational evidence system. After source review, broker/legal/operational decisions and a real evidence/acknowledgement workflow, it needs a separately authorised implementation/release review. Do not remove it to make a demo handover succeed.

### Final receipts

The final 16 native desktop/mobile route checks passed, together with archived-v8 and signer-change acceptance checks, without browser exceptions or payment submission. Receipt: `/tmp/dbc-insurance-browser-final.log`. A first rerun attempt could not start because the owned earlier preview still held the port and its Chrome process had exited; the owned preview was stopped, a fresh owned browser was started and the final run passed. No assertions were changed for this recovery.

The last backend-only change scopes new insurance/liability email prose to bookings with the new immutable copy; old bookings receive their original receipt semantics and an explicit no-substitution message. The final new agreement suite passes that historical-email case as well as durable PDF/email, retry and release guards (`/tmp/dbc-agreement-regression-final.log`). Typecheck and local production build were rechecked after this change. The 36-script full suite passed before that final scoped legacy-email fix; it was not redundantly rerun after the focused suite passed.

Owned preview and browser processes were stopped after verification. No flags, live records, payment modes, provider credentials, membership economics or publication targets changed. Source remains uncommitted and launch/review gates remain in place.

## Publication validation — 5 October 2026

Operator-authorised publication retains the review and financial gates. Individual owner names and private quote reference are removed from current public copy and generated standalone PDFs; existing accepted v8 text remains unchanged. The public business contact email is retained. All nine standalone PDFs are rendered from the same legal-page data, without booking/customer particulars. The earlier receipt fixture PDF is not distributed. Final full regression suite, TypeScript, production build and explicit staging Convex deployment/typecheck pass. Production alias and page verification are recorded separately at deployment completion.
