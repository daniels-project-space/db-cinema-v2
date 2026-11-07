import { createAdminConvexIdentityAdapter } from "./adminConvexIdentityAdapter";
import { createAdminSessionClient } from "./adminSessionClient";

export function createAdminAuthController(config: { convexUrl: string; convexSiteUrl: string; scope: string; fetcher?: typeof fetch }) {
  const identity = createAdminConvexIdentityAdapter(config.convexUrl, config.scope);
  const session = createAdminSessionClient({ convexSiteUrl: config.convexSiteUrl, ...identity, fetcher: config.fetcher });
  const listeners = new Set<() => void>();
  let revision = 0;
  function notify() { for (const listener of listeners) { try { listener(); } catch {} } }
  function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  function current() { return session.current(); }

  async function disconnect(): Promise<void> {
    revision++;
    identity.clearCredential();
    const closing = session.close();
    notify();
    await closing;
  }

  async function connect(jwt: string): Promise<void> {
    const requested = ++revision;
    identity.clearCredential();
    const closing = session.close();
    notify();
    await closing;
    if (requested !== revision) throw Error("Admin sign-in cancelled.");
    identity.setCredential(jwt);
    try {
      await session.open();
      if (requested !== revision) throw Error("Admin sign-in cancelled.");
      notify();
    } catch (error) {
      if (requested === revision) { identity.clearCredential(); notify(); }
      throw error;
    }
  }

  async function refresh(): Promise<boolean> {
    const checking = session.refresh();
    notify();
    try { return await checking; }
    finally { notify(); }
  }

  async function fetchAccessToken(): Promise<string | null> {
    return session.current() ? identity.fetchAccessToken() : null;
  }

  return { connect, disconnect, refresh, current, subscribe, fetchAccessToken };
}
