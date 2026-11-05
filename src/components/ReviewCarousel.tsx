"use client";
import { REVIEW_PRIZE_GBP } from "../../shared/reviewPrize";

import { ChatAvatar } from "./rentals/ChatIdentity";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { IconStar, IconChevronLeft, IconChevronRight } from "@/components/icons";

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5 text-accent-400">
      {Array.from({ length: 5 }).map((_, i) => (
        <IconStar key={i} filled={i < n} className={`h-3.5 w-3.5 ${i < n ? "" : "text-white/15"}`} />
      ))}
    </div>
  );
}

export function ReviewCarousel() {
  const reviews = useQuery(api.reviews.listNativePublished, { limit: 100 }) ?? [];
  const [perPage, setPerPage] = useState(3);
  const [page, setPage] = useState(0);
  const [fade, setFade] = useState(true);
  const changeTimer = useRef<number | null>(null);

  useEffect(() => {
    const set = () => setPerPage(window.innerWidth < 768 ? 1 : 3);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  const pages = Math.max(1, Math.ceil(reviews.length / perPage));
  const visiblePage = Math.min(page, pages - 1);

  const change = useCallback((next: (p: number) => number) => {
    if (changeTimer.current !== null) window.clearTimeout(changeTimer.current);
    setFade(false);
    changeTimer.current = window.setTimeout(() => {
      setPage((p) => next(Math.min(p, pages - 1)) % pages);
      setFade(true);
      changeTimer.current = null;
    }, 200);
  }, [pages]);

  useEffect(() => {
    if (reviews.length <= perPage) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") change((p) => (p + 1) % pages); }, 12000);
    return () => window.clearInterval(t);
  }, [change, reviews.length, perPage, pages]);

  useEffect(() => () => {
    if (changeTimer.current !== null) window.clearTimeout(changeTimer.current);
  }, []);

  if (reviews.length === 0) return null;
  const slice = reviews.slice(visiblePage * perPage, visiblePage * perPage + perPage);

  return (
    <div data-testid="review-carousel">
      <h3 className="mb-4 text-center font-display text-xl font-semibold text-white">Reviews from our renters</h3>
      <div
        className={`grid min-h-[232px] gap-3 transition-[opacity,transform] duration-300 md:min-h-[240px] md:grid-cols-3 md:gap-4 ${
          fade ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
        }`}
      >
        {slice.map((r) => (
          <figure
            key={r._id}
            data-testid="review-card"
            data-review-source={r.source}
            className="spot gradient-border relative flex h-[232px] min-h-0 flex-col gap-3 overflow-hidden rounded-2xl p-4 md:h-[240px] md:p-5"
          >
            <span className="serif-accent pointer-events-none absolute right-4 top-1 text-6xl leading-none text-accent-400/15" aria-hidden>
              &rdquo;
            </span>
            <Stars n={r.rating} />
            {r.incentivized && <span className="text-[10px] text-amber-200/80">{r.encoreReward?"Encore benefit":""}{r.encoreReward&&r.prizeEntry?" + ":""}{r.prizeEntry?`£${REVIEW_PRIZE_GBP} story-prize entrant`:""} · incentivised review</span>}
            <blockquote className="review-carousel-quote min-h-0 flex-1 text-sm leading-relaxed text-white/70">
              {r.text}
            </blockquote>
            <figcaption className="flex items-center gap-3 pt-2">
              <ChatAvatar sender="renter" photo={r.authorImage} name={r.author} className="!h-9 !w-9 ring-1 ring-white/10" />
              <div className="min-w-0">
                <div className="text-sm text-white/80">{r.author}</div>
                {r.product && (
                  <div className="truncate font-mono text-[11px] text-white/30">{r.product}</div>
                )}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 sm:gap-4">
          <button
            onClick={() => change((p) => (p - 1 + pages) % pages)}
            className="glass glass-hover flex h-11 w-11 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white"
            aria-label="Previous reviews"
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
          {pages > 7 ? <span className="text-xs text-white/60" aria-label={`Review page ${visiblePage + 1} of ${pages}`}>{visiblePage + 1} / {pages}</span> : <div className="flex gap-1.5">
            {Array.from({ length: pages }).map((_, i) => (
              <button
                key={i}
                onClick={() => change(() => i)}
                aria-label={`Page ${i + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === visiblePage ? "w-6 bg-accent-400" : "w-1.5 bg-white/20 hover:bg-white/40"
                }`}
              />
            ))}
          </div>}
          <button
            onClick={() => change((p) => (p + 1) % pages)}
            className="glass glass-hover flex h-11 w-11 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white"
            aria-label="Next reviews"
          >
            <IconChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
