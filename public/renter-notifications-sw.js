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
const notificationCopy = {
  chat_message: {title:"New rental reply",body:"Open your rental chat."},
  support_reply: {title:"Support replied",body:"Open your support chat."},
  verification_progress: {title:"Verification update",body:"Check your account."},
  verification_approved: {title:"Verification passed",body:"Check your booking status."},
  verification_review: {title:"Team review",body:"We’ll update your rental chat."},
  verification_action: {title:"Verification action needed",body:"Continue in your account."},
  rental_action: {title:"Rental action",body:"Review your rental chat."},
  rental_update: {title:"Rental update",body:"Check your account."},
  delivery_quote: {title:"Delivery quote ready",body:"Review it in your rental chat."},
  extension_options: {title:"Extension options",body:"Review available items in your rental chat."},
  extension_payment: {title:"Extension approved",body:"Pay in your rental chat to confirm."},
  kit_change: {title:"Kit change update",body:"Review the items in your rental chat."},
  rental_price: {title:"Rental price proposal",body:"Review and accept in your rental chat."},
  credit_offer: {title:"Credit offer ready",body:"Review it in your rental chat."},
  payment_link: {title:"Rental link ready",body:"Open your rental chat to continue."},
  gear_recommendation: {title:"Gear suggestions",body:"See Gaffer’s picks in your rental chat."},
  checkout_kit: {title:"Kit ready to review",body:"Open the checkout link in your rental chat."},
  review_invitation: {title:"Review your rental",body:"Share feedback in your rental chat."},
};
self.addEventListener("push", event => {
  let payload; try { payload = event.data?.json(); } catch { return; }
  const target = accountTarget(payload?.url); if (!target) return;
  const copy = Object.prototype.hasOwnProperty.call(notificationCopy, payload.notice) ? notificationCopy[payload.notice] : notificationCopy.rental_update;
  event.waitUntil(self.registration.showNotification(copy.title, {
    body: copy.body,
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
