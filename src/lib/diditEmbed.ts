const diditOrigin = "https://verify.didit.me";

export function getDiditEmbeddedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== diditOrigin || url.username || url.password) return null;
    url.searchParams.set("sdk_presentation", "embedded");
    return url.toString();
  } catch {
    return null;
  }
}

export function getDiditStandaloneUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== diditOrigin || url.username || url.password) return null;
    url.searchParams.delete("sdk_presentation");
    return url.toString();
  } catch {
    return null;
  }
}

export function getDiditLayoutHeight(event: MessageEvent, frameWindow: Window | null): number | null {
  if (event.origin !== diditOrigin || !frameWindow || event.source !== frameWindow) return null;
  if (!event.data || typeof event.data !== "object" || event.data.type !== "didit:layout") return null;
  const height = event.data.data?.contentHeight;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return null;
  return Math.min(1600, Math.max(320, Math.round(height)));
}
