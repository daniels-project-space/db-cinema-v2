# Deposit settlement gate for review emails

Review requests no longer run from the scheduled end-date reminder. `settled-rental-review-emails` checks the oldest unchecked returned bookings every 12 hours, in batches of 50. It sends email only; the old automatic account-chat review request is removed.

A booking must be actually returned. Any retained paid deposit, damage captured from its hold, saved damage decision or late fee taken from the hold suppresses the review request. A recorded partial deposit refund suppresses it too. Pending refunds and unresolved late settlement remain waiting.

The worker reads Stripe refunds for the booking's payment intent. It requires at least the full paid deposit in successful GBP refunds and no incomplete or failed refund. All linked current, renewal and previous security holds must be canceled with nothing captured. Missing provider evidence or an outage remains waiting; marking a booking's deposit released alone is insufficient.

The first confirmed full settlement saves a due date at least 24 hours later. Every send rechecks provider evidence and transactionally compares the booking fingerprint. This catches refunds completed after the old single-day reminder window. A persisted send claim prevents concurrent requests; `remindedReview` is set only when the email transport reports success. A reported mail failure is retried on a subsequent check. A crashed action in `sending` stays held for investigation rather than automatically risking a duplicate email.

Persisted fields: `reviewFollowUpStatus`, `reviewFollowUpReason`, `reviewFollowUpCheckedAt`, `reviewRefundConfirmedAt`, `reviewFollowUpDueAt`, `reviewFollowUpSentAt`.

`reviewFollowUp:processDue {"dryRun":true}` reads eligibility without sending or changing booking state. The regression suite exercises actual action/mutation handlers, retained/partial/pending/failed refunds, unreleased holds, provider outages, stale/concurrent claims, late completed refunds, email failure and dry-run behavior. No real customer review email is needed for acceptance tests.
