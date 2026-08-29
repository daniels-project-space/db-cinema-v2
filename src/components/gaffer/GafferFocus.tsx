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
  /**
   * The shortlist Gaffer just recommended. Held separately from `focusedId`
   * because they say different things: these are "the ones worth looking at",
   * the focused one is "this is the one we're talking about now".
   */
  suggestedIds: string[];
  /** Light one tile up, clearing itself after `ms`. Passing null clears now. */
  focus: (listingId: string | null, ms?: number) => void;
  /** Mark a shortlist. Stays until the next one, or until cleared. */
  suggest: (listingIds: string[]) => void;
};

const FocusCtx = createContext<Ctx>({
  focusedId: null,
  suggestedIds: [],
  focus: () => {},
  suggest: () => {},
});

/** Long enough to register as "that one", short enough not to linger. */
export const FOCUS_MS = 2600;

/**
 * Scroll an element into view once the page has settled, if it isn't already
 * comfortably on screen. Shared by scrollToCard below and by a plain category
 * browse with no single item to point at — that path used to leave the
 * customer looking at the hero section while the actual results sat a full
 * screen below the fold, correctly filtered and completely out of sight.
 */
function scrollToSelector(selector: string, opts: { block?: ScrollLogicalPosition; edge?: number } = {}) {
  const { block = "center", edge = 90 } = opts;
  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const offScreen = r.top < edge || r.bottom > window.innerHeight - 40;
      if (offScreen) el.scrollIntoView({ behavior: "smooth", block });
    }, 120);
  });
}

/** Bring an arbitrary element into view by id — the toolbar, a section, whatever Gaffer needs to point at. */
export function scrollToId(elementId: string) {
  scrollToSelector(`#${CSS.escape(elementId)}`, { block: "start", edge: 110 });
}

/**
 * Bring a card into view when Gaffer picks it.
 *
 * The catalogue runs to 400 items, so naming one on a call is useless if it's
 * eight rows below the fold. Waits a frame for the grid to re-render after a
 * filter change, and gives up quietly if the card isn't on this page.
 */
function scrollToCard(listingId: string) {
  scrollToSelector(`[data-listing-id="${CSS.escape(listingId)}"]`);
}

export function GafferFocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = useCallback((listingId: string | null, ms: number = FOCUS_MS) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setFocusedId(listingId);
    if (!listingId) return;
    scrollToCard(listingId);
    timer.current = setTimeout(() => {
      setFocusedId(null);
      timer.current = null;
    }, ms);
  }, []);

  const suggest = useCallback((listingIds: string[]) => {
    const ids = listingIds.filter(Boolean);
    setSuggestedIds(ids);
    // put the top pick on screen; the rest are around it
    if (ids[0]) scrollToCard(ids[0]);
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
