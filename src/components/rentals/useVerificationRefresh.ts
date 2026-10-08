"use client";
import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@cvx/_generated/api";

/** Only refresh the case currently visible to its owner or the administrator. */
export function useVerificationRefresh(bookingId: string, token?: string | null, checkoutSessionId?: string | null, admin = false, enabled = true) {
  const refresh = useAction(api.didit.refreshProgress);
  const [error, setError] = useState(false);
  const flight = useRef(false);
  useEffect(() => {
    let active = true;
    setError(false);
    async function check() {
      if (!enabled || document.hidden || flight.current || (!token && !checkoutSessionId)) return;
      flight.current = true;
      try {
        await refresh({bookingId: bookingId as any, accountToken: token ?? undefined, checkoutSessionId: checkoutSessionId ?? undefined, admin});
        if (active) setError(false);
      } catch { if (active) setError(true); }
      finally { flight.current = false; }
    }
    void check();
    const timer = setInterval(check, 15000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [bookingId, token, checkoutSessionId, admin, enabled, refresh]);
  return error;
}
