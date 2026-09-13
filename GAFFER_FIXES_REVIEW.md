# Gaffer fixes — 13 September 2026

Pre-release review completed on 13 September 2026. Daniel subsequently authorized publishing. The checks below record the pre-release evidence; the deployment sequence identifies the required production targets and verification.

- **Ten-minute reset:** live ElevenLabs agent `agent_4601kvk2pfznfrws6ah700jnxvfv` was verified to have `max_duration_seconds: 600`. The rollout sets 3600 seconds. The browser now carries previous conversation/tool outcomes and the current basket into its bounded reconnect. A deliberate hang-up clears the in-memory history; it is not written to browser storage. Existing models, voice and idle-call limits remain unchanged. Longer active calls can incur more usage.
- **Requested better price:** a real user request enables `request_better_price`. The code applies 10% when the rental subtotal is strictly above £400. Existing offer add-ons count toward that threshold but receive no additional discount. Deposits/delivery do not qualify or receive the saving. Checkout recalculates prices server-side and rechecks the threshold; percentage discounts remain non-stacking, retaining a better existing discount.
- **FORM / SEVEN:** the voice prompt, partner knowledge document and text-chat facts explicitly describe an AI advertising agency and AI-produced ads. The live site states “AI-enabled production”; the owner supplied the agency classification. Removed wording implying a physical shoot crew or that FORM / SEVEN needs rented cameras. Free samples are requests reviewed before production. Source: https://form7.net, retrieved 2026-09-13.
- **Scrolling:** tools wait for the actual route and loaded results, scroll the specific returned listings into view, and return a loading outcome if the target is unavailable. The catalogue displays the voice engine's matched IDs, so spoken aliases cannot produce a different literal-search result.
- **Basket:** showing another selection closes the drawer. Unfiltered navigation clears earlier category/search parameters.

## Verification

- Production Next.js build and TypeScript: passed.
- `node scripts/test-gaffer-fixes.cjs`: passed. Exercises actual price-query, checkout-action and voice-provider callbacks using controlled service boundaries; no booking or payment is created. Includes £400/£400.01, mixed offer baskets, tampered client totals, deposits/delivery, shrinking baskets, better existing codes, fresh reconnect context, stale callbacks, sign-off and deliberate reset. The final audit also tests that catalogue navigation and browsing report a loading timeout instead of claiming items are on screen.
- `PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-gaffer-browser.cjs`: passed against the local preview and real Convex catalogue at 1365px and 390px. Includes a 650ms navigation delay, recommendation, specific selection, basket closure, category scroll and clearing filters. Screenshots inspected at `/tmp/dbc-gaffer-1365.png` and `/tmp/dbc-gaffer-390.png`.
- `node --env-file=.env.local scripts/gaffer-fixes-sync.js`: dry run passed; live prompt matches the repository baseline, first-message overrides are enabled, and the proposed change retains all 13 other knowledge documents.
- Local Graphify graph updated and excluded from deployment inputs.

## Deployment sequence

1. Deploy the Convex changes to `veracious-wombat-196` first (`npx convex dev --once --typecheck enable` with the verified local configuration), then verify `promo:validate` on both sides of the £400 threshold and with excluded add-on amounts. This extends the existing query compatibly for the old frontend. The public website uses this deployment even though Convex labels it dev. Do not use plain `convex deploy`: it selects the unrelated `zany-wolf-18` production deployment. A dry run caught that mismatch and made no changes.
2. Provider read access was verified through `codex-vault-exec vercel VERCEL_TOKEN=VERCEL_TOKEN`; the ordinary CLI login could not read the project. The current READY production deployment is `dpl_8LPrnvkZ6KDXcA5EDCUY3MpyRuuk`, commit `4ff74bf55389f8c070516d59de348ff0894cc037`, with the exact public alias confirmed by the provider. Publish the reviewed website changes to Vercel project `db-cinema-v2` and verify the READY deployment and exact alias `dbcinemarentals.com`.
3. Run `node --env-file=.env.local scripts/gaffer-fixes-sync.js --apply`. This only changes call duration, the prompt, the new tool registration and the partner knowledge reference. It verifies the fetched result and retains the old partner document for rollback.
4. Recheck the production UI/tool flow. A real paid voice call longer than ten minutes has not been performed; reconnect continuity was verified with simulated transport callbacks.

The production publishing gate in `/root/AGENTS.md:19` was satisfied by Daniel’s explicit “publish” instruction. No outbound messages, stock reservations, customer orders or payments were made during verification.
