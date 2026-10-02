"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { scrollToSelector } from "./scrollTarget";

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
  /**
   * The shortlist Gaffer just recommended. Held separately from `focusedId`
   * because they say different things: these are "the ones worth looking at",
   * the focused one is "this is the one we're talking about now".
   */
  suggestedIds: string[];
  /** Light one tile up, clearing itself after `ms`. Passing null clears now. */
  focus: (listingId: string | null, ms?: number, route?: string) => Promise<boolean>;
  /** Mark a shortlist. Stays until the next one, or until cleared. */
  suggest: (listingIds: string[], route?: string) => Promise<boolean>;
};

const FocusCtx = createContext<Ctx>({
  focusedId: null,
  suggestedIds: [],
  focus: async () => false,
  suggest: async () => false,
});

/** Long enough to register as "that one", short enough not to linger. */
export const FOCUS_MS = 2600;

/**
 * Scroll an element into view after the destination and its results are ready. Shared by scrollToCard below and by a plain category
 * browse with no single item to point at — that path used to leave the
 * customer looking at the hero section while the actual results sat a full
 * screen below the fold, correctly filtered and completely out of sight.
 */
export function scrollToId(elementId: string, route?: string) {
  return scrollToSelector(`#${CSS.escape(elementId)}`, route, "start");
}

function scrollToCard(listingId: string, route?: string) {
  return scrollToSelector(`[data-listing-id="${CSS.escape(listingId)}"]`, route);
}

export function GafferFocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  const focus = useCallback(async (listingId: string | null, ms: number = FOCUS_MS, route?: string) => {
    const mine = ++request.current;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setFocusedId(listingId);
    if (!listingId) return false;
    setSuggestedIds([]);
    const shown = await scrollToCard(listingId, route);
    if (mine !== request.current) return false;
    if (ms > 0) timer.current = setTimeout(() => {
      setFocusedId(null);
      timer.current = null;
    }, ms);
    return shown;
  }, []);

  const suggest = useCallback(async (listingIds: string[], route?: string) => {
    const ids = listingIds.filter(Boolean);
    setSuggestedIds(ids);
    // put the top pick on screen; the rest are around it
    return ids[0] ? scrollToCard(ids[0], route) : false;
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(
    () => ({ focusedId, suggestedIds, focus, suggest }),
    [focusedId, suggestedIds, focus, suggest],
  );
  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
}

/** Safe outside the provider (returns a no-op), so cards can render anywhere. */
export function useGafferFocus() {
  return useContext(FocusCtx);
}
