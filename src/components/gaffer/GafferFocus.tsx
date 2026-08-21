"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";

/**
 * Which listing Gaffer is talking about right now.
 *
 * When someone picks an item out loud, the tile it lives on lights up before
 * anything lands in the basket — so the customer sees the thing being chosen,
 * rather than a basket count silently ticking up somewhere off screen.
 *
 * Deliberately its own context rather than a field on GafferSessionProvider:
 * that one carries the call timer, which changes every second, and every
 * GearCard on a 40-tile grid subscribing to it would re-render the whole
 * catalogue once a second for the length of the call.
 */

type Ctx = {
  focusedId: string | null;
  /** Light a tile up, clearing itself after `ms`. Passing null clears now. */
  focus: (listingId: string | null, ms?: number) => void;
};

const FocusCtx = createContext<Ctx>({ focusedId: null, focus: () => {} });

/** Long enough to register as "that one", short enough not to linger. */
export const FOCUS_MS = 2600;

export function GafferFocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = useCallback((listingId: string | null, ms: number = FOCUS_MS) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setFocusedId(listingId);
    if (!listingId) return;
    timer.current = setTimeout(() => {
      setFocusedId(null);
      timer.current = null;
    }, ms);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => ({ focusedId, focus }), [focusedId, focus]);
  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
}

/** Safe outside the provider (returns a no-op), so cards can render anywhere. */
export function useGafferFocus() {
  return useContext(FocusCtx);
}
