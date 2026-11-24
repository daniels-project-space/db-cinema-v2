export const RETURN_EVIDENCE_LINK_TTL_MS = 30 * 24 * 60 * 60_000;
export const RETURN_EVIDENCE_DOWNLOAD_TTL_MS = 15 * 60_000;

export type ReturnEvidenceLinkClaims = {
  v: 1;
  bookingId: string;
  caseId: string;
  expiresAt: number;
  recipientHash: string;
  downloadExpiresAt?: number;
  fileIndex?: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid evidence link.");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function returnEvidenceRecipientHash(email: string, secret: string): Promise<string> {
  if (secret.length < 24) throw new Error("Return evidence recipient verification is not configured.");
  const normalized = email.trim().toLowerCase();
  const key = await hmac(secret);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`dbc-return-evidence-recipient-v1.${normalized}`)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signReturnEvidenceLink(claims: ReturnEvidenceLinkClaims, secret: string): Promise<string> {
  if (secret.length < 24) throw new Error("Return evidence link signing is not configured.");
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await hmac(secret), new TextEncoder().encode(`dbc-return-evidence-v1.${encoded}`));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyReturnEvidenceLink(token: string, secret: string, now = Date.now()): Promise<ReturnEvidenceLinkClaims | null> {
  if (secret.length < 24 || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const payloadBytes = base64UrlDecode(parts[0]);
    const signature = base64UrlDecode(parts[1]);
    if (base64UrlEncode(payloadBytes) !== parts[0] || base64UrlEncode(signature) !== parts[1]) return null;
    if (signature.length !== 32) return null;
    const signatureBuffer = new ArrayBuffer(signature.byteLength);
    new Uint8Array(signatureBuffer).set(signature);
    const valid = await crypto.subtle.verify("HMAC", await hmac(secret), signatureBuffer, new TextEncoder().encode(`dbc-return-evidence-v1.${parts[0]}`));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
    if (!value || value.v !== 1 || typeof value.bookingId !== "string" || value.bookingId.length < 3 || value.bookingId.length > 128 ||
        typeof value.caseId !== "string" || value.caseId.length < 3 || value.caseId.length > 128 ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + RETURN_EVIDENCE_LINK_TTL_MS ||
        typeof value.recipientHash !== "string" || !/^[a-f0-9]{64}$/.test(value.recipientHash)) return null;
    const hasIndex = value.fileIndex !== undefined;
    const hasDownloadExpiry = value.downloadExpiresAt !== undefined;
    if (hasIndex !== hasDownloadExpiry) return null;
    if (hasIndex && (!Number.isSafeInteger(value.fileIndex) || value.fileIndex < 0 || value.fileIndex > 4 ||
        !Number.isSafeInteger(value.downloadExpiresAt) || value.downloadExpiresAt <= now ||
        value.downloadExpiresAt > now + RETURN_EVIDENCE_DOWNLOAD_TTL_MS)) return null;
    return value as ReturnEvidenceLinkClaims;
  } catch {
    return null;
  }
}
