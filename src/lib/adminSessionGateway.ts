import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

export function adminSessionGatewayReady(): boolean {
  return false;
}

export function makeAdminSessionAttestation(identityDigest: string, clientIp: string, secret: string, issuedAt = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(identityDigest) || !/^[a-f0-9]{64}$/.test(secret) || !Number.isSafeInteger(issuedAt) || !isIP(clientIp))
    throw Error("Invalid gateway context");
  const ip = isIP(clientIp) === 6 ? new URL(`http://[${clientIp}]/`).hostname.toLowerCase() : clientIp;
  const key = Buffer.from(secret, "hex");
  const clientDigest = createHmac("sha256", key).update(`dbc-admin-client-v2|${ip}`).digest("hex");
  const nonce = randomBytes(32).toString("hex");
  const message = `dbc-admin-session-v2|${identityDigest}|${clientDigest}|${nonce}|${issuedAt}`;
  return { clientDigest, nonce, issuedAt, mac: createHmac("sha256", key).update(message).digest("hex") };
}
