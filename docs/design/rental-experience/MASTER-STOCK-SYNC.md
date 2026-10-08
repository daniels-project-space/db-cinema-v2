# Exact master stock quantities

Catalogue synchronization previously retained the larger of the current and historical stock count, then increased that count to meet listing component demand. This could advertise two owned bodies after Rental Manager reduced the count to one, or fabricate a third body for a three-camera listing.

The sync action now derives quantities exclusively from an explicit active, non-marketing master inventory record with a valid whole count. Missing records, missing eligibility/quantity, inactive or marketing records supply zero units. No source identity defaults to one. The application mutation assigns the exact count, including decreases and zero; multiple offerings retain one shared pool. It validates the complete batch and rejects inconsistent quantities for a shared source before writes. A versioned fingerprint forces older inflated snapshots to be reapplied once.

Stock reductions leave actual reservations, accepted images and owner marketing choices intact. Zero stock does not hide the catalogue card: selection remains available for demand logging, while full cart and checkout checks reject unavailable equipment. Source replenishment restores the actual count minus occupied units.

The old fixUnitQty maintenance mutation is owner-protected and reports shortages without modifying any equipment quantity. Listing demand cannot create evidence of owned stock, even with admin authorization.

The paired manager export now includes status and is_marketing_only alongside its existing identities/names/aliases/counts. Its real owner boundary remains enforced when enabled. Publish that compatible manager export before the website sync: older exports without eligibility deliberately supply zero, and the current anonymous read bridge cannot operate after owner enforcement. A credentialed inventory bridge and complete canonical kit/component mapping remain required before live acceptance. No stock migration or production backend publication has been executed for this checkpoint.

Actual handler tests cover decreases, zero, replenishment, shared pools, oversize kits, existing rental occupancy, owner tags/photos, batch conflicts, malformed quantities, versioned snapshots, missing/inactive/marketing/old source data and owner-protected maintenance. Manager handler tests verify exact eligibility projection and authenticated boundary. These are controlled source/database fixtures, not a real source-to-cart acceptance test.

The original requirement for fresh current/upcoming/overdue source stock and a single atomic claim shared with Hygglo writers remains open. Correcting the mirrored capacity does not establish distributed reservation safety.

The previous actual sync handler was run separately against a synthetic database: a source count of two became three for a three-body kit and stayed three after the master count dropped to one. The corrected handler regressions enforce the opposite invariant. Full website default tests/typecheck/build pass; manager default checks pass 138 files / 2131 tests with 14 skips, alongside typecheck, Next build and both owner-boundary audits. Hosted checks and live rollout remain pending.
