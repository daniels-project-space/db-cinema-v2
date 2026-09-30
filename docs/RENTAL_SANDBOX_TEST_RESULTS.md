# Rental sandbox acceptance evidence — 30 September 2026

These tests used isolated Convex staging `deafening-stoat-340`, the separate Didit sandbox application, and the existing Stripe test account. No live card was charged. Test mail went to the supplier's own Gmail alias. The Next.js receipt route ran from the worktree through a temporary tunnel; this does not prove that the protected Vercel Preview or production alias serves that route correctly.

## Provider and booking checks

| Case | Observed result |
| --- | --- |
| Verification protection checkout, booking `jn72edqtpxqskzby98vdqb4kx58fcf9n` | Hosted Stripe test checkout charged £120 rental + £100 refundable security. Its signed webhook confirmed the booking and created the separate £200 hold, from the same card entered once. |
| Deposit protection checkout, booking `jn7cyt91ac2pz4hdj8kq9s1c3x8fcs3y` | Hosted Stripe checkout charged £120 rental + £4,250 refundable security; separate £8,500 hold was recorded. Stripe settlement currency/amount remained GBP even when adaptive pricing offered EUR presentment. |
| Didit access and reuse | Paid owner obtained a session; another request reused its URL; an invalid owner token was rejected. |
| Status-only simulator approval | Didit's real signed sandbox callback changed the booking to manual review, because the simulator supplied no individual check results. It did not falsely verify an incomplete ID/selfie/address case. |
| Hosted sample document | The rental-linked Didit flow accepted the built-in Argentina sample passport. Its decision report contained an Approved OCR result with node `ocr`; the incomplete session stayed in progress. |
| Declined document | The provider's sandbox expired-document scenario sent a signed Declined result; the booking became rejected. |
| Admin review | The authenticated action recorded an explicit sandbox override and updated rental/account verification. This tested a deliberate human override, not automatic approval of all required checks. |
| Customer progress | Browser inspection showed today's confirmed rental in Upcoming, the automatic-check message and held amount, the completed rental in History, and the receipt/return-statement links. Processing/manual-review/decline labels were corrected after this inspection. |
| Handover gate | Attempting to mark an unverified paid rental active was rejected. |

## Return and payment checks

- Safe return refunded £100 and cancelled the £200 hold. Repeating the identical saved decision left exactly one Stripe refund. Changing its timestamp was rejected by the immutable return-decision guard.
- Documented damage return sent its itemised notice, captured £50 from the £8,500 hold and refunded the full £4,250 paid security. Repeating the decision produced no second refund.
- Late-only booking `jn7f510j7cd1v68pq8w0raj8698fcx3m` assessed £120 separately, refunded £100 once, retained the unused £200 hold and sent the separate late notice.
- With automatic collection enabled only on staging for the test, invoking the real collection action immediately after the notice created no late PaymentIntent, captured £0 from the hold and charged £0 on the saved card. The seven-day notice gate held. Automatic collection was then disabled again; the synthetic fee was paused and its hold release scheduled.
- All three return statements reached the booking email status `sent`. The actual authenticated PDF route returned a PDF, whose extracted text contained the correct supplier address, charge/refund breakdown and non-VAT wording. The email transport accepted the messages; its send-only credential could not inspect delivery events (HTTP 403), so inbox delivery is not proven.


## Hosted selfie and address follow-up

Rental `jn7e21abkgvyvyp6bhdn46707s8fc68q`, Didit sandbox session `b4e7d170-e60d-4795-a5ce-d97d00175bf2`, completed the actual hosted workflow using Didit’s built-in Argentina passport, a virtual camera containing its fictional portrait, and the built-in utility bill. This used real hosted capture/upload endpoints and signed callbacks, not the status-only simulator.

- The decision report recorded **Approved OCR, passive liveness, face match and proof of address**. The provider remained in `sandbox`; this validates integration, not live biometric/fraud detection accuracy.
- The sample bill returns `123 Sandbox Lane, Sandbox City`, postcode `00000`, even when the booked UK address is supplied. The real rental correctly became `manual_review`, and attempted handover was rejected. No address safeguard was weakened to make a sample pass.
- The real authenticated review action requested address-only resubmission. The same hosted URL then presented only **Proof of address**; Approved ID, liveness and face results remained intact. Uploading the bill again completed PoA and sent another genuine callback. Its deliberately mismatching address remained blocked.
- After testing, the synthetic booking was cancelled through the real admin action: £220 was refunded exactly once and its separate £200 hold was released. Staging checkout was disabled again.
- Session creation previously omitted the signed renter name and booked address. The action now sends them as Didit `expected_details`, with `poa_country=GBR` for a UK address and no restriction on the ID’s issuing country. The actual new provider session confirmed those values. A focused regression checks this boundary. The callback returns to the configured account URL.

## Automated checks

`npm test`, `npx tsc --noEmit` and `npm run build` passed. The regression suite covers authoritative pricing/consent totals, webhook binding and address gates, manual decisions and resubmission, missed-webhook recovery, London cancellation/DST/refunds/credits, delayed Stripe payment reconciliation, and owner-only late-charge authentication/reconciliation/expiry.

## Remaining acceptance work

Hosted selfie, address completion and address-only resubmission are now proven in sandbox. Automatic rental approval with a genuinely matching address still needs a live acceptance check: Didit’s built-in PoA sample has a fixed fictional postcode, which correctly fails the application’s UK address gate. Matching-address automatic approval has regression coverage, rather than a completed live customer check. Issuer challenges, renewal, late collection after the dispute period, the full damage-plus-late case, and 30-day provider collection have regression/harness coverage but were not completed through hosted provider UI in this run. These results do not establish production readiness. Live checkout and automatic collection remain disabled; legal review and the dedicated production/provider rollout are still required.
