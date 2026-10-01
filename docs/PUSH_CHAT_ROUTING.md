# Owner phone notification chat routing

Notification URLs now contain either `rental=<bookingId>` or `account=<accountId>` for general support, followed by `#messages`. The delivery worker and browser share the route contract. No login token or customer details are included in these links.

The notification worker prefers an existing owner window and preserves customer shopping tabs. It navigates to the exact URL and posts a scoped routing message, then focuses the owner window. Missing/closed windows use a new window. External origins, wrong paths, mixed thread identifiers and duplicate identifiers are rejected.

The admin page processes initial URLs, history/hash navigation and worker messages. Each explicit navigation resets inbox filters and opens the chosen rental/support conversation, even when that same URL was used earlier. General support is fetched directly by account ID, so a thread outside the initial page is still reachable. Unavailable threads never fall back to a different renter.

Chat scrolls into view and to the newest messages. A same-thread tap keeps its unsent draft. A locked owner login retains the destination; existing server authorization still gates all message reads and owner controls. Enabled push installations refresh the worker without requesting permission again or replacing the existing subscription.

## Verification

- Actual service-worker event-handler regression tests: rental/support payloads, existing/cold windows, focused owner preference, shopping tabs preserved, closed-window fallback and unsafe destinations.
- Backend payload tests assert actual delivery-handler URL construction; owner-only direct support lookup is tested.
- Full suite, TypeScript and production build pass.
- Staging browser/API: real owner login into notification destination, rental/support switching, repeated URL after changing stage, same-thread draft retention, cold support link, desktop/mobile chat visibility and no overflow. Screenshots inspected.
- These checks exercise routing and browser behavior. A physical iPhone notification tap and OS popup have not been independently observed from this workspace.
