# Film Fund and membership community release

## Current contract

- Membership fees unchanged: Starter £19, Pro £49, Studio £99. Paid monthly credits now add 10%, 20%, 30% respectively: £20.90, £58.80, £128.70. Persist the earned grant amount for later refunds; pre-change grants retain their original amount/rate.
- £20 welcome offer removed from new checkout reservations, membership marketing, checkout controls and active terms. Preserve already accepted provider sessions and historical granted credits. Free-week or immediate paid membership remain.
- Fund entry: £30 per project for nonmembers, £15 for eligible Starter members, included for Pro/Studio. Freeze price on reservation; verify provider amount against it. Legacy reservations keep their agreed £15 price. One submitted entry per project, no extra tickets.
- Terms versions updated. Award acceptance includes a non-exclusive full-film website promotional licence while filmmakers retain ownership. Explicit application acceptance, required rights clearances, creator attribution and agreed festival embargo/publication schedule. No public screening licence from unsuccessful applications. UK rights source: https://www.gov.uk/using-somebody-elses-intellectual-property/copyright
- Coming soon stays closed to submissions/payments. No launch, live financial or recovery-gate changes.

## Design / asset

Shared Fund hero on homepage after camera disassembly and /film-fund: editorial Instrument Serif headline, warm coral/olive palette, crew photograph, taped frame, hand-drawn hearts and subtle breathing/sway animations. Clear bullet lists and standout 7/2-day award cards, twice-yearly dates, six-part pitch checklist, explicit entry and rights summary. Membership top has original camera/heart SVG artwork, film-perforation details and interactive real tier credit preview. All motion honors prefers-reduced-motion.

Asset: public/images/film-fund/crew-on-set.webp (1536×1024, 359128 bytes). Generated with the built-in image tool; original at /root/.codex/generated_images/01a0f17b-b4d3-71c2-9929-1f506c4877ba/exec-72c66bd2-35c8-47db-8c17-aeb39fd7209a.png. Prompt: cinematic documentary photograph of six proud diverse young adult filmmakers on a small London warehouse film set, realistic cinema camera/tripod/matte box/monitor, boom and lighting stands, warm natural amber/olive light, authentic camaraderie, analog grain, no text/logos. Caption makes it an imagined supported set, not evidence of previous winners. Lossy WebP encoding only, no content edit.

## Verification

Handler tests cover per-plan credit amounts, removed welcome checkout rejection, invoice idempotency, recorded-rate refunds after tier change, legacy grant accounting, nonmember/Starter entry prices and actual Stripe parameters/deadline/receipt/refund guards. Full suite/build/Convex checks and actual sandbox £30 payment/refund acceptance required before release. Desktop/mobile Fund, homepage Fund section and membership rendered inspection, loaded photograph, tier-preview clicks, removed welcome UI and reduced-motion CSS checks.

Acceptance completed: full suite and Next production build passed. Actual Stripe sandbox £30 GBP hosted checkout automatically submitted four private files; retry/duplicate purchase blocked. Full £30 refund succeeded and reconciliation invalidated eligibility before browser return. Stage restored Coming soon/dates and temporary email suppression removed. Starter £15 reservation/receipt and retained-price-after-expiry handler tests passed. Desktop/mobile Fund, homepage and membership screenshots inspected; photo loaded, no overflow, correct Pro £58.80/+20% preview and reduced-motion animations disabled.
