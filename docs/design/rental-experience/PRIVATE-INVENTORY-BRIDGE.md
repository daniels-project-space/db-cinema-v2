# Authenticated Rental Manager inventory connection

All existing website source reads now use the configured manager Convex site and existing server synchronization credential. Catalogue import, master camera reconciliation, current/upcoming/overdue reservation mirroring and daily demand refresh share this transport. No anonymous query fallback remains.

The client validates the configured HTTPS Convex site/booking-sync URL, sends the credential only in the synchronization header, refuses redirects, bounds the request with a timeout and verifies a versioned path-bound array receipt. Missing configuration, upstream denial, malformed receipts and uncertain transport outcomes stop before source mutations.

The manager's registered POST /dbcinema/storefront-read endpoint authenticates before dispatch. It allows only four named read operations; account-scoped operations accept exactly dbcinema and no additional arguments. It cannot invoke arbitrary queries or mutations. Typed internal counterparts preserve actual handler behavior while the public functions remain owner-protected. Response projection excludes renter identities, contact details and unrelated private metadata; errors hide internal source details. Responses are no-store.

Validation:

- Actual route/service-handler tests verify POST registration, missing/wrong credentials, argument/account/function injection, bounded body, source error privacy, all four real internal counterparts and blocked public inventory under enabled owner enforcement.
- Actual website caller tests cover all five source calls (master inventory is also used by camera reconciliation), exact endpoint/header and redirect policy, missing/malformed configuration, HTTP rejections, receipt binding and uncertain failures before writes.
- A paired native HTTP fixture uses both applications' actual handlers and the registered route. With owner enforcement enabled, direct inventory reads reject; the private bridge imports exact quantities and upstream occupancy makes full-cart availability false. Demand refresh uses the same bridge, wrong credentials preserve the mirror and private renter metadata is absent. Controlled source rows/auth transport and port 41846; no production writes. The fixture server closes after completion. Evidence: /tmp/dbc-private-inventory-http-native.log.

Deploy the compatible manager endpoint/internal reads first, verify the existing synchronization credential and exact website/manager pairing, then publish the website consumer. Register the private owner before enabling enforcement to avoid administrator lockout. Preview deployment does not publish these backends. Do not relax owner protection or silently return to anonymous reads when source authentication fails.

This establishes the authenticated mirror connection, not an atomic distributed booking claim or a live cart freshness guarantee. Complete canonical kit/component mapping, fresh source checks, shared claims, real stock/cart/calendar acceptance and the rest of the original goal remain outstanding.

Full local website tests, TypeScript and production build pass. Manager checks pass 139 files / 2144 tests with 14 existing skips, TypeScript, Next production build and both owner-boundary audits. Both code graphs are updated. Source-matched hosted validation and backend acceptance remain pending.
