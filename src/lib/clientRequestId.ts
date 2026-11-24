let fallbackSequence = 0;

export function createClientRequestId() {
  const browserCrypto = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") return browserCrypto.randomUUID();
  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(18);
    browserCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  fallbackSequence += 1;
  return `client_${Date.now().toString(36)}_${fallbackSequence.toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}
