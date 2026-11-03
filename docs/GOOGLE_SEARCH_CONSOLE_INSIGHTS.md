# Google Search Console Insights

The admin Insights panel reads real Google web-search performance through the Search Console API. It uses read-only OAuth credentials and the URL-prefix property `https://dbcinemarentals.com/`. Search data is fetched server-side only after the admin passcode is verified; Google credentials are never sent to the browser or stored in Convex.

## Secure setup

1. In Google Cloud, enable the Search Console API and create a dedicated OAuth client for this website integration.
2. Grant the Google account represented by the OAuth refresh token read access to the `https://dbcinemarentals.com/` Search Console property.
3. Generate a refresh token using the `https://www.googleapis.com/auth/webmasters.readonly` scope.
4. Add these as encrypted production environment variables in the existing Vercel project. Never paste the client secret or refresh token into chat, a source file, or a public environment variable:
   - `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`
   - `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`
   - `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`
5. Redeploy from the Git-connected production pipeline, then open Admin → Insights and use Refresh.

The report requests finalized `web` results only. It covers the selected 7/30/90 complete days ending three days before the current Pacific date, since Search Console data typically arrives with a 2–3 day delay. Totals come from date-grouped rows; query and page tables are Google's available top rows and can omit privacy-protected low-volume queries.

Search Console Performance does not supply crawl-request counts. Its clicks are shown separately from first-party site visits; crawler requests are not relabeled as clicks. This project excludes recognized bots, headless browsers, test tools, and the admin browser from its first-party browser analytics, but server-log crawler counts are not currently connected.
