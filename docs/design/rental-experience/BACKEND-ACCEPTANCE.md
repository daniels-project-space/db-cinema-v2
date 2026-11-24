# Hosted checkout acceptance uses the intended backend

The main-branch browser workflow pointed at historical `veracious-wombat-196`, while the current public site's actual `ConvexReactClient` uses `zany-wolf-18`. The production client constructor was verified in `/_next/static/chunks/1qal2jj0g9ihh.js`; another Convex URL in a library error example is not a client binding. CI now targets the actual live deployment for main and retains its existing `deafening-stoat-340` PR target.

`check-stock-backend.cjs` runs before browser acceptance. It requires matching frontend and backend URLs and invokes `sync:refreshCartStock` with `items: null`. The actual action declares an array validator; Convex rejects null before the body runs. The check recognizes the expected argument-validation rejection, including Convex HTTP 560 for a failed UDF, and reports absent function/unreachable/unexpected response without printing provider errors. It never substitutes stock data or changes browser checkout assertions.

### Recheck — 22 November 2026

The preview/backend pair `https://deafening-stoat-340.convex.cloud` now passes `check-stock-backend.cjs` with `STOCK_FUNCTION_AVAILABLE`. The probe reads the catalogue, then submits `items: null`; Convex rejects the argument against the array validator before entering the action body. This confirms that the public function is registered in Preview without running its stock-sync handler. Source also exports `refreshCartStock` as a public action in `convex/sync.ts`.

The membership browser harness had a stale hardcoded default of historical `veracious-wombat-196`, which explains a missing-function error when run without explicit environment configuration. It now requires a configured Convex URL, uses the shared test-target resolver, and rejects a mismatch with `NEXT_PUBLIC_CONVEX_URL`. CI already supplies the documented Preview pair for pull requests and the current backend pair for main. The full native browser run was not repeated locally because the running local Next dev server uses a local mock Convex URL rather than the Preview pair; the browser regression still needs to run in its paired build/browser setup. This recheck does not prove a successful stock-sync execution or alter production.

Prior source 3f24c8c CI 37744966443 passed typecheck/tests/build but timed out waiting for secure checkout to become enabled. This does not establish a problem in the older production frontend, which has not received these draft features.

Tests cover mismatched/invalid bindings, the real source's array validator and separate empty-basket guard, HTTP 560, missing function, bad payload/server status, transport/JSON failures and provider error redaction. Existing full tests, typecheck, production build and Graphify update remain required. No backend deployment, live finance, document copy or customer mail is performed by this check.

The full goal remains open: paired compatible rollout, one shared atomic reservation authority, real provider acceptance, reference visual fidelity and accepted accurate ERNIE equipment imagery are separate requirements.
