import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], part => parseInt(part, 16));
const validHex = (value: string) => /^[a-f0-9]{64}$/.test(value);
const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export const issue = internalAction({
  args: { attestation: v.object({ clientDigest: v.string(), nonce: v.string(), issuedAt: v.number(), mac: v.string() }) },
  handler: async (ctx, { attestation }): Promise<{ token: string; expiresAt: number } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.tokenIdentifier !== "string" || identity.tokenIdentifier.length > 512) return null;
    const configuration = process.env.ADMIN_SESSION_SCOPES_V2;
    const keyHex = process.env.ADMIN_SESSION_GATEWAY_HMAC_V2;
    if (!configuration || configuration.length > 16_384 || !keyHex || !/^[a-f0-9]{64}$/.test(keyHex)) return null;
    let assignments: unknown;
    try { assignments = JSON.parse(configuration); } catch { return null; }
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments) ||
        !Object.prototype.hasOwnProperty.call(assignments, identity.tokenIdentifier)) return null;
    const scopes: unknown = (assignments as Record<string, unknown>)[identity.tokenIdentifier];
    if (!Array.isArray(scopes) || !scopes.every(scope => typeof scope === "string")) return null;
    if (!validHex(attestation.clientDigest) || !validHex(attestation.nonce) || !validHex(attestation.mac) ||
        !Number.isSafeInteger(attestation.issuedAt)) return null;
    const identityDigest = await sha256(identity.tokenIdentifier);
    const message = `dbc-admin-session-v2|${identityDigest}|${attestation.clientDigest}|${attestation.nonce}|${attestation.issuedAt}`;
    const key = await crypto.subtle.importKey("raw", fromHex(keyHex) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, fromHex(attestation.mac) as BufferSource, encoder.encode(message))) return null;
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = hex(random);
    const tokenDigest = await sha256(token);
    const nonceDigest = await sha256(attestation.nonce);
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const admitted: boolean = await ctx.runMutation(internal.adminSessionsV2.admitAndCreateSession, {
      clientDigest: attestation.clientDigest, nonceDigest, issuedAt: attestation.issuedAt,
      tokenDigest, principalId: `admin:${identityDigest}`, scopes, expiresAt,
    });
    return admitted ? { token, expiresAt } : null;
  },
});
