"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";

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
    <div className="flex h-6 min-w-0 items-center gap-2 overflow-hidden sm:h-10 sm:gap-3">
      <img
        src={review.authorImage}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-10 sm:w-10"
      />
      <div className="min-w-0">
        <div className="truncate text-[10px] leading-[10px] font-medium text-white/85 sm:text-sm sm:leading-normal">{review.author}</div>
        <div className="truncate text-[9px] leading-[9px] text-white/45 sm:text-xs sm:leading-normal">Renter{review.product ? ` · ${review.product}` : ""}</div>
      </div>
    </div>
  );
}

export function HyggloTrustTile({ reviews }: { reviews: VerifiedHyggloHighlight[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (reviews.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setCurrentIndex((index) => (index + 1) % reviews.length), 4000);
    return () => window.clearInterval(timer);
  }, [reviews.length]);

  const review = reviews[currentIndex % reviews.length];
  return (
    <Link
      href="/#reviews"
      data-testid="hygglo-trust-card"
      aria-roledescription="featured review"
      aria-label={`Featured renter review ${currentIndex + 1} of ${reviews.length}. Read all renter reviews.`}
      className="spot trust-card relative isolate block h-[148px] overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top_right,rgba(212,172,107,.14),transparent_58%),#101013] p-1 shadow-[0_20px_60px_-32px_rgba(0,0,0,.9)] max-[359px]:h-[140px] max-[359px]:p-2 sm:h-[304px] sm:p-6"
    >
      <Image
        src="/images/home/maintained-cinema-gear-20261028.webp"
        alt=""
        fill
        sizes="(max-width: 640px) 100vw, 420px"
        className="trust-card-image object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-black/55 via-black/55 to-black/80" />
      <div className="relative z-10 flex h-full flex-col justify-between">
      <div className="flex items-center justify-between gap-1 sm:gap-3">
        <span className="inline-flex max-w-[calc(100%-1.5rem)] min-w-0 truncate whitespace-nowrap items-center gap-1 rounded-full border border-white/20 bg-black/35 px-1.5 py-1 font-mono text-[7px] uppercase tracking-[0.06em] text-white/75 max-[374px]:px-1 max-[374px]:text-[6px] max-[374px]:tracking-[0.04em] sm:gap-2 sm:px-3 sm:text-[9px] sm:tracking-[0.17em]">
          Trust that is earned
        </span>
        <span data-testid="review-eye-glyph" className="review-eye shrink-0" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M2.25 10s2.7-4.75 7.75-4.75S17.75 10 17.75 10s-2.7 4.75-7.75 4.75S2.25 10 2.25 10Z"/><circle className="review-eye-iris" cx="10" cy="10" r="3.25"/><circle cx="10" cy="10" r="1.2"/></svg></span>
      </div>
      <div className="hygglo-trust-review-panel min-w-0 rounded-2xl border border-white/15 p-1 sm:p-5">
        <div aria-live="off">
          <span className="text-[10px] tracking-[0.1em] text-accent-300 sm:text-sm sm:tracking-[0.16em]" aria-label="5 out of 5 stars"><span aria-hidden="true">★★★★★</span></span>
          <blockquote key={review._id} className="hygglo-trust-review-fade hygglo-trust-review-quote mt-1 text-[9px] leading-3 text-white/90 min-[360px]:text-[10px] min-[360px]:leading-[14px] sm:mt-3 sm:text-[12px] sm:leading-[18px]">
            “{review.text}”
          </blockquote>
        </div>
        <div key={`reviewer-${review._id}`} className="hygglo-trust-review-fade flex items-center gap-1 border-t border-white/10 sm:mt-4 sm:gap-3 sm:pt-3">
          <Reviewer review={review} />
        </div>
      </div>
      </div>
    </Link>
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
      aria-label={`Verified five-star reviews, row ${row + 1}. Swipe or scroll to browse; automatic movement continues while hovered or focused when motion is enabled.`}
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

