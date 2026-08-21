/**
 * Microphone permission, as far as the browser will let us see it.
 *
 * The permission dialog itself belongs to the browser — it is drawn by Chrome
 * next to the address bar and cannot be restyled, moved or pre-answered, by
 * design. What we can do is stop it arriving unexplained: show our own panel
 * first saying what the mic is for, trigger the real prompt from a button in
 * it, and handle a refusal with something better than a call that quietly
 * fails to start.
 */

export type MicState = "granted" | "prompt" | "denied";

/** Remembers that we've already explained ourselves, for browsers that won't tell us. */
const EXPLAINED_KEY = "dbc_mic_explained";

export function hasBeenExplained(): boolean {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markExplained() {
  try {
    localStorage.setItem(EXPLAINED_KEY, "1");
  } catch {
    /* private mode — we'll just explain again */
  }
}

/**
 * Safari and Firefox don't implement the microphone permission query, so a
 * failure here means "we can't tell", not "not allowed". In that case fall back
 * to whether we've explained before: ask once, then trust the browser to
 * remember.
 */
export async function micState(): Promise<MicState> {
  if (typeof navigator === "undefined") return "prompt";
  try {
    const status = await (navigator as any).permissions?.query({ name: "microphone" as PermissionName });
    if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
      return status.state;
    }
  } catch {
    /* not supported — fall through */
  }
  return hasBeenExplained() ? "granted" : "prompt";
}

/**
 * Actually ask. Returns the mic track so the caller can release it immediately —
 * holding it open would leave the recording indicator lit before the call has
 * even started, which reads as the site listening in.
 */
export async function requestMic(): Promise<{ ok: true } | { ok: false; reason: MicState | "error" }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    markExplained();
    return { ok: true };
  } catch (err: any) {
    const name = String(err?.name ?? "");
    if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, reason: "denied" };
    return { ok: false, reason: "error" };
  }
}
