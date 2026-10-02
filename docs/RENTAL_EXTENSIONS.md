# Owner-approved rental extensions

Renter → rental conversation → Request extension → choose 1–30 extra days and affected items → review the live server quote → Send extension request.

Owner → same rental conversation → Review request → record a decision reason → approve and send a secure payment link, or decline. Approval rechecks the saved kit, current rates, the whole order's shared inventory and external/day blocks. An unchanged request alone creates no reservation, payment or date amendment. Only the owner approval action can reserve extra dates and create checkout.

Approved extra dates are soft-held for up to 24 hours. Existing return dates remain binding until Stripe confirms payment and the final whole-order inventory check succeeds. Existing return time, security and cancellation-policy start remain unchanged. Extra rental charges use quoted daily catalog rates × quantities × added days, without stacked promotions. A changed rate or kit needs a fresh customer-reviewed request.

Payment fulfillment runs through the signature-verified existing checkout webhook, the checkout success callback and a five-minute recovery worker. All paths retrieve and attest the saved session, GBP amount, intent, currency and successful payment; the persistent applied state prevents double extension. No automatic saved-card debit. Processing or uncertain provider responses keep the operation locked. If an extension cannot be applied, its payment is refunded and the original dates remain. The lock is released only after a provider-confirmed refund.

Approved unpaid proposals can be withdrawn from the owner panel. The actual Stripe session must first be expired or otherwise resolved. Paid extensions use the existing rental refund/cancellation policy and controls. Handover, return, refund, kit change and cancellation controls cannot race an approved extension.

Additional charges are persisted separately in the booking's billing lines and captured payment-source ledger. Original item charges are preserved; return statements, receipts and refund allocations include extension charges with no additional security allocation. The Gaffer context distinguishes proposed dates from current recorded dates.

Financial launch gates are unchanged: test Stripe credentials support sandbox acceptance; live checkout requires the existing RENTAL_CHECKOUT_ENABLED gate. No customer action or auto-collection launch is enabled by deploying this feature.

Verification: scripts/test-rental-extensions.cjs exercises actual handlers, not a parallel implementation: ownership, expired/blocked access, manual approval, validation, exact quote/snapshot, concurrent inventory, catalogue remapping protection, quantity, duplicate listing windows, retry/dedup, payment proof, invoice/refund ledger, operation locks, decline, withdrawal, expired paid refund and live launch gates. Native staging acceptance passed a £25 quoted request, manual owner approval, actual Stripe hosted sandbox card checkout, unchanged dates before payment, updated reservations after payment, actual invoice lines and a signed webhook retry without duplicate extension. Desktop/mobile screenshots were inspected. Isolated fixture records were removed, test payments refunded, temporary QA helpers removed and staging messaging/sync configuration restored.
