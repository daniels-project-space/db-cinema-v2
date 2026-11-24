import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const BUSINESS_GMAIL_ADDRESS = "info@dbcinemarentals.com";

function encryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  return key;
}

export function encryptGmailRefreshToken(token: string, encodedKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGmailRefreshToken(encrypted: string, encodedKey: string): string {
  const [version, rawIv, rawTag, rawCiphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !rawIv || !rawTag || !rawCiphertext || extra) throw new Error("Stored Gmail credential has an unsupported format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encodedKey), Buffer.from(rawIv, "base64url"));
  decipher.setAuthTag(Buffer.from(rawTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(rawCiphertext, "base64url")), decipher.final()]).toString("utf8");
}
