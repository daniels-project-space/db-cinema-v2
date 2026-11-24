"use client";
import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@cvx/_generated/api";

/** Only refresh the case currently visible to its owner or the administrator. */
export function useVerificationRefresh(bookingId: string, token?: string | null, checkoutSessionId?: string | null, admin = false, enabled = true, oneShotRecovery = false) {
  const refresh = useAction(api.didit.refreshProgress);
  const [error, setError] = useState(false);
  const flights = useRef(new Map<string, Promise<{ status: string }>>());
  const recoveryCompleted = useRef(false);
  const recoveryScope = useRef("");
  useEffect(() => {
    const currentScope = JSON.stringify([bookingId, token ?? null, checkoutSessionId ?? null, admin]);
    if (recoveryScope.current !== currentScope) {
      recoveryScope.current = currentScope;
      recoveryCompleted.current = false;
    }
    let active = true;
    setError(false);
    async function check() {
      if (!enabled || document.hidden || (oneShotRecovery && recoveryCompleted.current) || (!token && !checkoutSessionId)) return;
      let pending = flights.current.get(currentScope);
      if (!pending) {
        pending = Promise.resolve().then(() => refresh({bookingId: bookingId as any, accountToken: token ?? undefined, checkoutSessionId: checkoutSessionId ?? undefined, admin}));
        flights.current.set(currentScope, pending);
      }
      try {
        const result = await pending;
        if (active && result.status !== "throttled") {
          setError(false);
          if (oneShotRecovery) recoveryCompleted.current = true;
        }
      } catch { if (active) setError(true); }
      finally { if (flights.current.get(currentScope) === pending) flights.current.delete(currentScope); }
    }
    void check();
    const timer = setInterval(check, oneShotRecovery ? 60000 : 15000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [bookingId, token, checkoutSessionId, admin, enabled, oneShotRecovery, refresh]);
  return error;
}
