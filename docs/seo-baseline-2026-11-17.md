# DB Cinema Rentals search baseline — 17 November 2026

This is a point-in-time investigation, not a guarantee of Google indexing, ranking or traffic. The OpenSEO project is `DB Cinema Rentals` (`dbcinemarentals.com`, UK/English). No recurring checks were enabled.

## Search visibility

OpenSEO's national UK automated Google reads on 17 November returned the following observations. `bestPosition` is the best observed position, not an average or a fixed rank; Google results differ by location, device and time.

| Query | Device | Observation |
| --- | --- | --- |
| camera hire london | desktop | Lens-hire page appeared in 3 of 3 reads; best position 11. |
| DB Cinema Rentals | desktop | No matching domain in the returned results at requested depth 50. |
| DB Cinema Rentals | mobile | Site appeared in 2 of 3 reads; best position 1. |
| "DB Cinema Rentals" | desktop | Homepage appeared in 1 of 3 reads; best position 1. This is weak evidence. |
| lens hire london | desktop | Lens-hire page appeared in 1 of 3 reads; best position 16. This is weak evidence. |

The site's `site:` search returned no organic rows in that tool, despite the other results above. A `site:` query is not a complete indexing report; do not infer that the domain is unindexed. Search Console was not connected or required for this investigation. OpenSEO's domain keyword and traffic figures are third-party estimates, not actual visits.

Keyword research estimated 390 UK monthly searches for `camera rental london`, 260 for `camera hire london`, 260 for `london video camera hire`, 50 for `camera gear rental london` and 30 for `lens hire london`. These are estimates, and close variants can share underlying volumes; do not sum them. The remaining FX3 and film-equipment seed lookups did not complete because the tool reported insufficient credits.

## Crawl and technical findings

OpenSEO audit `9a905dd4-f61b-44a1-8ff3-bcdad83facec` completed at the free-plan limit of 50 pages: all 50 returned HTTP 200 and were reported indexable. Its 44 reported rows comprised the page-limit warning, 28 titles over its heuristic threshold, 12 descriptions over its threshold and 3 heading-order notices. The 50-page cap means this is not a whole-site audit. Character thresholds are heuristics, not Google ranking rules.

An independent HTTP check of the live sitemap found 149 URLs; all returned 200, with one H1, no `noindex` and a matching declared canonical. This checks the fetched response, not Google's own crawl or indexing decisions. The baseline sitemap included `lastmod` on 118 entries. The discovery API derives that value from copy-review or creation time, not the last material change to the complete listing; this change omits it until a reliable page-wide timestamp is available. No real-user Core Web Vitals or Search Console coverage data were available.

The main, `www` and public Vercel hosts returned pages directly; the latter two declared the main domain as canonical. Permanent redirects may strengthen canonical signals, but they are not safe to enable blindly: renter sessions (`dbc_acct`), baskets (`dbc_cart_v1`), promo and membership selections are stored in origin-scoped browser storage. A blanket redirect can lose existing sessions and in-progress baskets, including users returning from third-party verification or payment flows. Before changing host routing, design and qualify a secure migration for existing browser state, test both hostnames and callback/checkout flows, and verify provider configuration. Do not transfer bearer tokens in URLs or expose them to third parties.

Camera directory pagination exposes `?after=` links and distinct self-canonicals. Preserve the links and product discovery while reviewing duplicate or stale cursor behaviour; a pagination canonical is not inherently an error. Product entries have individual sitemap URLs. Keep timestamps tied to real material updates; do not fabricate freshness.

## Local business and backlinks

OpenSEO's name lookup returned no matching Google Business Profile. This does not prove that none exists, is unclaimed, or is ineligible. Verify ownership, categories, opening times, public telephone and website; show an address only if it is a genuine eligible customer-facing location. The public site currently publishes a London locality rather than a street address. No profile was created or claimed.

OpenSEO estimated 37 referring domains but returned only one in its filtered referring-domain breakdown, so neither count establishes a reliable complete link profile. First inspect actual linking and target URLs before drawing conclusions or taking removal/disavow action. Potential outreach candidates should be genuine partners: the existing Hygglo profile, studios, filmmakers, production companies and film educators with an actual relationship or useful resource. No messages, listings, purchases, disavows or outreach were made.

## Measurement

Repeat a small, consistent set of UK and London searches on the same device and record date, location, query, observed URL and position. Sample branded, camera hire/rental, lens hire and FX3 queries. Use a privacy-appropriate analytics setup to measure organic landing pages and completed enquiries/bookings; do not conflate impressions, clicks, sessions and transactions. Search Console would provide the strongest first-party query and indexing evidence if explicitly connected later, but this work proceeds without it. No tracking integration or recurring paid schedule is authorised by this baseline.
