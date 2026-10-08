# Reproducible site fonts

The dashboard CI build at `fcc54cb1898006f91c647c2ad8a01ea1de519169` failed inside Next 16.2.7's Google-font loader (`next/font/google queries have exactly one entry`), before the browser checks. The same source built locally and on Vercel. This change removes that build-time font fetch and loader dependency.

`public/fonts` contains the exact 23 WOFF2 files from the successful production build, with SHA-256 receipts in `manifest.json` and the five SIL Open Font Licences. `src/app/fonts.css` preserves all 43 original faces, including unicode subsets, variable weights, normal/italic faces, fallback metrics and `font-display: swap`. Only the asset URLs change. The root retains the original variable class names and six latin preload choices through `siteFonts.ts`. No public component layouts or application providers change.

Validation: production Next build, TypeScript and the existing full npm test suite passed. A native Chrome 154 capture of the real local `/`, `/gear` and empty `/checkout` pages before and after showed identical five font variables, font-face definitions/loading status, and the first 15 visible main heading/button font families, sizes, weights and bounding dimensions. Screenshots were inspected at `/root/dbc-font-retention-review`. Animated branding/backgrounds prevent whole-screen pixel equality. This does not claim a completed live payment or populated checkout regression.

The prior full cart-clear/reload browser failure remains separately open. These fonts do not change that test or remove any of its assertions. Hosted CI and source-matched preview still require verification after this commit; no production or backend publication is included.
