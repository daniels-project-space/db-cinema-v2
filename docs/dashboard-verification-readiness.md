# Dashboard verification readiness

The admin dashboard used stored identity and drone approval labels to select its
verification queue. This could hide a confirmed rental whose approval had expired,
whose linked account had disappeared, or whose approved document copy was missing.

`analytics.adminSummary` now projects current verification readiness independently
of the stored human decision. It resolves the permanent account, applies the same
90-day/document-expiry boundary as handover, checks the private Didit archive and
actual storage metadata, and checks the approved drone document when the current
kit contains an aircraft. Valid legacy/manual verification keeps its existing
archive exemption. The shared preview predicate selects the same pending records
on the server and client, so newly pending cards receive their equipment images.

Admin cards show an amber reason: verification expired, saved documents need
attention, account needs review, or drone licence needs review. Changes to accounts,
archives, documents and storage metadata are reactive dependencies. The dashboard's
existing one-minute clock refresh also checks approval expiry without a write.
These checks do not mutate decisions, fetch provider reports, expose document
identifiers/URLs/hashes, or authorize handover. Agreements, payments, security holds
and the remaining release checks still apply independently.

The archive/drone helpers use their existing indexed booking/archive lookups.
This does not make the entire dashboard query bounded: its existing operational
status and seven-day event ranges remain. No production cost saving is claimed.

Validation includes the actual-handler regression
`scripts/test-dashboard-verification-readiness.cjs`, registered in `npm test`:
exact expiry, document expiry, implicit legacy expiry, missing address storage,
pending archive, deleted owner, approved drone without bytes, foreign-owner drone
copy, actual copy restoration, camera classification, private output, and preview
images. The existing preview regression now supplies a real local account-bound
licence copy instead of treating a status-only patch as approval.

Native desktop/phone QA uses the actual dashboard, shell and analytics handlers
with isolated local fixtures. It verifies the expired card, live renewal/removal,
the next preview's image, permanent contact changes, missing account, record-bound
navigation, denied access and no horizontal overflow. QA profile artwork is a
local SVG; this is not a live upload or a final individual equipment hero render.

The change is qualified locally and on isolated staging. Production checkout and
membership gates stay closed. The full management reference overhaul and the
broader rental goal remain unfinished; this document is not a completion claim.
