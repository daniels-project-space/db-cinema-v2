"use client";

import { useEffect } from "react";
import { CAROUSEL_ITEMS } from "@/components/FormSevenCarousel";

/**
 * Warm the FORM / SEVEN reel before anyone opens it.
 *
 * The overlay lives behind a header coin, so the first thing a visitor sees of
 * it is six films deciding whether to load. Fetching them once the page is
 * otherwise idle puts them in the HTTP cache, so opening the overlay plays
 * immediately instead of showing posters while the network catches up.
 *
 * Deliberately cheap and deferred:
 *   - posters first (small, and they're what shows if a film is still loading)
 *   - films afterwards, one at a time, so this never competes with the hero
 *     video or the catalogue for bandwidth
 *   - skipped entirely on a metered or slow connection, and under
 *     prefers-reduced-motion, where the reel doesn't autoplay anyway
 */
export function FormSevenPrewarm() {
  useEffect(() => {
    const conn = (navigator as any).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    const links: HTMLLinkElement[] = [];

    const prefetch = (href: string, as: string) => {
      if (cancelled) return;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = as;
      link.href = href;
      document.head.appendChild(link);
      links.push(link);
    };

    // one at a time, spaced out — a burst of six video fetches on load is the
    // opposite of an optimisation
    const run = async () => {
      for (const item of CAROUSEL_ITEMS) {
        if (cancelled) return;
        prefetch(item.poster, "image");
      }
      for (const item of CAROUSEL_ITEMS) {
        if (cancelled) return;
        prefetch(item.src, "video");
        await new Promise((r) => setTimeout(r, 400));
      }
    };

    const hasIdle = "requestIdleCallback" in window;
    const idle: number = hasIdle
      ? (window as any).requestIdleCallback(() => void run(), { timeout: 4000 })
      : (window.setTimeout(() => void run(), 2500) as unknown as number);

    return () => {
      cancelled = true;
      if (hasIdle) (window as any).cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      links.forEach((l) => l.remove());
    };
  }, []);

  return null;
}
