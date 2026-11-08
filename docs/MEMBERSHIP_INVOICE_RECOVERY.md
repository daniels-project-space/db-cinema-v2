# Membership invoice recovery (staged)

`MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1` remains disabled until the historical price snapshots, refund reconciliation, and provider failure cases are qualified. The new path must not be enabled solely on the strength of fixture tests.

For a combined rental and subscription checkout, a transient membership-provider failure schedules bounded checkout retries and, if exhausted, an owner alert. Rental confirmation still performs its existing payment, verification, and live-inventory checks. A booking with no first-month membership credit can proceed independently of the subscription-provider failure.

**Known limitation:** A booking funded with first-month membership credit still requires the matching issued invoice-credit receipt before confirmation. An ambiguous invoice or provider failure can therefore leave that paid rental pending. Do not remove this gate until cancellation, refunds, credit restoration and later invoice reconciliation are designed and tested together; otherwise the same credit could be issued twice or restored without backing. Reviews and their manual retry must remain available, and pending checkout reconciliation must be monitored.

Synthetic webhook tests cover the real confirmation mutation for an unfunded booking and for a first-month-credit booking before and after a matching receipt is supplied. The database, stock source and Stripe are fixtures; this does not establish real provider delivery, financial settlement, or production recovery. Before rollout, exercise both checkout paths against isolated services, including cancellation during review and delayed or duplicate invoices, and verify the owner alert and retry scheduling end to end.
