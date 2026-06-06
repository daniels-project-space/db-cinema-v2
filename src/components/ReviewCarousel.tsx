"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5 text-accent-400">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < n ? "" : "text-white/15"}>
          ★
        </span>
      ))}
    </div>
  );
}

export function ReviewCarousel() {
  const reviews = useQuery(api.reviews.listPublished, { limit: 18 }) ?? [];
  const [perPage, setPerPage] = useState(3);
  const [page, setPage] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const set = () => setPerPage(window.innerWidth < 768 ? 1 : 3);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  const pages = Math.max(1, Math.ceil(reviews.length / perPage));

  useEffect(() => {
    if (reviews.length <= perPage) return;
    const t = setInterval(() => change((p) => (p + 1) % pages), 7000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews.length, perPage, pages]);

  function change(next: (p: number) => number) {
    setFade(false);
    setTimeout(() => {
      setPage((p) => next(p) % pages);
      setFade(true);
    }, 200);
  }

  if (reviews.length === 0) return null;
  const slice = reviews.slice(page * perPage, page * perPage + perPage);

  return (
    <div>
      <div
        className={`grid gap-4 transition-opacity duration-200 md:grid-cols-3 ${
          fade ? "opacity-100" : "opacity-0"
        }`}
      >
        {slice.map((r) => (
          <div
            key={r._id}
            className="glass gradient-border flex flex-col gap-3 rounded-2xl p-5"
          >
            <Stars n={r.rating} />
            <p className="flex-1 text-sm italic leading-relaxed text-white/70">
              “{r.text}”
            </p>
            <div className="flex items-center gap-3 pt-2">
              {r.authorImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.authorImage}
                  alt={r.author}
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-500/20 text-sm text-accent-300">
                  {r.author.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm text-white/80">{r.author}</div>
                {r.product && (
                  <div className="truncate text-xs text-white/30">{r.product}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => change((p) => (p - 1 + pages) % pages)}
            className="flex h-9 w-9 items-center justify-center rounded-full glass text-white/60 transition-colors hover:text-white"
            aria-label="Previous reviews"
          >
            ‹
          </button>
          <div className="flex gap-1.5">
            {Array.from({ length: pages }).map((_, i) => (
              <button
                key={i}
                onClick={() => change(() => i)}
                aria-label={`Page ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === page ? "w-6 bg-accent-400" : "w-1.5 bg-white/20"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => change((p) => (p + 1) % pages)}
            className="flex h-9 w-9 items-center justify-center rounded-full glass text-white/60 transition-colors hover:text-white"
            aria-label="Next reviews"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
