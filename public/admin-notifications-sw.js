/* No fetch handler or page caching: this worker only delivers owner notifications. */
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
const notificationCopy = {
  message: { title: "New renter message", body: "Open Messages to read and reply." },
  team_request: { title: "Renter needs the team", body: "Open Messages to continue the conversation." },
  conversation: { title: "Conversation update", body: "Open Messages for the latest context." },
  verification_action: { title: "Verification needs attention", body: "Open the rental to review." },
  verification_update: { title: "Verification update", body: "Open the rental for current status." },
  account_match: { title: "Possible account match", body: "Compare records in the admin panel." },
  payment_received: { title: "Payment received", body: "Open Admin to see the rental’s current status." },
  rental_attention: { title: "Rental needs attention", body: "Open the rental to review the next step." },
  cancellation_update: { title: "Cancellation update", body: "Open the rental for current status." },
  payment_attention: { title: "Payment needs attention", body: "Open the rental to check status." },
  refund_attention: { title: "Refund needs attention", body: "Open the rental to review it." },
  dispute_update: { title: "Payment dispute update", body: "Open the admin panel to review." },
  email_attention: { title: "Email needs attention", body: "Open the admin panel to check delivery." },
  email_update: { title: "Email update", body: "Open the admin panel for status." },
  team_update: { title: "Team update", body: "Open the admin panel for details." },
};
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch {}
  const copy = Object.prototype.hasOwnProperty.call(notificationCopy, payload.notice) ? notificationCopy[payload.notice] : notificationCopy.team_update;
  event.waitUntil(self.registration.showNotification(copy.title, {
    body: copy.body,
    icon: "/db-cinema-logo-512.png", badge: "/db-cinema-logo.png",
    tag: payload.tag || "dbc-rental-message", data: { url: payload.url || "/admin#messages" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  let target;
  try { target = new URL(event.notification.data?.url || "/admin#messages", self.location.origin); } catch { return; }
  if (target.origin !== self.location.origin || target.pathname !== "/admin") return;
  const rental = target.searchParams.get("rental"), account = target.searchParams.get("account"), emailThread = target.searchParams.get("emailThread");
  if ([rental, account, emailThread].filter(Boolean).length > 1 || ["rental", "account", "emailThread"].some(key => target.searchParams.getAll(key).length > 1) ||
    [rental, account, emailThread].some(id => id !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const owners = windows.filter(window => {
      try { const url = new URL(window.url); return url.origin === target.origin && url.pathname === "/admin"; } catch { return false; }
    }).sort((a, b) => Number(b.focused) - Number(a.focused));
    for (const window of owners) {
      try {
        const opened = await window.navigate(target.href);
        if (!opened) continue;
        opened.postMessage({ type: "dbc:open-owner-conversation", url: target.href });
        return await opened.focus();
      } catch { /* A window may close while the notification is being opened. */ }
    }
    return self.clients.openWindow(target.href);
  })());
});
