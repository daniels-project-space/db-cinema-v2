// Stable anonymous browser id for first-party analytics (no PII).
let memoryId: string | undefined;
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  if (memoryId) return memoryId;
  try { const saved = localStorage.getItem("dbc_sid"); if (saved) return memoryId = saved; } catch { /* Storage can be disabled without disabling analytics. */ }
  memoryId = crypto.randomUUID();
  try { localStorage.setItem("dbc_sid", memoryId); } catch { /* Keep the id stable for this page session. */ }
  return memoryId;
}
