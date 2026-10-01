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
  const target = new URL(event.notification.data?.url || "/admin#messages", self.location.origin);
  if (target.origin !== self.location.origin || target.pathname !== "/admin") return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const window of windows) if (new URL(window.url).origin === target.origin) { await window.navigate(target.href); return window.focus(); }
    return self.clients.openWindow(target.href);
  })());
});
