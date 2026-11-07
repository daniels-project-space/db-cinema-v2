type AdminIdentity = { jwt: string };
type AdminSession = { token: string; expiresAt: number; identity: AdminIdentity };
type AdminAttestation = { clientDigest: string; nonce: string; issuedAt: number; mac: string };
type SessionClientOptions = {
  convexSiteUrl: string;
  getIdentity: () => Promise<AdminIdentity | null>;
  revoke: (sessionToken: string, identity: AdminIdentity) => Promise<void>;
  validate: (sessionToken: string, identity: AdminIdentity) => Promise<boolean>;
  fetcher?: typeof fetch;
};

export function createAdminSessionClient(options: SessionClientOptions) {
  const site = new URL(options.convexSiteUrl);
  if (site.protocol !== "https:" || !site.hostname.endsWith(".convex.site") || site.username || site.password || site.port || site.pathname !== "/" || site.search || site.hash)
    throw Error("Invalid session service URL.");
  const fetcher = options.fetcher ?? fetch;
  let session: AdminSession | null = null;
  let pending: AbortController | null = null;
  let generation = 0;
  let validationGeneration = 0;
  let validated = false;

  async function close(): Promise<void> {
    generation++;
    validationGeneration++;
    validated = false;
    pending?.abort();
    pending = null;
    const old = session;
    session = null;
    if (old) await options.revoke(old.token, old.identity);
  }

  async function open(): Promise<{ token: string; expiresAt: number }> {
    if (session) throw Error("Sign out before creating another admin session.");
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const current = ++generation;
    const check = () => { if (controller.signal.aborted || generation !== current) throw Error("Admin session request cancelled."); };
    try {
      const candidate = await options.getIdentity();
      check();
      if (!candidate || !candidate.jwt || /\s/.test(candidate.jwt) || candidate.jwt.length > 8192) throw Error("Admin identity unavailable.");
      const identity = { jwt: candidate.jwt };
      const attestationResponse = await fetcher("/api/admin/session-attestation", { method: "POST", headers: { Authorization: `Bearer ${identity.jwt}` }, cache: "no-store", signal: controller.signal });
      if (!attestationResponse.ok) throw Error("Admin session unavailable.");
      const attestation: AdminAttestation = await attestationResponse.json();
      check();
      if (!attestation || ![attestation.clientDigest, attestation.nonce, attestation.mac].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) || !Number.isSafeInteger(attestation.issuedAt))
        throw Error("Admin session unavailable.");
      const response = await fetcher(`${site.origin}/admin-session`, { method: "POST", headers: { Authorization: `Bearer ${identity.jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(attestation), cache: "no-store", signal: controller.signal });
      if (!response.ok) throw Error("Admin session unavailable.");
      const result: { token?: unknown; expiresAt?: unknown } = await response.json();
      if (typeof result.token !== "string" || !/^[a-f0-9]{64}$/.test(result.token) || typeof result.expiresAt !== "number" || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 12 * 60 * 60 * 1000)
        throw Error("Admin session unavailable.");
      if (controller.signal.aborted || generation !== current) {
        await options.revoke(result.token, identity);
        throw Error("Admin session request cancelled.");
      }
      try {
        const latestIdentity = await options.getIdentity();
        if (!latestIdentity || latestIdentity.jwt !== identity.jwt || !await options.validate(result.token, identity))
          throw Error("Admin identity or session changed.");
      } catch (error) {
        await options.revoke(result.token, identity);
        throw error;
      }
      if (controller.signal.aborted || generation !== current) {
        await options.revoke(result.token, identity);
        throw Error("Admin session request cancelled.");
      }
      session = { token: result.token, expiresAt: result.expiresAt, identity };
      validated = true;
      return { token: session.token, expiresAt: session.expiresAt };
    } finally {
      if (pending === controller) pending = null;
    }
  }

  function current(): { token: string; expiresAt: number; headers: { Authorization: string; "X-DBC-Admin-Session": string } } | null {
    if (!session || session.expiresAt <= Date.now()) { session = null; validated = false; return null; }
    if (!validated) return null;
    return { token: session.token, expiresAt: session.expiresAt, headers: { Authorization: `Bearer ${session.identity.jwt}`, "X-DBC-Admin-Session": session.token } };
  }

  async function refresh(): Promise<boolean> {
    const original = session;
    if (!original || original.expiresAt <= Date.now()) { session = null; validated = false; return false; }
    const revision = ++validationGeneration;
    validated = false;
    const identity = await options.getIdentity();
    if (revision !== validationGeneration || session !== original) return false;
    if (!identity || identity.jwt !== original.identity.jwt) { await close(); return false; }
    const allowed = await options.validate(original.token, identity);
    if (revision !== validationGeneration || session !== original) return false;
    if (!allowed) { await close(); return false; }
    validated = true;
    return true;
  }

  return { open, close, current, refresh };
}
