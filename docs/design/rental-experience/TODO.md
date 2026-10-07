# Active rental experience goal

This checklist extends the original goal; no original integration requirement is removed.

## Layout and visual scope — added 7 October 2026

- [ ] Rebuild renter account, rental conversations and management screens in standard dark mode, using the approved concept's layout and visual hierarchy.
- [ ] Bring the concept's left sidebar into account/rental management: role-appropriate Dashboard, Rentals, Calendar, Inventory, Customers/Members, Messages, Invoices, Reports and Settings; customer accounts must only expose their authorised functions.
- [ ] Preserve separate, clearly labelled equipment items with accurate photos, quantities and identifiers where available.
- [ ] Implement per-item Good condition / Issues found controls, issue descriptions and Mark all good.
- [ ] Implement custom retained amount, paid-deposit and uncaptured-hold breakdown, damage-case selection, reason, invoice preview and renter-email preview, with correct actual settlement arithmetic.
- [x] Generate GPT concepts for remaining invoice screens (`dark-invoices.png`).
- [x] Generate GPT concepts for remaining customers/members screens (`dark-members.png`).
- [ ] Generate additional management screen concepts as needed, consistently using dark mode.
- [ ] Inspect desktop/mobile implementation screenshots against the selected concepts before claiming visual completion.
- [ ] Keep all redesign styles and navigation scoped to account/rental management; verify landing, gear selection and checkout retain their current designs.

## Equipment hero images — added 7 October 2026

- [ ] Request and verify an Earnie image-render lane through Render Engine in parallel with interface development; inspect current admission, provider and cost state before spending.
- [x] Export actual individual inventory items, canonical identifiers and quantities from the Rental Manager master inventory (`master-inventory.json`, 108 records).
- [ ] Enrich and verify factual descriptions from actual listing data and reference photos.
- [ ] Prepare a consistent image prompt per inventory item; match the actual equipment model and supplied reference photos.
- [ ] Render each item as a side-view kit showcase, filling the absolute majority of the frame, in a dark room with a cool overhead spotlight; maintain matching framing, scale, lighting and background across the set.
- [ ] Verify factual equipment accuracy and image quality; avoid inventing included accessories or misleading stock.
- [ ] Save final images in DB Cinema Rentals' own R2 bucket; verify object hashes and receipts before publication.
- [ ] Connect verified assets to account and management equipment tiles; preserve the public catalogue/checkout/landing design scope.

## Original integration requirements

- [ ] Modern renter/admin cards and rental conversation rebuilt from the approved concepts.
- [ ] Drone operator licence upload and an additional admin assessment, visible only for drone rentals and enforced before handover; verify deployed end to end.
- [ ] Canonical live master-stock quantities and ongoing/upcoming reservations drive full-cart availability.
- [ ] Over-requested/marketing-only items remain addable for demand logging, then show unavailable/booked-out status and available alternatives on the full cart.
- [ ] Multi-item replacement sets respect requested quantities, shared units, retained cart demand, compatibility and original dates; offer horizontal cards, individual addition and atomic Add all.
- [ ] Booking creation and double-booking protection are transactional, and checkout saves precise collection/return periods.
- [ ] Website bookings and changes update Rental Manager notifications, calendar and operational flows.
- [ ] Returns can close rentals from either management surface; damage decisions, reasons, custom retention and cases synchronise.
- [ ] Automatic itemised settlement invoice and renter email describe actual charges/refunds and case reasons.
- [ ] DB Cinema Web has a consistent distinct colour on Rental Manager cards, calendar rows and all-time revenue graph, with correct equipment images.
- [ ] Verify every relevant Hygglo management integration also supports website bookings, without duplicate stock/revenue entries.

## Evidence so far

- Four initial GPT concepts saved locally. Generated financial text is illustrative only.
- Drone licence implementation committed as `121760e`; focused ownership/review tests, TypeScript and production build passed locally. Production acceptance still outstanding.
- Read-only live master inventory query returned 108 records, all carrying quantities.
- Replacement-set implementation in progress; not yet validated or deployed.
