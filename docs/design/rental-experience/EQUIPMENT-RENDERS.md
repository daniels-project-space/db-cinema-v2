# Equipment hero image lane

Live Render Engine workspace created and independently read back on 7 October 2026:

- Project: `db-cinema-rentals`
- State: `ready`
- Dedicated R2 bucket: `re-db-cinema-rentals-1f518ftgxs`
- Live model storage API: ERNIE Base `executorReady=true`, `acceptsRequests=true`; Jarvis qualified with current capacity. Hyper's Base route is not qualified, so the documented provider order currently reaches Jarvis. Capacity/readiness can change and must be read again before dispatch.
- Real project workflow: `equipment-hero-base`, ID `jn727e21bczgbhymp0xkdhb3398fvtf3`.
- Contract: 1264×848 landscape, 50 steps, CFG 4, BF16, native ERNIE prompt enhancer, pinned model and worker hashes. This preserves Base quality rather than switching to Turbo.
- Sanitised workflow receipt: `ernie-workspace-receipt.json`. No credentials stored in source. API authentication was injected into one trusted process from the central vault.

The request is an actual stored workflow, not a completed image render. No image batch/GPU generation was started. Next: enrich the 108 master inventory records using actual descriptions/photos; prepare candidates and immutable source identities; inspect staging/release and price contracts; submit batches with stable idempotency keys; verify the output PNG bytes/hash and project-owned R2 receipt; inspect real equipment accuracy, framing and lighting; wire accepted images into management tiles.

Keep final images in the project's R2 bucket. Local screenshots/reference material are review evidence, not a substitute for an owned output receipt. Public landing/gear/checkout design stays outside the management redesign.
