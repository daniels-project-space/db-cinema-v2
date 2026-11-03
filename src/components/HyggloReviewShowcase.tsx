"use client";

import { useEffect, useState, type CSSProperties } from "react";

export type VerifiedHyggloHighlight = {
  _id: string;
  author: string;
  authorImage: string;
  rating: 5;
  text: string;
  product: string | null;
};

function Rating({ label = "5 out of 5 stars" }: { label?: string }) {
  return (
    <span className="text-sm tracking-[0.16em] text-accent-300" aria-label={label}>
      <span aria-hidden="true">★★★★★</span>
    </span>
  );
}

function Reviewer({ review }: { review: VerifiedHyggloHighlight }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={review.authorImage}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-10 w-10 shrink-0 rounded-full border border-white/15 object-cover"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white/85">{review.author}</div>
        <div className="truncate text-xs text-white/45">Hygglo renter{review.product ? ` · ${review.product}` : ""}</div>
      </div>
    </div>
  );
}

export function HyggloTrustTile({ reviews }: { reviews: VerifiedHyggloHighlight[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reviews.length < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setCurrentIndex((index) => (index + 1) % reviews.length), 3000);
    return () => window.clearInterval(timer);
  }, [paused, reviews.length]);

  const review = reviews[currentIndex % reviews.length];
  return (
    <article
      data-testid="hygglo-trust-card"
      role="group"
      aria-roledescription="featured review"
      aria-label={`Review ${currentIndex + 1} of ${reviews.length}`}
      className="spot gradient-border flex h-full min-h-[280px] flex-col justify-between rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top_right,rgba(212,172,107,.14),transparent_58%),#101013] p-5 shadow-[0_20px_60px_-32px_rgba(0,0,0,.9)] sm:min-h-[304px] sm:p-6"
    >
      <div aria-live="off">
        <span className="inline-flex rounded-full border border-white/20 bg-black/35 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.17em] text-white/75">
          Hygglo · verified review
        </span>
        {reviews.length > 1 ? <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? "Resume featured review rotation" : "Pause featured review rotation"}
          className="float-right rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/55 motion-reduce:hidden"
        >{paused ? "Play" : "Pause"}</button> : null}
        <div className="mt-7"><Rating /></div>
        <blockquote key={review._id} className="hygglo-trust-review-fade mt-3 line-clamp-4 text-sm leading-relaxed text-white/80">
          “{review.text}”
        </blockquote>
      </div>
      <div key={`reviewer-${review._id}`} className="hygglo-trust-review-fade mt-5 flex items-center justify-between gap-3">
        <Reviewer review={review} />
        <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] text-emerald-100/80">
          5-star
        </span>
      </div>
    </article>
  );
}

function ReviewCard({ review }: { review: VerifiedHyggloHighlight }) {
  return (
    <figure
      data-testid="hygglo-review-card"
      className="spot flex h-[176px] w-[min(82vw,320px)] shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-[#101013]/95 p-4 sm:w-[320px]"
    >
      <div>
        <Rating />
        <blockquote className="hygglo-review-quote mt-2 text-sm leading-relaxed text-white/75">
          “{review.text}”
        </blockquote>
      </div>
      <figcaption className="mt-3"><Reviewer review={review} /></figcaption>
    </figure>
  );
}

function ReviewRow({
  reviews,
  row,
  reverse = false,
}: {
  reviews: VerifiedHyggloHighlight[];
  row: number;
  reverse?: boolean;
}) {
  const rowReviews = reviews.filter((_, index) => index % 3 === row);
  const items = rowReviews.length ? rowReviews : reviews;
  return (
    <div
      className="hygglo-review-marquee"
      role="group"
      tabIndex={0}
      aria-roledescription="review carousel"
      aria-label={`Verified five-star reviews, row ${row + 1}. Swipe or scroll to browse; automatic movement pauses on focus or hover.`}
    >
      <div
        className="hygglo-review-track"
        data-direction={reverse ? "reverse" : "forward"}
        style={{ "--review-speed": `${52 + row * 5}s` } as CSSProperties}
      >
        <div className="hygglo-review-group">
          {items.map((review) => <ReviewCard key={review._id} review={review} />)}
        </div>
        <div className="hygglo-review-group" aria-hidden="true">
          {items.map((review) => <ReviewCard key={`${review._id}-duplicate`} review={review} />)}
        </div>
      </div>
    </div>
  );
}

export function HyggloReviewRows({ reviews }: { reviews: VerifiedHyggloHighlight[] }) {
  if (reviews.length < 3) return null;
  return (
    <div data-testid="hygglo-review-rows" className="mt-10 space-y-4">
      <ReviewRow reviews={reviews} row={0} />
      <ReviewRow reviews={reviews} row={1} reverse />
      <ReviewRow reviews={reviews} row={2} />
    </div>
  );
}

