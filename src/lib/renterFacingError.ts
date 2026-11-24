const technicalError = /(?:\b(?:ConvexError|StripeError|TypeError|ReferenceError|SyntaxError|RangeError|ECONN[A-Z_]*|ETIMEDOUT|EAI_AGAIN|JWT|stack trace|internal (?:query|mutation|action|function)|webhook|authorization|bearer\s|private key|secret|request_id)\b|\[CONVEX\b|\bat\s+[\w.$<>]+\s*\(|\b(?:\/home\/|\/root\/|\/var\/|\/tmp\/)|(?:\.tsx?:\d+:\d+))/i;

function messageFrom(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const value = error as { message?: unknown; data?: { message?: unknown } };
  return typeof value.data?.message === "string" ? value.data.message : typeof value.message === "string" ? value.message : "";
}

export function renterFacingError(error: unknown, fallback: string): string {
  const raw = messageFrom(error).trim();
  if (!raw) return fallback;
  if (/failed to fetch|networkerror|network request failed|timed? ?out|connection (?:was )?lost/i.test(raw))
    return "Connection problem. Check your connection and try again.";
  if (/unauthori[sz]ed|session (?:has )?expired|sign in again/i.test(raw))
    return "Please sign in again, then retry.";

  const message = raw.replace(/^(?:Uncaught\s+)?(?:ConvexError|Error):\s*/i, "").trim();
  if (!message || message.length > 220 || /[\r\n\u0000-\u001f]/.test(message) || technicalError.test(message)) return fallback;
  return message;
}
