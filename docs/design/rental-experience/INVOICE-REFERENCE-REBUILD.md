# Invoice reference rebuild — 8 October 2026

The admin invoice screen places its directory, filters and pagination beside the selected record. The detail pane scrolls independently on desktop; phone/tablet layouts stack. Directory rows no longer stretch to the detail panel height.

Real issue-date filters operate on loaded records; the footer preserves that scope and protected pagination exposes older records. Customer metadata, equipment, quantities, periods, prices, credit, confirmed refunds, security and settlement values come from the protected query. Catalogue image alternatives are fetched after authorisation and rendered when present. The recorded return statement number takes precedence.

Open PDF uses the existing bearer-authenticated request, private blob preview and download flow. Phone selection scrolls to details again after authorised loading; closing details restores row focus. This fixes the loading-height race found during review.

Invoice access uses the shared blocked/unverified-account guard while requiring finite session expiry. Other callers retain the previous guard default. Permanent rental ownership and legacy booking email matching remain supported.

## Evidence

Five iterations were captured and inspected at `/root/dbc-invoice-reference-review/pass-{1..5}-{desktop,mobile-list,mobile-detail}.png`, compared with `dark-invoices.png`. Pass 1 exposed stretched rows; pass 2 checks populated records after restructuring; pass 3 refines geometry/navigation; pass 4 improves mobile cards/PDF access; pass 5 refines the selected row and pane position.

Final native browser checks use actual components, the protected query and real PDF GET/renderer with synthetic accounts/bookings. They verify date filtering, PDF bytes/download, preview closure, HTTP 403 for unauthorized access, desktop columns, phone scrolling, restored focus and no horizontal overflow. No live account, email, finance, provider or deployment writes were performed.

Default tests, expanded invoice ownership checks, TypeScript and final Next build passed. Ownership checks cover foreign/expired/missing-expiry sessions, blocked/unverified accounts, permanent/legacy ownership, admin access, image alternatives and exclusion of payment/identity identifiers. Ownership tests are now in the default suite. The local code graph was updated.

Fresh built `/`, `/gear`, `/checkout`, `/account` and `/admin` returned HTTP 200. Public landing/gear/checkout HTML contains no management shell or admin manifest.

## Open acceptance

Full pixel-perfect and production acceptance remain open. Synthetic records lack real equipment photos; the sidebar image is not an approved owned-equipment ERNIE image. The list displays rental status/document types without inferring Paid/Refunded from rental status. Manual invoice email and unspecified menu controls were not added as fake buttons. Remaining management screens, physical-phone notifications, deployment bindings, paired stock/lifecycle acceptance and equipment renders remain required.

## Current-source refinement, 10 October

A second review uses actual `AdminInvoiceLibrary`, `InvoiceLibrary`, `ManagementShell` and protected page/detail handlers with isolated records and the real vendored site fonts. Captures are at `/root/CODEX_ARTIFACTS/db-cinema/invoices-reference-2026-10-10/pass-{0..6}-{1488,390}-{list,detail}.png`. Desktop passes 0–6 and final phone list/detail states were visually inspected against `dark-invoices.png`. These are local synthetic records, not production acceptance.

The review uncovered a genuine thumbnail layout bug: SmartImage's wrapper matched the generic flexing text rule, stretching a nominal48px equipment image across the detail row. A more specific fixed flex basis now keeps the wrapper at48px, and the image itself uses contain. This correction also applies to the renter's document detail. Admin-only refinements darken list panels, align column boundaries and the list top near y226, reserve66px rows, increase readable status/header typography, align the document heading and separators, and apply the approved wordmark alignment to invoices as well as customers. IDs remain the actual DBC document identifiers with a full title; pass5 exposed taller rows when wrapping, so pass6 uses compact untruncated IDs and restores row geometry.

Actual component interactions pass at1488/390: loaded-record search, full invoice identifiers without clipping, fixed thumbnails, selection, close/focus restoration, bearer-authenticated no-store PDF requests, rejected non-PDF responses and no horizontal page overflow/runtime errors. This fixture deliberately does not claim a successful real PDF GET: its non-PDF response tests the error guard. Existing protected invoice ownership/history suites pass against actual handlers, including143-record paging and privacy/admin access. No email, document upload, financial or production customer writes occur.

Reference differences remain open: typography/photo and header-search parity, bank-backed payment labels/filters, richer equipment/settlement presentation, invoice correspondence/history controls and authenticated production acceptance. The current rental-status badges are deliberately retained until financial evidence supports payment labels; no paid/refunded values or inert email/menu buttons were fabricated. Other management references and the full original goal remain incomplete. Public checkout gates stay closed.
