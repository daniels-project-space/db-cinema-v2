"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function OwnerNotificationBell({ token }: { token: string }) {
  const [deviceId, setDeviceId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const device = useQuery(api.adminNotifications.device, deviceId ? { token, deviceId } : "skip");
  const subscribe = useMutation(api.adminNotifications.subscribe), disable = useMutation(api.adminNotifications.disable);
  useEffect(() => {
    let id = localStorage.getItem("dbc_owner_push_device");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("dbc_owner_push_device", id); }
    setDeviceId(id);
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }, []);
  async function toggle() {
    if (!deviceId || busy) return;
    setBusy(true); setError(null);
    try {
      if (device?.enabled) {
        await disable({ token, deviceId });
        const worker = await navigator.serviceWorker.getRegistration("/admin");
        await (await worker?.pushManager.getSubscription())?.unsubscribe();
        return;
      }
      if (!supported) throw Error("On iPhone, add this site to your Home Screen, open it there, then enable the bell.");
      if (!device?.configured || !device.publicKey) throw Error("Phone notifications are not configured yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw Error("Allow notifications in your browser settings to enable phone alerts.");
      const registration = await navigator.serviceWorker.register("/admin-notifications-sw.js", { scope: "/admin" });
      // This scoped worker must be active before it can subscribe; /admin is its scope.
      await new Promise<void>((resolve, reject) => {
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker) { reject(Error("Notification worker unavailable.")); return; }
        if (worker.state === "activated") { resolve(); return; }
        const timeout = setTimeout(() => reject(Error("Notifications took too long to initialise. Try again.")), 15000);
        worker.addEventListener("statechange", () => { if (worker.state === "activated") { clearTimeout(timeout); resolve(); } });
      });
      let subscription = await registration.pushManager.getSubscription();
      const raw = atob(device.publicKey.replace(/-/g,"+").replace(/_/g,"/"));
      const key = Uint8Array.from(raw, char => char.charCodeAt(0));
      if (subscription?.options.applicationServerKey && Array.from(new Uint8Array(subscription.options.applicationServerKey)).join(",") !== Array.from(key).join(",")) { await subscription.unsubscribe(); subscription = null; }
      if (!subscription) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { subscription = await Promise.race([
          registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error("Your browser's push service did not respond. Please try again.")), 20000); }),
        ]); } finally { if (timeout) clearTimeout(timeout); }
      }
      const data = subscription.toJSON();
      if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw Error("Browser returned an incomplete subscription.");
      await subscribe({ token, deviceId, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth });
    } catch (e: any) { setError(e.message ?? "Phone alerts could not be changed."); }
    finally { setBusy(false); }
  }
  return <div className="relative">
    <button type="button" onClick={toggle} disabled={busy || !device} aria-label={device?.enabled ? "Disable phone alerts" : "Enable phone alerts"} aria-pressed={device?.enabled ?? false} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${device?.enabled ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-white/10 text-white/50"}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={device?.enabled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5"><path d="M18 8a6 6 0 00-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/></svg>{busy ? "Updating…" : device?.enabled ? "Phone alerts on" : "Phone alerts"}
    </button>
    {(error || device?.lastError) && <p role="alert" className="mt-2 max-w-xs text-xs text-amber-200">{error ?? device?.lastError}</p>}
  </div>;
}
