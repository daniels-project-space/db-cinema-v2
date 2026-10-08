/* Notifications only. Never cache account pages, documents, API responses or payments. */
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
function accountTarget(value) {
  try {
    const url = new URL(value || "/account#chat", self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || url.pathname !== "/account" || url.hash !== "#chat") return null;
    const rental = url.searchParams.get("rental"), general = url.searchParams.get("conversation");
    if ([...url.searchParams.keys()].some(key => !["rental", "conversation"].includes(key)) ||
      url.searchParams.getAll("rental").length > 1 || url.searchParams.getAll("conversation").length > 1 ||
      rental !== null && (!/^[a-zA-Z0-9_-]{1,128}$/.test(rental) || general !== null) || general !== null && general !== "general") return null;
    return url;
  } catch { return null; }
}
self.addEventListener("push", event => {
  let payload; try { payload = event.data?.json(); } catch { return; }
  const target = accountTarget(payload?.url); if (!target) return;
  event.waitUntil(self.registration.showNotification("DB Cinema Rentals", {
    body: payload.body === "Your rental team sent you a message." ? payload.body : "There is an update to your rental. Open your account to review it.",
    icon: "/db-cinema-logo-512.png", badge: "/db-cinema-logo.png", tag: String(payload.tag || "dbc-renter-update").slice(0,160), data: {url:target.href},
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close(); const target = accountTarget(event.notification.data?.url); if (!target) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for (const client of windows) {
      try {
        const url = new URL(client.url); if(url.origin!==target.origin||url.pathname!=="/account")continue;
        const opened=await client.navigate(target.href); if(opened)return opened.focus();
      } catch {}
    }
    return self.clients.openWindow(target.href);
  })());
});
