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

## Reviewed equipment brief

Live inventory/specification queries on 7 October returned 108 master rows, with 82 identified as owned/active by the existing ownership predicate. The other 26 are excluded from owned-equipment candidates. Sixteen owned items have existing reviewed master descriptions. `equipment-fact-review.json` adds 17 source-linked manufacturer model descriptions, matched by exact inventory ID and canonical name. These local reviews do not change Rental Manager's verification fields or claim to confirm actual rental-set contents. Forty-nine owned entries still need factual review. Unknown ownership stays explicit.

`master-inventory.json` carries actual descriptions, distinct master/local provenance, ownership, composition blockers and SHA-256 evidence identities. Only reviewed prose enters factual prompts. `ernie-reviewed-candidates.json` is a 33-entry draft catalog, not a submission request. Four entries remain blocked on exact kit/region configuration: DJI Mic 2, RØDE Wireless PRO, Anker F2000 and Tilta Nucleus Nano II. `ernie-prepared-batches.json` divides the other 29 into deterministic 16/13 candidate drafts respecting the live API batch limit. Internal provenance is excluded from strict API candidate fields. Both files explicitly remain unsubmitted, not dispatch-ready, and have no completed output receipt. No cost ceiling is invented; fresh price and stage/release semantics still need review before execution.

`node scripts/enrich-equipment-render-brief.cjs` reproduces read-only enrichment from deployed Rental Manager queries plus these reviewed local facts. `node scripts/prepare-equipment-render-batches.cjs` regenerates the catalog/batches offline; `--check` checks exact reproducibility. Neither submits jobs or changes inventory. Public app runtime/deployment still excludes these design documents.

## Cached reference-photo audit

The actual live item records contained cached photos for 48 of 82 owned entries, using 29 distinct URLs. Twenty-eight images downloaded and were visually inspected; one download failed. `equipment-reference-review.json` records source URLs, SHA-256 digests, byte counts, dimensions and individual bindings. These are listing illustrations/composites, not authenticated photographs of owned units; **none is accepted as an exact render reference**. Accepted equipment appearance and actual output inspection remain separate gates.

Twelve demonstrable mismatches are recorded: PL-to-EF adapter, PL-to-Sony-E adapter, Cinebloom mist filter, ND filter, Smoke Ninja, RØDE Wireless PRO set, motorised slider, Nanlite 500B, 85cm softbox, Sony GM 70–200, LED RGB panels and Sony GM 16–35. Some other photos show multi-item kits or unresolved model variants. Audit status does not silently rewrite production photos. Replace bindings only with accepted, project-owned assets, preserving factual kit accuracy.

`equipment-lane-readiness.json` records the fresh read-only provider state. Readiness is transient and is not proof of a completed image or an authorization to release a paid job.
