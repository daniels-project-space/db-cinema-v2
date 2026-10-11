# Verification document recovery in the renter UI

Unusable reused documents previously showed “Saving verification documents”,
approved feature cards, and an identity-approved badge. Reuse had already required
complete copies, so this state could not truthfully represent a new capture.

The shared readiness helper now recognizes a confirmed rental whose reused
documents are unavailable while its recorded approval is still unexpired. The
renter page, shared progress bar, account cards and conversation labels show a
team-review state. Document cards no longer show passed checks, and the journey
does not mark these unusable documents complete. A primary “Message the team” link
opens `/account?rental=<this booking>#chat` for the existing rental. The page hides
the stale identity-approved widget and does not automatically open a new provider
session or change a stored human decision.

Legacy reused references are recognized using a safe boolean in account-card and
conversation projections, even when the newer source label is missing. Raw source
booking identifiers are not added to renter responses. Restored valid copies
clear the review state through the existing reactive readiness query.

A genuinely expired booking approval retains its existing restart-verification
flow. Returned/cancelled rentals retain closed upload behavior. First-time copies
still show their saving stage, with a corrected heading and explanation; they no
longer show “Verification approved” or the identity-approved widget before the
copies are ready. A scheduled card hold remains a separate handover requirement.

The normal registered reuse-readiness regression now tests shared labels and
document completion across renter progress, account cards and actual conversation
queries, including legacy references. Native UI QA uses the actual management
shell, VerificationProgress, IdVerify, readiness helpers and booking query at
1440/390 with isolated account/DB transport adapters. It checks review/restoration,
legacy references, no false passed/approved state, exact rental chat URL, initial
copy saving, expiry restart, closed uploads, foreign access and no overflow. All
provider actions are forbidden by the local server and the observed count is zero.
The chat check verifies the destination URL, not a newly sent message or a live
conversation acceptance. No cloud accounts, documents, payments or emails are
created by these tests.

This preserves the existing dark management layout; it does not qualify all six
reference screens as pixel-matched. Production checkout remains closed and the
full rental goal remains incomplete.
