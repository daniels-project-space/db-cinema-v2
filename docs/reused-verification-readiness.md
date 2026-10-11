# Reused verification must remain account-bound

Verification reuse originally validated its source when reuse was applied. Later
archive-readiness checks could accept a deleted source as a direct manual
verification, or accept an original archive belonging to a different rental owner.
This allowed readiness projections to disagree with the account-bound verification
requirement after records changed.

The shared `assertVerificationArchive` guard now rechecks a reused source before
allowing the existing direct manual/legacy exemption. Reused verification requires
an existing source with an approved Didit decision and session, the same resolved
permanent account, and an unexpired original approval/document lifetime. Actual
saved copies must still satisfy the existing archive, storage, retention and
ownership checks. The original source retains its approval age; reuse cannot
renew it. A direct manual verification keeps its existing behavior.

Account cards cache original document availability separately from reuse
eligibility. Retained originals can stay available for insurance after the source
approval expires without approving a later rental. Conversely, failed reuse must
not hide the original retained copies. The bounded account-page cache continues
to share results for repeated direct or reused references within that account.

The guard is already used by renter progress, account cards, admin operations,
conversations, dashboard previews, manager projections and transactional handover.
No provider request, human decision rewrite or document deletion is added. The
existing admin reverification control remains the recovery path for a source that
can no longer be used; valid copies restored to their proper binding become ready
on the next query. This change does not complete the separate renter recovery UI
or the broader management reference overhaul.

The registered actual-handler regression
`scripts/test-verification-reuse-readiness.cjs` first failed on deleted-source
acceptance, then passed with the guard. It checks deleted/reassigned/revoked/manual
or sessionless sources, original expiry, missing actual identity bytes, recycled
legacy mailboxes, permanent owner deletion, foreign session/wrong bearer denial,
exact paid bearer readiness, valid recovery and the direct manual exemption.
Failure is checked across archive readiness, renter progress, account cards,
dashboard images, manager document approval and handover. Cache tests cover both
source-first and reuse-first ordering. Tests use isolated local storage metadata
and no external provider, customer, payment or email writes.

Public rental and membership checkout remain closed. This is a draft/staging
security and readiness fix, not a production or whole-goal completion claim.
