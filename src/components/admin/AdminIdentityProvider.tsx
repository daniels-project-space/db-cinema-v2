"use client";

import { Authenticated, ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { createAdminAuthController } from "../../lib/adminAuthController";

type Controller = ReturnType<typeof createAdminAuthController>;

export function AdminIdentityProvider({ controller, client, children }: { controller: Controller; client: ConvexReactClient; children: ReactNode }) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useCallback(() => controller.current()?.token ?? null, [controller]);
  const token = useSyncExternalStore(subscribe, snapshot, () => null);
  const [, setExpiryTick] = useState(0);
  const active = token !== null && controller.current()?.token === token;
  useEffect(() => {
    const current = controller.current();
    if (!current || current.token !== token) return;
    const timer = setTimeout(() => setExpiryTick(value => value + 1), Math.max(1, current.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [controller, token]);
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (forceRefreshToken) return null;
    return controller.fetchAccessToken();
  }, [controller]);
  const useAdminAuth = useCallback(() => ({ isLoading: false, isAuthenticated: active, fetchAccessToken }), [active, fetchAccessToken, token]);
  return <ConvexProviderWithAuth key={active ? token : "signed-out"} client={client} useAuth={useAdminAuth}><Authenticated>{active ? children : null}</Authenticated></ConvexProviderWithAuth>;
}
