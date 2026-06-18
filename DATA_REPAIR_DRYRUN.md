# DB-Cinema Listings — Taxonomy Data-Repair DRY RUN

**Status: DRY RUN ONLY — NO PROD WRITES PERFORMED.**
Branch: `fix/data-repair`. Convex prod = `veracious-wombat-196`, table `listings` (404 docs).

This report re-derives `(category, itemType, mount, tier)` for all 404 listings
using the improved `convex/lib/taxonomy.ts` + `convex/sync.ts deriveCategory`
logic, and lists ONLY the rows that would change. It was produced offline from
the snapshot `/tmp/dbc-audit/listings/documents.jsonl` against the actually-
compiled source modules (not a hand re-typed port). It mutates nothing.

## How this was generated (reproducible, offline)

```sh
# 1. compile the two PURE modules (no convex/server deps) to plain JS
npx tsc convex/lib/taxonomy.ts src/lib/mount.ts \
  --outDir /tmp/dbc-verify --module esnext --target es2020 \
  --moduleResolution bundler --skipLibCheck
# 2. assertions on the known-bad slugs (28/28 pass)
node convex/migrations/taxonomy.assert.mjs /tmp/dbc-verify
# 3. full re-derive + this report (see convex/migrations/repairTaxonomy.ts header)
```

## Headline totals

| metric | count |
|---|---|
| docs total | 404 |
| docs that would change (any field) | **90** |
| docs unchanged | 314 |
| — category changes | **4** |
| — itemType changes | **19** |
| — mount changes | **47** |
| — tier changes | **37** |
| — flagged MANUAL (not auto-applied) | **12** |

## Repair policy (IMPORTANT — additive / non-destructive)

The snapshot's `specs.mount` is a HYBRID of rule-derived values and hand/LLM
corrections applied via `sync.applyClassification` (e.g. Fuji `X`, compound
`E/EF/PL`, GoPro `fixed`). A blind "re-derive everything" would REGRESS ~30 of
those. Therefore the repair is strictly additive:

- **mount** — only (a) BACKFILL when current is `null`, (b) UPGRADE a single
  stored token to an explicit author-written COMPOUND (e.g. `PL` →
  `E/EF/RF/PL/L` when the title literally says "pl/ef/e/l/rf mount"), or
  (c) CLEAR mount when the item is reclassified OUT of camera-body/lens. A
  non-null stored mount is NEVER overwritten with `null` or a weaker guess.
- **tier** — only BACKFILL when current is `null` (lenses); CLEAR on non-lenses.
- **itemType / category** — re-derived; only the camera-body greedy-rule false
  positives and the GM/cine category misses move (verified, see §A/§B).
- Mount is stored as the **raw compound string** ("E/EF/PL") because
  `src/lib/mount.ts parseMounts` splits on `/ , |` — storing only a "primary"
  would discard the adapter-compatibility paths the lens-ranking engine uses.

---

### A. itemType changes (19)

| slug | from | to | flag | title |
|---|---|---|---|---|
| sony-a7siii-fx3-camera-operator-dp-947051 | camera-body | accessory | MANUAL | Sony a7siii (Fx3) + Camera Operator DP |
| flycam-flowline-pro-5-12-kg-camera-support-vest-easyrig-easy-1093201 | camera-body | tripod |  | Flycam Flowline Pro Camera Support Vest / Easyrig |
| dop-mirrorless-camera-for-hire-sony-cannon-arri-gaffer-focus-800179 | camera-body | accessory | MANUAL | Dop, mirrorless Camera for hire! |
| pl-to-ef-mount-adapter-pl-lens-to-canon-ef-camera-mount-conv-1097753 | camera-body | accessory |  | PL to EF Mount Adapter |
| 2x-smallrig-tripod-camera-heavy-duty-set-fluid-head-and-hand-1000760 | camera-body | tripod |  | 2x smallrig tripod camera heavy duty set Fluid head |
| sony-venice-6k-cinema-camera-operator-dp-947436 | camera-body | accessory | MANUAL | Sony Venice 6k Cinema camera + Operator DP |
| pl-to-rf-mount-adapter-pl-lens-to-canon-rf-camera-mount-conv-1097754 | camera-body | accessory |  | PL to RF Mount Adapter |
| 3x-tripod-stand-heavy-duty-camera-stable-fluid-head-cinema-1011143 | camera-body | tripod |  | 3x Tripod stand heavy duty camera stable fluid head |
| lexar-cfexpress-type-a-320gb-memory-card-card-reader-high-sp-1103088 | camera-body | accessory |  | Lexar CFexpress 320GB Memory Card + Card Reader |
| arri-alexa-classic-kit-operator-dp-946796 | camera-body | accessory | MANUAL | Arri Alexa Classic Kit + Operator Dp |
| pl-to-l-mount-adapter-pl-lens-to-leica-panasonic-sigma-l-mou-1097755 | camera-body | accessory |  | PL to L Mount Adapter |
| blackmagic-bmpcc-6k-pro-kit-and-operator-dp-953367 | camera-body | accessory | MANUAL | Blackmagic BMPCC 6k pro Kit and Operator DP |
| camera-flash-compatible-with-sony-cannon-nikon-leica-fuji-987351 | camera-body | light | MANUAL | Camera flash compatible with Sony, cannon, Nikon, Leica, Fuji |
| blackmagic-pocket-cinema-camera-6k-full-frame-set-vnd-filter-1103089 | camera-body | accessory |  | Blackmagic Pocket Cinema Camera 6K Full Frame Set + VND Filter |
| camera-slider-100cm-motorised-neewer-automatic-app-control-823200 | camera-body | slider |  | Camera slider 100cm motorised Neewer automatic |
| 16-inch-teleprompter-kit-large-professional-camera-telepromp-1097745 | camera-body | accessory |  | 16-Inch Teleprompter Kit |
| pl-to-e-mount-adapter-for-cinema-lenses-1097702 | lens | accessory |  | Pl to e mount adapter for cinema lenses |
| hollyland-pyro-s-wireless-video-transmitter-receiver-kit-4k--1097741 | camera-body | monitor |  | Hollyland Pyro S Wireless Video Transmitter & Receiver Kit |
| monopod-slider-support-camera-stand-823472 | camera-body | tripod |  | Monopod Slider Support camera stand |

### B. category changes (4)

| slug | from | to | title |
|---|---|---|---|
| anamorphic-blazar-remus-100mm-1-5x-t2-8-987359 | Accessories | Lenses | Anamorphic Blazar Remus 100mm 1.5x T2.8 |
| sony-24-70mm-f2-8-zoom-gmaster-g-master-g-master-gm-e-mount-973616 | Accessories | Lenses | Sony 24-70mm f2.8 gmaster e mount (FLAGSHIP — was stuck in Accessories) |
| tripod-sirui-stand-with-fluid-head-heavy-duty-10kg-capacity-1046084 | Grip | Lenses | Tripod Sirui stand with fluid head heavy duty 10kg (see Risks) |
| anamorphic-blazar-remus-65mm-1-5x-t2-0-987357 | Accessories | Lenses | Anamorphic Blazar Remus 65mm 1.5x T2.0 |

### C. mount changes (47)

| slug | from | to | reason | flag | title |
|---|---|---|---|---|---|
| dzo-arles-prime-set-6-lenses-t1-4-14-25-35-50-75-100mm-dzofi-1028858 | PL | E/RF/PL/L/X | upgrade-to-compound |  | DZO ARLES Prime set 6 lenses (PL mount + e,l,x,rf) |
| red-komodo-x-6k-cinema-camera-digital-rf-arri-pl-mount-3x-an-1029213 | RF | RF/PL | upgrade-to-compound |  | Red Komodo x 6k rf + Arri pl mount |
| 2x-go-pro-hero-12-set-4x-batteries-2x-128gb-sd-cards-1021774 | fixed | (null) | clear-mount(non-cam/lens) |  | 2x Go Pro Hero 12 set (reclassified battery) |
| dzofilm-cinema-zoom-lens-full-frame-catta-ace-set-pl-ef-e-l--958051 | (null) | E/EF/RF/PL/L | backfill-null |  | DZOfilm Catta Ace Set pl/ef/e/l/rf mount |
| budget-interview-setup-3x-go-pro-hero-12-set-2x-rode-wireles-1028853 | fixed | (null) | clear-mount(non-cam/lens) |  | Budget interview gopro set |
| sony-a7siii-fx3-camera-operator-dp-947051 | E | (null) | clear-mount(non-cam/lens) | MANUAL | Sony a7siii (Fx3) + Operator DP |
| blackmagic-6k-full-frame-cinema-camera-1tb-sd-card-bmpcc-pro-1021781 | (null) | EF | backfill-null |  | Blackmagic 6k Full Frame BMPCC pro |
| blackmagic-pyxis-6k-cinema-camera-basic-set-modular-6k-raw-p-1103091 | PL | EF/PL | upgrade-to-compound |  | Blackmagic Pyxis 6K Basic (PL/EF) |
| blazar-remus-full-frame-33mm-t1-8-1-5x-anamorphic-lens-cinem-1038954 | PL | E/EF/RF/PL/L/X | upgrade-to-compound |  | Blazar Remus 33mm (pl,ef,e,x,l,rf mount) |
| budget-interview-setup-3x-go-pro-hero-12-set-2x-rode-wireles-1028854 | fixed | (null) | clear-mount(non-cam/lens) |  | Budget interview gopro set |
| sony-venice-6k-cinema-camera-raw-set-arri-alexa-mini-947435 | (null) | PL | backfill-null | MANUAL | Sony Venice 6k Raw Set (arri Alexa mini) |
| dzo-film-vespid-prime-cinema-lens-16mm-t2-8-full-frame-arri--958202 | (null) | PL | backfill-null | MANUAL | DZO Vespid 16mm (arri, Zeiss, cannon, Meike) |
| blackmagic-6k-pro-v-mount-rig-1011607 | PL | (null) | clear-mount(non-cam/lens) |  | Blackmagic 6k pro V mount rig (reclassified) |
| dji-rs-2-gimbal-sony-a7-ii-camera-combo-28-70mm-lens-950060 | (null) | E | backfill-null |  | Dji RS 2 + Sony a7 ii + 28-70mm |
| 3x-go-pro-hero-12-suction-mount-3x-1021779 | fixed | (null) | clear-mount(non-cam/lens) |  | 3x Go Pro hero 12 + Suction Mount |
| pl-to-rf-mount-adapter-pl-lens-to-canon-rf-camera-mount-conv-1097754 | PL | (null) | clear-mount(non-cam/lens) |  | PL to RF Mount Adapter |
| meike-cine-lens-fullframe-set-like-dzo-vespid-l-e-rf-pl-957959 | (null) | RF | backfill-null |  | Meike Cine Lens Set (no 'mount' word → single-token) |
| dzo-arles-prime-set-5-lenses-t1-4-25-35-50-75-100mm-dzofilm--1028856 | PL | E/RF/PL/L/X | upgrade-to-compound |  | DZO ARLES Prime set 5 lenses |
| sony-venice-6k-cinema-camera-ultimate-set-dzofilm-primes-947434 | (null) | E | backfill-null |  | Sony Venice 6k Ultimate + DZOfilm Primes |
| dzo-vespid-prime-cinema-lens-set-bmpcc-6k-pro-camera-952049 | (null) | EF | backfill-null |  | DZO Vespid set + Bmpcc 6k pro camera |
| sony-a7s-iii-4k-cinema-camera-full-frame-mirrorless-body-onl-988406 | (null) | E | backfill-null |  | Sony a7s iii Body only set |
| sony-a7siii-mirrorless-camera-24-70-lens-dji-mic-lav-kit-934081 | (null) | E | backfill-null |  | Sony a7siii + 24-70 + dji mic |
| bmpcc-6k-pro-cinema-camera-blackmagic-rs-3-pro-gimbal-kit-954077 | (null) | EF | backfill-null |  | BMPCC 6k PRO + RS 3 Pro Gimbal |
| sony-venice-6k-full-frame-cinema-camera-947433 | (null) | E | backfill-null |  | Sony venice 6k full frame (the 'venice' fix) |
| 3x-sony-a7iii-4k-mirrorless-camera-led-lights-mics-tripod-ro-938007 | (null) | E | backfill-null |  | 3x Sony a7iii + LED + Mics |
| blackmagic-pocket-cinema-camera-6k-full-frame-set-vnd-filter-1103089 | EF | (null) | clear-mount(non-cam/lens) |  | BMPCC 6K FF Set + VND (reclassified accessory) |
| 3x-go-pro-hero-12-set-2x-dji-osmo-action-5-pro-5x-128gb-sd-c-1028835 | fixed | (null) | clear-mount(non-cam/lens) |  | 3x gopro + osmo action (reclassified) |
| sony-a7-iii-camera-mirrorless-4k-flash-zoom-lens-photography-987347 | (null) | E | backfill-null |  | Sony a7 iii + flash + zoom |
| blackmagic-6k-full-frame-cinema-camera-bmpcc-blazar-remus-an-1021785 | (null) | EF | backfill-null |  | Blackmagic 6k FF + Blazar Remus |
| 4x-go-pro-hero-12-set-4x-128gb-sd-card-8x-batteries-suction--1028833 | fixed | (null) | clear-mount(non-cam/lens) |  | 4x gopro + batteries (reclassified) |
| sony-fz100-alpha-camera-batteries-2x-set-addon-1035471 | (null) | E | backfill-null |  | Sony fz100 alpha camera |
| sony-venice-6k-cinema-arri-alexa-mini-dzo-vespid-set-947438 | (null) | PL | backfill-null | MANUAL | Sony venice 6k (arri Alexa mini) + DZO Vespid |
| dzo-arles-prime-set-3-lenses-t1-4-25-50-75mm-dzofilm-pl-moun-1028859 | PL | E/RF/PL/L/X | upgrade-to-compound |  | DZO ARLES Prime set 3 lenses |
| atlas-mercury-anamorphic-cinema-lens-set-1-5x-36-45-72mm-ori-1029180 | PL | E/EF/PL/L/X | upgrade-to-compound |  | Atlas Mercury (pl,ef,x,l,e mount) |
| bmpcc-6k-pro-cinema-kit-tripod-follow-focus-tilta-nucleus-954078 | (null) | EF | backfill-null |  | BMPCC 6k PRO Kit + tripod + follow focus (package hero kept) |
| red-gemini-5k-cinema-camera-full-set-komodo-raptor-949155 | (null) | RF | backfill-null |  | Red Gemini 5k (Komodo, Raptor) |
| blazar-remus-anamorphic-cinema-prime-full-frame-silver-flare-1038953 | PL | E/EF/RF/PL/L/X | upgrade-to-compound |  | Blazar Remus set (pl,ef,e,x,l,rf mount) |
| manfrotto-190x-tripod-fluid-video-head-heavy-duty-camera-tri-1103082 | (null) | E | backfill-null |  | Manfrotto 190X Tripod (keeps camera-body — has FX3/C70 model; see Risks) |
| 2x-go-pro-hero-12-2x-suction-mounts-1021778 | fixed | (null) | clear-mount(non-cam/lens) |  | 2x Go Pro hero 12 (reclassified) |
| go-pro-hero-12-suction-mount-sd-card-2x-batteries-1021777 | fixed | (null) | clear-mount(non-cam/lens) |  | Go pro hero 12 (reclassified) |
| dzo-film-vespid-prime-cinema-lens-25mm-t2-1-full-frame-arri--958201 | (null) | PL | backfill-null | MANUAL | DZO Vespid 25mm (arri, Zeiss, cannon, Meike) |
| dzo-film-vespid-prime-cinema-lens-50mm-t2-1-full-frame-arri--958200 | (null) | PL | backfill-null | MANUAL | DZO Vespid 50mm (arri, Zeiss, cannon, Meike) |
| blackmagic-pyxis-6k-advanced-cinema-camera-set-modular-6k-ra-1103093 | PL | EF/PL | upgrade-to-compound |  | Blackmagic Pyxis 6K Advanced (PL/EF) |
| red-komodo-x-6k-cinema-camera-pro-set-2tb-card-2x-v-mounts-m-1029557 | (null) | RF | backfill-null |  | Red Komodo x 6k Pro set |
| great-joy-cine-anamorphic-lens-set-like-sirui-atlas-orion-ar-955406 | (null) | PL | backfill-null | MANUAL | Great Joy Cine Anamorphic (like Sirui, atlas, arri) |
| bmpcc-6k-pro-blackmagic-camera-senheiser-mic-zoom-lens-inter-954038 | (null) | EF | backfill-null |  | BMPCC 6k Pro + Senheiser mic + zoom |
| blackmagic-6k-full-frame-cinema-camera-bmpcc-3x-anamorphic-l-1021784 | (null) | EF | backfill-null |  | Blackmagic 6k FF + 3x Anamorphic |

### D. tier changes (37)

All are `null → premium|standard` backfills on lenses (additive), except one
clear on a reclassified item. Premium now covers real cine glass brands (DZO/
Vespid/Arles/Catta, Blazar, Atlas, Sirui, Great Joy, Sigma cine T-stop).

| slug | from | to | title |
|---|---|---|---|
| dzo-arles-prime-set-6-lenses-t1-4-14-25-35-50-75-100mm-dzofi-1028858 | (null) | premium | DZO ARLES Prime set 6 lenses |
| dzofilm-cinema-zoom-lens-full-frame-catta-ace-set-pl-ef-e-l--958051 | (null) | premium | DZOfilm Catta Ace Set |
| sigma-16-35mm-t2-0-zoom-lens-pl-mount-1025972 | (null) | premium | Sigma 16-35mm t2.0 zoom pl mount |
| anamorphic-blazar-remus-full-frame-lens-987362 | (null) | premium | Anamorphic Blazar Remus Full frame Lens |
| blazar-remus-full-frame-33mm-t1-8-1-5x-anamorphic-lens-cinem-1038954 | (null) | premium | Blazar Remus 33mm |
| anamorphic-cinema-lens-great-joy-85mm-1-8x-t2-9-amber-sirui-955329 | (null) | premium | Great joy 85mm Amber |
| sigma-18-35mm-50-100mm-t2-0-zoom-full-frame-pl-mount-1025971 | (null) | premium | Sigma 18-35 + 50-100 t2.0 pl mount |
| anamorphic-blazar-remus-100mm-1-5x-t2-8-987359 | (null) | premium | Blazar Remus 100mm |
| dzo-film-vespid-prime-cinema-lens-100mm-t2-1-full-frame-958208 | (null) | premium | DZO Vespid 100mm |
| sirui-venus-lens-set-1-66x-anamorphic-cine-e-ef-pl-955908 | (null) | premium | Sirui Venus Set 1.66x |
| great-joy-35mm-anamorphic-cine-lens-amber-flare-like-sirui-o-955391 | (null) | premium | Great Joy 35mm |
| dzo-film-vespid-prime-cinema-lens-16mm-t2-8-full-frame-arri--958202 | (null) | premium | DZO Vespid 16mm |
| atlas-orion-anamorphic-cinema-lens-set-40-65-100mm-2x-blue-f-1029181 | (null) | premium | Atlas Orion Set 2x |
| sony-full-frame-28-70mm-zoom-lens-970863 | (null) | standard | Sony Full Frame 28-70mm kit zoom |
| anamorphic-blazar-remus-lens-45mm-1-5x-t2-0-pl-mount-neutral-987356 | (null) | premium | Blazar Remus 45mm Pl mount |
| ttartisan-sony-11mm-f-2-8-fisheye-ultra-wide-lens-like-samya-1110382 | (null) | premium | TTArtisan Sony 11mm (cine match) |
| meike-cine-lens-fullframe-set-like-dzo-vespid-l-e-rf-pl-957959 | (null) | premium | Meike Cine Lens Set |
| dzo-arles-prime-set-5-lenses-t1-4-25-35-50-75-100mm-dzofilm--1028856 | (null) | premium | DZO ARLES Prime set 5 lenses |
| tilta-nucleus-m-dual-motor-wireless-follow-focus-set-fiz-han-1093194 | (null) | standard | Tilta Nucleus-M (still typed lens; see Risks) |
| 2x-cannon-lenses-16-35mm-f2-8-24-105mm-f4-usm-l-series-ef-mo-1025965 | (null) | standard | 2x Cannon EF L-series |
| sigma-50-100mm-t2-0-cinema-zoom-lens-pl-mount-1025973 | (null) | premium | Sigma 50-100mm t2.0 cinema pl mount |
| fujifilm-16-55mm-f2-8-lens-zoom-fuji-x-mount-1025997 | (null) | standard | Fujifilm 16-55mm Fuji x mount |
| sony-a7-iv-camera-4k-70-200mm-macro-zoom-lens-sony-g-f4-mk-i-1025969 | premium | (null) | a7iv + 70-200 (reclassified out of lens → tier cleared) |
| dzo-film-vespid-prime-cinema-lens-125mm-t2-1-full-frame-958206 | (null) | premium | DZO Vespid 125mm |
| cannon-16-35mm-f2-8-usm-l-ii-lens-ef-mount-1025964 | (null) | standard | Cannon 16-35mm EF L II |
| cannon-24-105-ef-f4-zoom-lens-960469 | (null) | standard | Cannon 24-105 Ef f4 |
| dzo-arles-prime-set-3-lenses-t1-4-25-50-75mm-dzofilm-pl-moun-1028859 | (null) | premium | DZO ARLES Prime set 3 lenses |
| atlas-mercury-anamorphic-cinema-lens-set-1-5x-36-45-72mm-ori-1029180 | (null) | premium | Atlas Mercury Set |
| dzo-film-vespid-prime-cinema-lens-75mm-t2-1-full-frame-958197 | (null) | premium | DZO Vespid 75mm |
| blazar-remus-anamorphic-cinema-prime-full-frame-silver-flare-1038953 | (null) | premium | Blazar Remus set |
| great-joy-50mm-anamorphic-cine-lens-amber-flare-like-sirui-a-955393 | (null) | premium | Great Joy 50mm |
| sony-a7siii-fe-zoom-lens-dji-mic-tripod-933783 | (null) | standard | Sony a7siii + FE zoom + tripod |
| dzo-film-vespid-prime-cinema-lens-25mm-t2-1-full-frame-arri--958201 | (null) | premium | DZO Vespid 25mm |
| dzo-film-vespid-prime-cinema-lens-50mm-t2-1-full-frame-arri--958200 | (null) | premium | DZO Vespid 50mm |
| anamorphic-blazar-remus-65mm-1-5x-t2-0-987357 | (null) | premium | Blazar Remus 65mm |
| dzo-film-vespid-prime-3x-cinema-lens-set-t2-1-full-frame-958242 | (null) | premium | DZO Vespid 3x set |
| great-joy-cine-anamorphic-lens-set-like-sirui-atlas-orion-ar-955406 | (null) | premium | Great Joy Cine Anamorphic Set |

### E. MANUAL-review items (12) — repair will NOT auto-apply these without sign-off

| slug | reason | itemType | mount |
|---|---|---|---|
| sony-a7siii-fx3-camera-operator-dp-947051 | service/hire | camera-body→accessory | E→(null) |
| dop-mirrorless-camera-for-hire-sony-cannon-arri-gaffer-focus-800179 | service/hire | camera-body→accessory | (null)→(null) |
| sony-venice-6k-cinema-camera-raw-set-arri-alexa-mini-947435 | PL-from-arri-guess | camera-body→camera-body | (null)→PL |
| dzo-film-vespid-prime-cinema-lens-16mm-t2-8-full-frame-arri--958202 | PL-from-arri-guess | lens→lens | (null)→PL |
| sony-venice-6k-cinema-camera-operator-dp-947436 | service/hire | camera-body→accessory | (null)→(null) |
| arri-alexa-classic-kit-operator-dp-946796 | service/hire | camera-body→accessory | (null)→(null) |
| blackmagic-bmpcc-6k-pro-kit-and-operator-dp-953367 | service/hire | camera-body→accessory | (null)→(null) |
| camera-flash-compatible-with-sony-cannon-nikon-leica-fuji-987351 | multi-brand-compat | camera-body→light | (null)→(null) |
| sony-venice-6k-cinema-arri-alexa-mini-dzo-vespid-set-947438 | PL-from-arri-guess | camera-body→camera-body | (null)→PL |
| dzo-film-vespid-prime-cinema-lens-25mm-t2-1-full-frame-arri--958201 | PL-from-arri-guess | lens→lens | (null)→PL |
| dzo-film-vespid-prime-cinema-lens-50mm-t2-1-full-frame-arri--958200 | PL-from-arri-guess | lens→lens | (null)→PL |
| great-joy-cine-anamorphic-lens-set-like-sirui-atlas-orion-ar-955406 | PL-from-arri-guess | lens→lens | (null)→PL |

> `repairTaxonomy` skips every slug in §E unless run with `includeManual: true`
> AND a matching `confirmedManualSlugs` allow-list (so a human signs off each).

---

## Known residual quirks (documented, NOT auto-changed)

- `manfrotto-190x-tripod-...-sony-fx3-canon-c70` and similar tripods that *name*
  a body model ("for Sony FX3 / Canon C70") stay `camera-body` (the model gate
  protects packages). They are borderline; left as-is to avoid stealing genuine
  packages. Backfilled mount `E` is harmless (item is grip).
- `tripod-sirui-stand-...` moves Grip→Lenses at the **category** layer only
  (the Lenses regex now matches "sirui"). itemType stays correct. Cosmetic; see
  Risks. Could be excluded by tightening the Lenses brand list — flagged.
- GoPro/Fuji single-body items remain typed `battery`/`speaker` by the
  pre-existing greedy RULES ordering — OUT OF SCOPE for this wave (not a
  camera-body false positive), left untouched.

