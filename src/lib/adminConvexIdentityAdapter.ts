import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

type AdminIdentity = { jwt: string };

export function createAdminConvexIdentityAdapter(convexUrl: string, scope: string) {
  const url = new URL(convexUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud") || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[a-z]+:(read|write)$/.test(scope))
    throw Error("Invalid admin identity configuration.");
  let credential: string | null = null;

  function setCredential(jwt: string): void {
    if (jwt.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) throw Error("Invalid identity credential.");
    credential = jwt;
  }
  function clearCredential(): void { credential = null; }
  async function getIdentity(): Promise<AdminIdentity | null> { return credential ? { jwt: credential } : null; }
  async function fetchAccessToken(): Promise<string | null> { return credential; }
  function client(identity: AdminIdentity): ConvexHttpClient {
    const result = new ConvexHttpClient(url.origin);
    result.setAuth(identity.jwt);
    return result;
  }
  async function validate(token: string, identity: AdminIdentity): Promise<boolean> {
    if (credential !== identity.jwt) return false;
    const result = await client(identity).query(api.adminAccountSessionV2.checkSession, { token, scope });
    return credential === identity.jwt && result.ok === true;
  }
  async function revoke(token: string, identity: AdminIdentity): Promise<void> {
    await client(identity).mutation(api.adminAccountSessionV2.signOut, { token });
  }
  return { setCredential, clearCredential, getIdentity, fetchAccessToken, validate, revoke };
}
