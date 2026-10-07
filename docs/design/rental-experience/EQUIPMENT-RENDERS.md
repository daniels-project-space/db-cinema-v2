# Equipment hero image lane

Live Render Engine workspace created and independently read back on 7 October 2026:

- Project: `db-cinema-rentals`
- State: `ready`
- Dedicated R2 bucket: `re-db-cinema-rentals-1f518ftgxs`
- Live model storage API: ERNIE Base `executorReady=true`, `acceptsRequests=true`; Jarvis qualified with current capacity. Hyper's Base route is not qualified, so the documented provider order currently reaches Jarvis. Capacity/readiness can change and must be read again before dispatch.
- Real project workflow: `equipment-hero-base`, ID `jn727e21bczgbhymp0xkdhb3398fvtf3`.
- Contract: 1264×848 landscape, 50 steps, CFG 4, BF16, native ERNIE prompt enhancer, pinned model and worker hashes. This preserves Base quality rather than switching to Turbo.
- Sanitised workflow receipt: `ernie-workspace-receipt.json`. No credentials stored in source. API authentication was injected into one trusted process from the central vault.

The workflow is stored and the first one-item pilot has completed and passed storage checks, but failed equipment appearance review; no image is accepted yet. Continue enriching the 108 master records, follow the pilot to verified R2 output, inspect equipment accuracy/framing/lighting, then submit the remaining batches with stable idempotency keys and wire accepted images into management tiles.

Keep final images in the project's R2 bucket. Local screenshots/reference material are review evidence, not a substitute for an owned output receipt. Public landing/gear/checkout design stays outside the management redesign.

## Reviewed equipment brief

Live inventory/specification queries on 7 October returned 108 master rows, with 82 identified as owned/active by the existing ownership predicate. The other 26 are excluded from owned-equipment candidates. Sixteen owned items have existing reviewed master descriptions. `equipment-fact-review.json` adds 17 source-linked manufacturer model descriptions, matched by exact inventory ID and canonical name. These local reviews do not change Rental Manager's verification fields or claim to confirm actual rental-set contents. Forty-nine owned entries still need factual review. Unknown ownership stays explicit.

`master-inventory.json` carries actual descriptions, distinct master/local provenance, ownership, composition blockers and SHA-256 evidence identities. Only reviewed prose enters factual prompts. `ernie-reviewed-candidates.json` is a 33-entry draft catalog, not a submission request. Four entries remain blocked on exact kit/region configuration: DJI Mic 2, RØDE Wireless PRO, Anker F2000 and Tilta Nucleus Nano II. `ernie-prepared-batches.json` divides the other 29 into deterministic 16/13 candidate drafts respecting the live API batch limit. Internal provenance is excluded from strict API candidate fields. Both files explicitly remain unsubmitted, not dispatch-ready, and have no completed output receipt. These full batches have no cost ceiling selected and are not submitted. The separately recorded one-item pilot below has an explicit per-attempt threshold.

`node scripts/enrich-equipment-render-brief.cjs` reproduces read-only enrichment from deployed Rental Manager queries plus these reviewed local facts. `node scripts/prepare-equipment-render-batches.cjs` regenerates the catalog/batches offline; `--check` checks exact reproducibility. Neither submits jobs or changes inventory. Public app runtime/deployment still excludes these design documents.

## Cached reference-photo audit

The actual live item records contained cached photos for 48 of 82 owned entries, using 29 distinct URLs. Twenty-eight images downloaded and were visually inspected; one download failed. `equipment-reference-review.json` records source URLs, SHA-256 digests, byte counts, dimensions and individual bindings. These are listing illustrations/composites, not authenticated photographs of owned units; **none is accepted as an exact render reference**. Accepted equipment appearance and actual output inspection remain separate gates.

Twelve demonstrable mismatches are recorded: PL-to-EF adapter, PL-to-Sony-E adapter, Cinebloom mist filter, ND filter, Smoke Ninja, RØDE Wireless PRO set, motorised slider, Nanlite 500B, 85cm softbox, Sony GM 70–200, LED RGB panels and Sony GM 16–35. Some other photos show multi-item kits or unresolved model variants. Audit status does not silently rewrite production photos. Replace bindings only with accepted, project-owned assets, preserving factual kit accuracy.

`equipment-lane-readiness.json` records the fresh read-only provider state. Readiness is transient and is not proof of a completed image or an authorization to release a paid job.

## First paid pilot — 7 October 2026

- Submitted the reviewed DJI Mini 4 Pro aircraft-only candidate, canonical inventory ID `kn79mc5rgqhsr64hbn58z737hs86b5ks`. Arms unfolded; no controller or unconfirmed kit accessories. The original Base 1264×848 / 50-step / CFG 4 / BF16 / native enhancer contract is unchanged.
- Validated the exact request with the actual engine parser from remote main revision `2e9fbb485bcbb776b7b4c24b4eb93ce8c7cc4f09`, including canonical image-contract digest. Live integration revalidated the owned output bucket/prefix before submission. The server accepted the existing workflow and returned job `jd78hms12daqs0e34hq67ffj1h8fv0g9`; GET job/readiness subsequently confirmed `running`.
- Exact non-secret request and submission evidence: `ernie-pilot-request.json`, `ernie-pilot-receipt.json`. This job is now terminal: completed, with the GPU terminated. Its independent PNG checks passed. The output is rejected for model accuracy; a deliberately revised prompt is required before a new job. Do not resubmit the old request expecting a new render.
- Engine submission is an execution boundary: `stageProjectErnieBatch` queues a qualified job automatically, including repeat submissions of waiting jobs. The HTTP comment suggesting it never starts a GPU does not describe the current mutation. Do not use POST as a dry run.
- `maxCostUsd=1` is a per-attempt watchdog threshold. The inspected engine allows five normal consumer attempts and checks elapsed GPU spend per attempt. That is not an aggregate $1 guarantee or a precise price quote; controller/provider billing overshoot is possible. Review attempts before any larger batch.
- The advertised workflow-specification GET returned 404; current source does not map that operation. This did not establish a missing workflow: the subsequent real submission accepted it. No workflow was duplicated.
- Terminal acceptance evidence: completed, attempt terminated, 207 GPU seconds, engine-recorded GPU cost $0.0165018861. Independently streamed and SHA-256-checked 1,286,349 PNG bytes at 1264×848 in the owned bucket; native receipt was revalidated by the server and its digest recorded. See `ernie-pilot-output-verification.json`. The read-only `scripts/verify-equipment-render-output.cjs` reproduces byte/hash/geometry/binding checks without retaining finished image bytes on the VPS or saving signed URLs.
- Visual review **rejected** the image for model accuracy: chunky body, front sensor layout and tall legs do not reliably match manufacturer Mini 4 Pro imagery; front three-quarter composition also differs from the side-view brief. Lighting passed. Source comparison and native browser review screenshots are recorded separately. No generated image has been accepted or inserted into public or management UI. Tighten exact appearance instructions and retry one candidate before executing larger batches.
