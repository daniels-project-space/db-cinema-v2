# Gaffer rental contents audit

Source: authenticated read-only Hygglo v4 product details, 30 September 2026. Diogo is preferred for reviewed equivalent configurations; DB Cinema Rentals is the fallback. No title-only or fuzzy match is applied automatically.

## Cause

The Hygglo marketing mirror and storefront sync omitted descriptions. The stored knowledge profiles were generated from titles. Voice tools/KB then manufactured packing claims from category and technical specs (including a blanket exclusion of memory cards). None established actual case contents.

## Changes

Seller-authored evidence is stored separately from specs and the availability BOM. Contents preserve quantities, on-request items, explicit exclusions and seller notes, with account, product ID, source URL and acquisition date. Catalogue detail, voice search/recommendations, web/phone tool responses, text chat and booking chat read it. Voice KB documents are prepared from the same facts. Catalogue sync leaves these records intact. Refresh scripts can be rerun when listings change. Reviewed cross-account links are invalidated when either title changes; incomplete acquisition prevents an apply from overwriting existing records.

## Evidence

- 405 storefront rows audited. 400 DB Cinema and 369 Diogo detail reads succeeded; cached products whose detail endpoint returned 404 were not invented.
- 363 documented contents records; 42 lacking an unambiguous accessories list. 123 use Diogo as primary source.
- Each extracted claim is checked against the stored seller excerpt. Exact configuration matches are pinned in data/rental-contents-matches.json.
- Regression tests exercise real voice search and prevent inferred batteries/cards/stand exclusions. Full npm tests and Next.js build passed.
- Staging has all 405 evidence records; all 405 exact deployed catalogue detail responses matched the manifest; deployed voice search returned documented cards and no blanket card exclusions.
- No customer message, booking or live financial operation was performed. Live publishing remains gated by workspace AGENTS.md.

## Listings needing confirmation

Unknown means accessory details are unconfirmed, not that the main advertised item is absent. Some sources are missing; others offer only general prose or a differently configured kit. Do not turn a different lens, quantity or mount into a match.

| Product | Listing | Evidence |
| --- | --- | --- |
| 1103108 | Chauvet Rotosphere Q3 Party Light / Rotating Mirror Ball Effect, LED Disco Lighting, Event Dancefloor Light (like ADJ Mirror Ball) | Hygglo detail unavailable |
| 1103109 | 2x Chauvet Rotosphere Q3 Party Lights / Dual Rotating Mirror Ball Disco Effect, LED Dancefloor Lighting Set (like ADJ Mirror Ball) | Hygglo detail unavailable |
| 947432 | Sony venice 6k Full frame Cinema Camera ( arri Alexa mini ) | [Seller listing](https://hygglo.com/uk/i/565-sony-venice-6k-full-frame-cinema-camera-arri-alexa-mini) — no unambiguous accessory list |
| 1028856 | DZO ARLES Prime set 5 lenses t1.4 25,35,50,75,100mm DZOFILM PL mount (e,l,x,rf) | [Seller listing](https://hygglo.com/uk/i/a70-dzo-arles-prime-set-5-lenses-t14-25355075100mm-dzofilm-pl-mount-elxrf-digital-cinema-lens) — no unambiguous accessory list |
| 1097702 | Pl to e mount adapter for cinema lenses | [Seller listing](https://hygglo.com/uk/i/5fb-pl-to-e-mount-adapter-for-cinema-lenses) — no unambiguous accessory list |
| 1029180 | Atlas Mercury Anamorphic cinema lens set 1.5x 36,45,72mm Orion flare pl,ef,x,l,e | [Seller listing](https://hygglo.com/uk/i/82f-atlas-mercury-anamorphic-cinema-lens-set-15x-364572mm-orion-flare-plefxle-mount) — no unambiguous accessory list |
| 1025989 | Fujifilm x-t5 mirrorless 4k camera Film + 18-55 f2.8-4 x mount lens | [Seller listing](https://hygglo.com/uk/i/d9f-fujifilm-x-t5-mirrorless-4k-camera-film-18-55-f28-4-x-mount-lens) — no unambiguous accessory list |
| 1025975 | Sony g master lens set prime 14,35,50,85,105mm | [Seller listing](https://hygglo.com/uk/i/b1a-sony-g-master-lens-set-prime-14355085105mm) — no unambiguous accessory list |
| 1025967 | Blackmagic 6k Full Frame Bmpcc cinema camera + 2x cannon zoom lens 16-35mm f2.8 | [Seller listing](https://hygglo.com/uk/i/b4d-blackmagic-6k-full-frame-bmpcc-cinema-camera-2x-cannon-zoom-lens-16-35mm-f28-24-105mm-f4) — no unambiguous accessory list |
| 1025966 | Blackmagic 6k pro Bmpcc cinema camera + 2x cannon zoom lenses set 16-35mm and | [Seller listing](https://hygglo.com/uk/i/a5b-blackmagic-6k-pro-bmpcc-cinema-camera-2x-cannon-zoom-lenses-set-16-35mm-and-24-105mm) — no unambiguous accessory list |
| 997377 | 2x DJ Light party led event gigbar chauvet dekker, laser | [Seller listing](https://hygglo.com/uk/i/a07-2x-dj-light-party-led-event-gigbar-chauvet-dekker-laser) — no unambiguous accessory list |
| 987339 | Sony a6600 camera 4k + zhiyun weebill 3 gimbal | Hygglo detail unavailable |
| 800179 | Dop , mirrorless Camera for hire! Sony, cannon, Arri Gaffer, Focus puller | [Seller listing](https://hygglo.com/uk/i/e20-dop-mirrorless-camera-for-hire-sony-cannon-arri-gaffer-focus-puller-operator) — no unambiguous accessory list |
| 947438 | Sony venice 6k Cinema ( arri Alexa mini ) + DZO Vespid set | [Seller listing](https://hygglo.com/uk/i/c2a-sony-venice-6k-cinema-arri-alexa-mini-dzo-vespid-set) — no unambiguous accessory list |
| 947436 | Sony Venice 6k Cinema camera + Operator DP | [Seller listing](https://hygglo.com/uk/i/1da-sony-venice-6k-cinema-camera-operator-dp) — no unambiguous accessory list |
| 947434 | Sony Venice 6k Cinema Camera Ultimate Set + DZOfilm Primes | [Seller listing](https://hygglo.com/uk/i/250-sony-venice-6k-cinema-camera-ultimate-set-dzofilm-primes) — no unambiguous accessory list |
| 947433 | Sony venice 6k full frame cinema camera | [Seller listing](https://hygglo.com/uk/i/6be-sony-venice-6k-full-frame-cinema-camera-arri-alexa-mini) — no unambiguous accessory list |
| 946796 | Arri Alexa Classic Kit + Operator Dp | [Seller listing](https://hygglo.com/uk/i/32c-arri-alexa-classic-kit-operator-dp) — no unambiguous accessory list |
| 1116920 | C stand | [Seller listing](https://hygglo.com/uk/i/2fe-c-stand) — no unambiguous accessory list |
| 947435 | Sony Venice 6k Cinema Camera Raw Set ( arri Alexa mini ) | Hygglo detail unavailable |
| 885074 | 2x Sony np 970 batteries | [Seller listing](https://hygglo.com/uk/i/6a2-2x-sony-np-970-batteries) — no unambiguous accessory list |
| 987322 | Sony a7 iv 4k mirrorless full frame camera + Zoom lens Sony a7iv a7 4 | [Seller listing](https://hygglo.com/uk/i/68b-sony-a7-iv-4k-mirrorless-full-frame-camera-zoom-lens) — no unambiguous accessory list |
| 987362 | Anamorphic Blazar Remus Full frame Lens | [Seller listing](https://hygglo.com/uk/i/9a4-anamorphic-blazar-remus-full-frame-lens-set-4565100mm-t2-neutral-flare-pl-mount-like-sirui-atlas-orion-or-atlas-mercury) — no unambiguous accessory list |
| 1024185 | Blackmagic full frame 6k + BMPCC 6k pro cinema camera set | [Seller listing](https://hygglo.com/uk/i/73b-blackmagic-full-frame-6k-bmpcc-6k-pro-cinema-camera-set) — no unambiguous accessory list |
| 881042 | Lightdome Softbox 85cm Bowens mount 3x set | [Seller listing](https://hygglo.com/uk/i/aa8-lightdome-softbox-85cm-bowens-mount-3x-set) — no unambiguous accessory list |
| 892636 | Mist filter Cinebloom Moment 20% Strengh 82 and 77 mm | [Seller listing](https://hygglo.com/uk/i/002-mist-filter-cinebloom-moment-20-strengh-82-and-77-mm) — no unambiguous accessory list |
| 946702 | Blackmagic 6k pro Bmpcc Cinema Camera set Run and gun | [Seller listing](https://hygglo.com/uk/i/0b7-blackmagic-6k-pro-bmpcc-cinema-camera-set-run-and-gun) — no unambiguous accessory list |
| 1011885 | SD card v90 256gb capacity | [Seller listing](https://hygglo.com/uk/i/4db-sd-card-v90-256gb-capacity) — no unambiguous accessory list |
| 892605 | Variable ND filter VND 82 and 77mm 2-400ND Addon | [Seller listing](https://hygglo.com/uk/i/956-variable-nd-filter-vnd-82-and-77mm-2-400nd-addon) — no unambiguous accessory list |
| 997665 | Sony fx 6 cinema camera + 24-70mm g master | [Seller listing](https://hygglo.com/uk/i/91f-sony-fx-6-cinema-camera-24-70mm-g-master-media-v-mounts-rig) — no unambiguous accessory list |
| 811244 | Boom Mic Kit - Senheiser MKE600 like Rode NTG 5 Microphone | [Seller listing](https://hygglo.com/uk/i/4a8-boom-mic-kit-senheiser-mke600-like-rode-ntg-5-microphone) — no unambiguous accessory list |
| 971143 | Sony g-master 24-70mm f2.8 2x Zoom lens set | [Seller listing](https://hygglo.com/uk/i/0c9-sony-g-master-24-70mm-f28-2x-zoom-lens-set) — no unambiguous accessory list |
| 958208 | DZO film Vespid Prime Cinema lens 100mm T2.1 Full Frame | [Seller listing](https://hygglo.com/uk/i/b57-dzo-film-vespid-prime-cinema-lens-100mm-t21-full-frame) — no unambiguous accessory list |
| 953367 | Blackmagic BMPCC 6k pro Kit and Operator DP | [Seller listing](https://hygglo.com/uk/i/272-blackmagic-bmpcc-6k-pro-kit-and-operator-dp) — no unambiguous accessory list |
| 958206 | DZO film Vespid Prime Cinema lens 125mm T2.1 Full Frame | [Seller listing](https://hygglo.com/uk/i/0a2-dzo-film-vespid-prime-cinema-lens-125mm-t21-full-frame) — no unambiguous accessory list |
| 958197 | DZO film Vespid Prime Cinema lens 75mm T2.1 Full Frame | [Seller listing](https://hygglo.com/uk/i/252-dzo-film-vespid-prime-cinema-lens-75mm-t21-full-frame-pl) — no unambiguous accessory list |
| 958201 | DZO film Vespid Prime Cinema lens 25mm T2.1 Full Frame ( arri, Zeiss, cannon, | [Seller listing](https://hygglo.com/uk/i/674-dzo-film-vespid-prime-cinema-lens-25mm-t21-full-frame) — no unambiguous accessory list |
| 952049 | DZO Vespid Prime Cinema lens set + Bmpcc 6k pro camera | [Seller listing](https://hygglo.com/uk/i/303-dzo-vespid-prime-cinema-lens-set-bmpcc-6k-pro-camera) — no unambiguous accessory list |
| 1045356 | 4x Godox tl 60 tube light like pavotube set with app control RGB Light | [Seller listing](https://hygglo.com/uk/i/584-4x-godox-tl-60-tube-light-like-pavotube-set-with-app-control-rgb-light) — no unambiguous accessory list |
| 866785 | Nanlite 60c RGB Key light Kit LED Aputure 60c 60d light dome aputure 300d | [Seller listing](https://hygglo.com/uk/i/9e5-nanlite-60c-rgb-key-light-kit) — no unambiguous accessory list |
| 997609 | Party DJ Speakers PA + Lights laser gigbar event | [Seller listing](https://hygglo.com/uk/i/9ca-party-dj-speakers-pa-lights-laser-gigbar-event-dj-pioneer-xdj-rx3-deck-controller-all-in-one) — no unambiguous accessory list |
| 947051 | Sony a7siii (Fx3) + Camera Operator DP | [Seller listing](https://hygglo.com/uk/i/2eb-sony-a7siii-fx3-camera-operator-dp) — no unambiguous accessory list |

## Reproduce / publish after approval

1. Read current storefront listings and both account catalogue mirrors into the named /tmp input files.
2. Inject account credentials using ai-vault and run `scripts/hygglo-contents-fetch.cjs`. It only reads Hygglo and writes public source descriptions plus completion receipts.
3. Run `node scripts/rental-contents-sync.cjs` to review the proposed evidence manifest. Recheck configuration matches when titles change.
4. Apply with explicit `CONVEX_URL` and `ADMIN_TOKEN` using `--apply`; incomplete acquisition aborts.
5. `node scripts/gaffer-contents-sync.cjs` prepares exact category documents in /tmp/dbc-gaffer-contents-kb. After approval, inject ELEVENLABS_API_KEY and use `--apply`. It attaches the new categories and contents rule, preserves the existing model/voice/tools/policy/partner documents, and detaches old catalogue documents only from this agent. Shared documents are not deleted.

Live ElevenLabs inspection confirmed 12 old catalogue documents and no seller-documented contents rule. The proposed replacement therefore still needs publishing; staging evidence alone does not prove live Gaffer is fixed.
