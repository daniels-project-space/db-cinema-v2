import { EXCLUDED_ANALYTICS_PREFIX, isAutomatedBrowser } from "../../shared/analyticsTraffic";

// Stable anonymous browser id for first-party analytics (no PII).
let memoryId: string | undefined;
let internalBrowser = false;

/** Persistent opt-out for admin and QA browsers, including subsequent public pages. */
function excludedTraffic(): "bot" | "internal" | undefined {
  if (isAutomatedBrowser(navigator.userAgent, navigator.webdriver === true)) return "bot";
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/") ||
      new URLSearchParams(window.location.search).get("analytics") === "off") internalBrowser = true;
  try {
    if (localStorage.getItem("dbc_admin") || localStorage.getItem("dbc_analytics_exclude") === "1") internalBrowser = true;
    if (internalBrowser) localStorage.setItem("dbc_analytics_exclude", "1");
  } catch { /* Keep the opt-out in memory when storage is unavailable. */ }
  return internalBrowser ? "internal" : undefined;
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  const excluded = excludedTraffic();
  if (excluded) return EXCLUDED_ANALYTICS_PREFIX + excluded;
  if (memoryId) return memoryId;
  try { const saved = localStorage.getItem("dbc_sid"); if (saved) return memoryId = saved; } catch { /* Storage can be disabled without disabling analytics. */ }
  memoryId = crypto.randomUUID();
  try { localStorage.setItem("dbc_sid", memoryId); } catch { /* Keep the id stable for this page session. */ }
  return memoryId;
}
