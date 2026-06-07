// Stable anonymous session id for first-party analytics (no PII).
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("dbc_sid");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("dbc_sid", id);
  }
  return id;
}
