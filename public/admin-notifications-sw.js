/* No fetch handler or page caching: this worker only delivers owner notifications. */
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || "DB Cinema Rentals", {
    body: payload.body || "A rental conversation needs your attention.",
    icon: "/db-cinema-logo-512.png", badge: "/db-cinema-logo.png",
    tag: payload.tag || "dbc-rental-message", data: { url: payload.url || "/admin#messages" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  let target;
  try { target = new URL(event.notification.data?.url || "/admin#messages", self.location.origin); } catch { return; }
  if (target.origin !== self.location.origin || target.pathname !== "/admin") return;
  const rental = target.searchParams.get("rental"), account = target.searchParams.get("account");
  if ((rental && account) || target.searchParams.getAll("rental").length > 1 || target.searchParams.getAll("account").length > 1 ||
    [rental, account].some(id => id !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return;
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
