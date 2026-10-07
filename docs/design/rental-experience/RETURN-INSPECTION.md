# Individual return inspection and damage cases

The admin rental conversation opens a dark right-hand inspection drawer. Each actual reserved inventory instance has Good condition/Issues found controls; issues require evidence text, and opening a damage case is independent of the amount retained. Mark all good is available. Every item must have an explicit condition before the new UI submits a return. Legacy rentals without an inventory ledger show their booked listing quantities with a clear legacy label; no serial numbers or equipment photos are invented.

The schedule comes from the rental's persisted reservations, ignoring cancelled lines. Peak quantity prevents non-overlapping extension intervals from duplicating the same physical units. The server owns equipment identity and validates complete inspection coverage, duplicate keys, evidence requirements and the relationship between deductions and inspected issues. The saved return decision freezes the equipment identity and inspection; retries reject changed decisions and cannot duplicate cases.

Cases are stored against the rental and associated account. Admin conversation controls show the saved inspection and open/closed cases. Closing a case needs an audited resolution. It does not revise a completed financial settlement. Open cases automatically preserve archived verification files, including documents reused from earlier rentals; closing the last relevant case resumes the existing 30-day retention rule.

Settlement keeps the existing Stripe hold/refund execution and idempotency controls. The drawer shows paid security and authorisation separately, plus an estimated paid-deposit refund. Issued return PDFs and customer emails include the frozen inspection, issue details, case-open decision, retained amount and deduction evidence. Email text is escaped. An issue can have a zero deduction while a case is investigated.

Verified on 7 October 2026:

- `test-return-inspection.cjs`: physical quantities, cancelled lines, extensions, complete coverage, invalid evidence, deductions with all-good items, zero-deduction issues, frozen identity, retry ordering, duplicate-case prevention, account linking, admin-only case resolution and actual-case retention. It also checks the email worker with isolated mail/PDF fixtures and renders the actual expanded return PDF.
- Archive, late-fee authentication and rental-agreement regressions passed. Production build and TypeScript passed.
- Native Chromium inspected the actual drawer with isolated five-item data/action fixtures: submission blocked until complete, Mark all good works, an issue requires details, one zero-deduction case is included in the payload, desktop/mobile layouts fit. No payment or customer email was executed in this visual test.
- Development schedule API checked against an existing rental with admin access and unauthorized denial.

Remaining: production acceptance; wire this schedule/inspection/case data into the Rental Manager return UI and notifications; enforce inspection for new returns across both callers once that migration is complete. The backend currently keeps optional inspection for existing integration callers and legacy financial retries. Equipment hero images and the complete reference-screen composition remain separate outstanding goal items.
