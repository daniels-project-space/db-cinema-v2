# Gaffer rental contents audit

Source: authenticated read-only Hygglo v4 product details, 30 September 2026. Diogo is preferred for reviewed equivalent configurations; DB Cinema Rentals is the fallback. An exact unique title or reviewed configuration link is required; fuzzy matches are not applied automatically.

## Cause

The Hygglo marketing mirror and storefront sync omitted descriptions. The stored knowledge profiles were generated from titles. Voice tools/KB then manufactured packing claims from category and technical specs (including a blanket exclusion of memory cards). None established actual case contents.

## Changes

Seller-authored evidence is stored separately from specs and the availability BOM. Contents preserve quantities, on-request items, explicit exclusions and seller notes, with account, product ID, source URL and acquisition date. Catalogue detail, voice search/recommendations, web/phone tool responses, text chat and booking chat read it. Voice KB documents are prepared from the same facts. Catalogue sync preserves these records for unchanged configurations and removes them when the product/title changes. The apply boundary also rejects an acquisition made for an old title. Refresh scripts can be rerun when listings change. Reviewed cross-account links are invalidated when either title changes; incomplete acquisition prevents an apply from overwriting existing records.

## Evidence

- 405 storefront rows audited. Live account catalogue reads confirmed 400 DB Cinema and 369 Diogo products; their detail reads succeeded; cached products whose detail endpoint returned 404 were not invented.
- 377 documented contents records; 28 lacking an unambiguous accessories list. 131 use Diogo as primary source.
- Each extracted claim is checked against the stored seller excerpt. Exact configuration matches are pinned in data/rental-contents-matches.json.
- Regression tests exercise real voice search, reject applying contents to a renamed configuration, and ensure catalog sync discards obsolete packing lists. They prevent inferred batteries/cards/stand exclusions. Full npm tests and Next.js build passed.
- Staging has all 405 evidence records; all 405 exact deployed catalogue detail responses matched the manifest; deployed voice search returned documented cards and no blanket card exclusions.
- No customer message, booking or live financial operation was performed. Live publishing remains gated by workspace AGENTS.md.

## Rendered web lookup follow-up

The main browser `find_gear` closure initially dropped contents despite the database search carrying them. It now returns the complete sourced contents for each exact matched listing; browse/recommend responses use the same formatter, including optional items and seller notes. An actual rendered local Next.js preview connected to isolated staging returned documented FX3 card facts and C-stand confirmed/unknown details. No voice call, basket write, booking, message or payment was performed.

## Reviewed prose facts

Six additional listings contain explicit partial contents in prose, rather than a packing list: the Venice starter, Venice/DZO set, Venice body, two-camera Blackmagic set, DZO/Blackmagic set and party package. Their exact seller fragments are now retained in `data/rental-contents-facts.json`. Reviews bind to the account, product ID, full source title and full description; any change invalidates the review. Unspecified brands, counts and remaining accessories stay unconfirmed. Regression checks reject stale titles/descriptions and wrong product IDs.

## Listings needing confirmation

Unknown means accessory details are unconfirmed, not that the main advertised item is absent. Some sources are missing; others offer only general prose or a differently configured kit. Do not turn a different lens, quantity or mount into a match.

| Product | Listing | Evidence |
| --- | --- | --- |
| 1103108 | Chauvet Rotosphere Q3 Party Light / Rotating Mirror Ball Effect, LED Disco Lighting, Event Dancefloor Light (like ADJ Mirror Ball) | Hygglo detail unavailable |
| 1103109 | 2x Chauvet Rotosphere Q3 Party Lights / Dual Rotating Mirror Ball Disco Effect, LED Dancefloor Lighting Set (like ADJ Mirror Ball) | Hygglo detail unavailable |
| 1028856 | DZO ARLES Prime set 5 lenses t1.4 25,35,50,75,100mm DZOFILM PL mount (e,l,x,rf) | [Seller listing](https://hygglo.com/uk/i/a70-dzo-arles-prime-set-5-lenses-t14-25355075100mm-dzofilm-pl-mount-elxrf-digital-cinema-lens) — no unambiguous accessory list |
| 1097702 | Pl to e mount adapter for cinema lenses | [Seller listing](https://hygglo.com/uk/i/5fb-pl-to-e-mount-adapter-for-cinema-lenses) — no unambiguous accessory list |
| 1029180 | Atlas Mercury Anamorphic cinema lens set 1.5x 36,45,72mm Orion flare pl,ef,x,l,e | [Seller listing](https://hygglo.com/uk/i/82f-atlas-mercury-anamorphic-cinema-lens-set-15x-364572mm-orion-flare-plefxle-mount) — no unambiguous accessory list |
| 1025989 | Fujifilm x-t5 mirrorless 4k camera Film + 18-55 f2.8-4 x mount lens | [Seller listing](https://hygglo.com/uk/i/d9f-fujifilm-x-t5-mirrorless-4k-camera-film-18-55-f28-4-x-mount-lens) — no unambiguous accessory list |
| 1025967 | Blackmagic 6k Full Frame Bmpcc cinema camera + 2x cannon zoom lens 16-35mm f2.8 | [Seller listing](https://hygglo.com/uk/i/b4d-blackmagic-6k-full-frame-bmpcc-cinema-camera-2x-cannon-zoom-lens-16-35mm-f28-24-105mm-f4) — no unambiguous accessory list |
| 1025966 | Blackmagic 6k pro Bmpcc cinema camera + 2x cannon zoom lenses set 16-35mm and | [Seller listing](https://hygglo.com/uk/i/a5b-blackmagic-6k-pro-bmpcc-cinema-camera-2x-cannon-zoom-lenses-set-16-35mm-and-24-105mm) — no unambiguous accessory list |
| 997377 | 2x DJ Light party led event gigbar chauvet dekker, laser | [Seller listing](https://hygglo.com/uk/i/a07-2x-dj-light-party-led-event-gigbar-chauvet-dekker-laser) — no unambiguous accessory list |
| 987339 | Sony a6600 camera 4k + zhiyun weebill 3 gimbal | Hygglo detail unavailable |
| 800179 | Dop , mirrorless Camera for hire! Sony, cannon, Arri Gaffer, Focus puller | [Seller listing](https://hygglo.com/uk/i/e20-dop-mirrorless-camera-for-hire-sony-cannon-arri-gaffer-focus-puller-operator) — no unambiguous accessory list |
| 947436 | Sony Venice 6k Cinema camera + Operator DP | [Seller listing](https://hygglo.com/uk/i/1da-sony-venice-6k-cinema-camera-operator-dp) — no unambiguous accessory list |
| 947434 | Sony Venice 6k Cinema Camera Ultimate Set + DZOfilm Primes | [Seller listing](https://hygglo.com/uk/i/250-sony-venice-6k-cinema-camera-ultimate-set-dzofilm-primes) — no unambiguous accessory list |
| 946796 | Arri Alexa Classic Kit + Operator Dp | [Seller listing](https://hygglo.com/uk/i/32c-arri-alexa-classic-kit-operator-dp) — no unambiguous accessory list |
| 1116920 | C stand | [Seller listing](https://hygglo.com/uk/i/2fe-c-stand) — no unambiguous accessory list |
| 947435 | Sony Venice 6k Cinema Camera Raw Set ( arri Alexa mini ) | Hygglo detail unavailable |
| 987362 | Anamorphic Blazar Remus Full frame Lens | [Seller listing](https://hygglo.com/uk/i/9a4-anamorphic-blazar-remus-full-frame-lens-set-4565100mm-t2-neutral-flare-pl-mount-like-sirui-atlas-orion-or-atlas-mercury) — no unambiguous accessory list |
| 946702 | Blackmagic 6k pro Bmpcc Cinema Camera set Run and gun | [Seller listing](https://hygglo.com/uk/i/0b7-blackmagic-6k-pro-bmpcc-cinema-camera-set-run-and-gun) — no unambiguous accessory list |
| 1011885 | SD card v90 256gb capacity | [Seller listing](https://hygglo.com/uk/i/4db-sd-card-v90-256gb-capacity) — no unambiguous accessory list |
| 971143 | Sony g-master 24-70mm f2.8 2x Zoom lens set | [Seller listing](https://hygglo.com/uk/i/0c9-sony-g-master-24-70mm-f28-2x-zoom-lens-set) — no unambiguous accessory list |
| 958208 | DZO film Vespid Prime Cinema lens 100mm T2.1 Full Frame | [Seller listing](https://hygglo.com/uk/i/b57-dzo-film-vespid-prime-cinema-lens-100mm-t21-full-frame) — no unambiguous accessory list |
| 953367 | Blackmagic BMPCC 6k pro Kit and Operator DP | [Seller listing](https://hygglo.com/uk/i/272-blackmagic-bmpcc-6k-pro-kit-and-operator-dp) — no unambiguous accessory list |
| 958206 | DZO film Vespid Prime Cinema lens 125mm T2.1 Full Frame | [Seller listing](https://hygglo.com/uk/i/0a2-dzo-film-vespid-prime-cinema-lens-125mm-t21-full-frame) — no unambiguous accessory list |
| 958197 | DZO film Vespid Prime Cinema lens 75mm T2.1 Full Frame | [Seller listing](https://hygglo.com/uk/i/252-dzo-film-vespid-prime-cinema-lens-75mm-t21-full-frame-pl) — no unambiguous accessory list |
| 958201 | DZO film Vespid Prime Cinema lens 25mm T2.1 Full Frame ( arri, Zeiss, cannon, | [Seller listing](https://hygglo.com/uk/i/674-dzo-film-vespid-prime-cinema-lens-25mm-t21-full-frame) — no unambiguous accessory list |
| 1045356 | 4x Godox tl 60 tube light like pavotube set with app control RGB Light | [Seller listing](https://hygglo.com/uk/i/584-4x-godox-tl-60-tube-light-like-pavotube-set-with-app-control-rgb-light) — no unambiguous accessory list |
| 866785 | Nanlite 60c RGB Key light Kit LED Aputure 60c 60d light dome aputure 300d | [Seller listing](https://hygglo.com/uk/i/9e5-nanlite-60c-rgb-key-light-kit) — no unambiguous accessory list |
| 947051 | Sony a7siii (Fx3) + Camera Operator DP | [Seller listing](https://hygglo.com/uk/i/2eb-sony-a7siii-fx3-camera-operator-dp) — no unambiguous accessory list |

## Reproduce / publish after approval

1. Read current storefront listings and both account catalogue mirrors into the named /tmp input files.
2. Inject account credentials using ai-vault and run `scripts/hygglo-contents-fetch.cjs`. It only reads Hygglo and writes public source descriptions plus completion receipts.
3. Run `node scripts/rental-contents-sync.cjs` to review the proposed evidence manifest. Recheck configuration matches when titles change.
4. Apply with explicit `CONVEX_URL` and `ADMIN_TOKEN` using `--apply`; incomplete acquisition aborts.
5. `node scripts/gaffer-contents-sync.cjs` prepares exact category documents in /tmp/dbc-gaffer-contents-kb. After approval, inject ELEVENLABS_API_KEY and use `--apply`. It attaches the new categories and contents rule, preserves the existing model/voice/tools/policy/partner documents, and detaches old catalogue documents only from this agent. Shared documents are not deleted.

Live ElevenLabs inspection confirmed 12 old catalogue documents and no seller-documented contents rule. The proposed replacement therefore still needs publishing; staging evidence alone does not prove live Gaffer is fixed.

## Approved live publication — 30 September 2026

Daniel approved publication. PR #3 isolated the contents changes onto the production base, and merged as `9e2645fb3c651d6b1c00beaef60c64f7c0cd1d4b`. The exact `dbcinemarentals.com` alias was verified against Vercel deployment `dpl_CYoLRELxS3e2EPjpPrapCDkg4KkW`, the expected repository and that commit. PR #2 is superseded for publication; the unfinished checkout branch stays separate.

- Public backend `veracious-wombat-196` has all 405 contents records, verified through all 405 exact listing detail responses. Voice search retains actual included cards and explicit exclusions.
- Live ElevenLabs agent has 12 replacement contents documents. Reading their actual provider content confirmed all 405 entries, the reviewed Venice/Blackmagic partial facts and the C-stand sandbag exclusion. Old catalogue documents were detached, not deleted. Model, voice and remaining conversation settings were verified unchanged during contents publication.
- Rendered production browser `find_gear` closure returned FX3 card facts and confirmed/unknown C-stand details. Authenticated production `/api/voice` lookup also returned actual contents; an invalid voice secret returned 401. No paid voice call or customer message was used for testing.
- Related gaps fixed: blank Vercel production Convex URL, an evaluator requiring blanket accessory exclusions, and stale `recommend_gear` instructions requiring exclusions. Evaluation/tool updates were verified independently with their remaining settings unchanged.
- Production checkout and automatic late collection remain disabled. Those features were not activated by this release.
- Focused follow-up review found no additional contents-related gaps. 28 listings still lack sufficiently specific accessories evidence and remain explicitly unconfirmed; Gaffer must ask for confirmation rather than invent a packing list.
