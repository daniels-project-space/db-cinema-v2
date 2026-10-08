# Hosted checkout acceptance uses the intended backend

The main-branch browser workflow pointed at historical `veracious-wombat-196`, while the current public site's actual `ConvexReactClient` uses `zany-wolf-18`. The production client constructor was verified in `/_next/static/chunks/1qal2jj0g9ihh.js`; another Convex URL in a library error example is not a client binding. CI now targets the actual live deployment for main and retains its existing `deafening-stoat-340` PR target.

`check-stock-backend.cjs` runs before browser acceptance. It requires matching frontend and backend URLs and invokes `sync:refreshCartStock` with `items: null`. The actual action declares an array validator; Convex rejects null before the body runs. The check recognizes the expected argument-validation rejection, including Convex HTTP 560 for a failed UDF, and reports absent function/unreachable/unexpected response without printing provider errors. It never substitutes stock data or changes browser checkout assertions.

The invalid-argument live probe returns an unexpected contract response and is not accepted as compatible. The invalid-argument staged check currently reports `STOCK_FUNCTION_NOT_DEPLOYED`; the required action is not deployed on the PR target. Prior source 3f24c8c CI 37744966443 passed typecheck/tests/build but timed out waiting for secure checkout to become enabled. A compatible staged backend is needed before that end-to-end acceptance can pass. This does not establish a problem in the older production frontend, which has not received these draft features.

Tests cover mismatched/invalid bindings, the real source's array validator and separate empty-basket guard, HTTP 560, missing function, bad payload/server status, transport/JSON failures and provider error redaction. Existing full tests, typecheck, production build and Graphify update remain required. No backend deployment, live finance, document copy or customer mail is performed by this check.

The full goal remains open: paired compatible rollout, one shared atomic reservation authority, real provider acceptance, reference visual fidelity and accepted accurate ERNIE equipment imagery are separate requirements.
