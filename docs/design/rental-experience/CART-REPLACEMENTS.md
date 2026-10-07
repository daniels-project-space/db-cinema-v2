# Quantity-aware full-cart replacements

The full cart groups identical listing/date requests. Prefix packs such as `3x Sony FX3` count as three requested bodies. Suggestions cover the complete requested count using one or more available listings, keeping the original dates. Physical inventory, shared bundle components, current reservations, temporary holds, catalogue day blocks, minimum duration and camera/lens mount compatibility are checked.

Search backtracks over ranked combinations rather than filling greedily. A query-local cache avoids re-reading the same inventory records and reservations for every combination; it never persists between requests. Search stops after 10,000 trial combinations or the requested result count. If that search limit prevents a complete answer, the UI says the team needs to check instead of claiming no suitable set exists. Only complete, verified combinations are presented as whole-set switches. Independent available cards remain usable when a full combination cannot fit.

Add all atomically replaces the unavailable group. Add separately appends the chosen listing and preserves the unresolved request for review; the customer must remove that request before checkout. Both actions re-query availability and reject an intervening cart edit. Final checkout retains its full-kit stock check. Neither action discards the selected subscription.

Validation on 7 October 2026:

- `test-replacement-sets.cjs`: mixed bodies; complete quantities; three-plus-four packs where greedy seed rotation fails; aliases; retained shared stock; new reservations across queries; day blocks; exact dates; individual additions; stale cart rejection.
- Existing `test-cart-replacements.cjs`, TypeScript and production build passed.
- Actual local full-cart UI connected to the development Convex catalogue: three unavailable Sony Venice rows produced a three-body FX3 kit and a two-body-plus-one-body alternative. Show more expanded the options. Individual addition kept all original rows, and whole-set switching replaced them. Dates remained 12–13 November 2026.
- Desktop and mobile screenshots were inspected. The mobile grid was corrected so the document width matches 390px; replacement cards scroll horizontally inside their panel.

This is development/local acceptance, not production publication or proof of the separate Rental Manager integration requirements.
