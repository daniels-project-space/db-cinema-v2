"use client";
import { REVIEW_PRIZE_GBP } from "../../../shared/reviewPrize";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { StoryEntry } from "@/components/reviews/StoryEntry";
import {
  prizeDate,
  REVIEW_SOCIAL,
  reviewPrizeRound,
} from "../../../shared/reviewPrize";
const steps = [
  [
    "01",
    "Return & settle",
    "Your deposit is refunded in full. Every card hold is released, with no security deducted.",
  ],
  [
    "02",
    "Review & tell",
    "Write your honest review and a real set story. Any star rating is welcome.",
  ],
  [
    "03",
    "Follow & share",
    `Follow @${REVIEW_SOCIAL.handle}. Post your set experience, tag us and disclose #ad / prize entry.`,
  ],
  [
    "04",
    "Submit & track",
    "Add the post link and proof. Your progress stays in your account.",
  ],
  [
    "05",
    "The story wins",
    "An independent judge scores originality, craft insight and clarity — never praise or stars.",
  ],
  [
    "06",
    `£${REVIEW_PRIZE_GBP} for the next shot`,
    `One filmmaker receives £${REVIEW_PRIZE_GBP} cash each round. Two rounds every year.`,
  ],
];
export default function RentalStories() {
  const data = useQuery(api.reviewPrize.schedule, {});
  const round = data?.current ?? reviewPrizeRound();
  return (
    <>
      <SiteHeader />
      <main className="story-prize-page mx-auto max-w-6xl px-6 pb-16 pt-12">
        <section className="relative grid items-center gap-10 py-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.25em] text-amber-200/70">
              DB Cinema · stories from the set
            </p>
            <h1 className="mt-5 font-display text-5xl leading-[1.04] text-white sm:text-7xl">
              You made the shot.
              <br />
              <span className="story-prize-script">Tell us the story.</span>
            </h1>
            <p className="mt-6 max-w-lg text-sm leading-7 text-white/60">
              The last-minute fix. The crew that kept going. That take you still
              think about. Share your real rental experience for a chance to win{" "}
              <strong className="text-amber-200">£{REVIEW_PRIZE_GBP} cash</strong> towards
              whatever comes next.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[10px] text-white/65">
              {[
                `£${REVIEW_PRIZE_GBP} · twice a year`,
                "Honest reviews · any rating",
                "Independent story judging",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/15 px-3 py-2"
                >
                  {t}
                </span>
              ))}
            </div>
            <a href="#enter" className="btn-primary mt-7">
              Your story belongs here →
            </a>
          </div>
          <div className="story-prize-ticket relative mx-auto w-full max-w-sm rounded-[2rem] border border-amber-200/25 p-8 text-center">
            <svg
              viewBox="0 0 260 150"
              className="mx-auto w-56 text-amber-200"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M37 120h157m-119-2-10 25m94-25 10 25M65 45h123v76H65Z" />
              <path d="m191 66 29-14v49l-29-14ZM84 62h50v40H84Z" />
              <circle cx="102" cy="35" r="24" />
              <circle cx="156" cy="35" r="24" />
              {[102, 156].map((x) => (
                <g key={x}>
                  <circle cx={x} cy="35" r="5" />
                  <circle cx={x} cy="20" r="4" />
                  <circle cx={x - 14} cy="39" r="4" />
                  <circle cx={x + 12} cy="44" r="4" />
                </g>
              ))}
              <path
                className="story-ticket-heart"
                d="M145 100s-18-11-18-21c0-9 12-12 18-3 6-9 18-6 18 3 0 10-18 21-18 21Z"
              />
              <path d="M25 49v10m-5-5h10m202 60v10m-5-5h10" />
            </svg>
            <p className="mt-6 text-[10px] uppercase tracking-[.25em] text-amber-100/60">
              The set-story prize
            </p>
            <p className="mt-3 font-display text-7xl text-amber-100">£{REVIEW_PRIZE_GBP}</p>
            <p className="mt-2 text-xs text-white/55">
              Cash. One winner. A story worth telling.
            </p>
            <div className="mt-7 border-t border-dashed border-amber-200/25 pt-5 text-xs leading-6 text-white/65">
              Next deadline
              <br />
              <strong className="text-white">
                {prizeDate(round.deadline)} · 23:59 UK
              </strong>
            </div>
          </div>
        </section>
        <section
          className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Entry flow"
        >
          {steps.map(([n, title, text]) => (
            <article
              key={n}
              className="story-flow-step rounded-2xl border border-white/10 bg-white/[.02] p-5"
            >
              <span className="font-mono text-xs text-amber-200/60">{n} ─</span>
              <h2 className="mt-3 font-display text-lg text-white">{title}</h2>
              <p className="mt-2 text-xs leading-6 text-white/55">{text}</p>
            </article>
          ))}
        </section>
        <section className="mt-10 grid gap-4 rounded-2xl border border-white/10 p-6 text-xs text-white/60 sm:grid-cols-3">
          <div>
            <p className="text-white">Entries close</p>
            <p className="mt-2">
              30 June & 31 December
              <br />
              23:59 UK time
            </p>
          </div>
          <div>
            <p className="text-white">Winner announcement</p>
            <p className="mt-2">
              Within 14 days
              <br />
              This round: by {prizeDate(round.announceBy)}
            </p>
          </div>
          <div>
            <p className="text-white">£{REVIEW_PRIZE_GBP} payment deadline</p>
            <p className="mt-2">
              Within 30 days of closing
              <br />
              This round: by {prizeDate(round.payBy)}
            </p>
          </div>
        </section>
        <section id="enter" className="mx-auto mt-12 max-w-3xl scroll-mt-24">
          <StoryEntry />
        </section>
        {!!data?.past.length && (
          <section className="mt-12">
            <h2 className="font-display text-3xl">
              Stories that stayed with us.
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {data.past.map((w) => (
                <article
                  key={w.key}
                  className="rounded-2xl border border-amber-200/15 p-6"
                >
                  <p className="text-xs text-amber-200">
                    {w.key} · {w.name} · £{REVIEW_PRIZE_GBP} winner
                  </p>
                  <p className="mt-3 text-sm leading-7 text-white/65">
                    {w.story}
                  </p>
                  <p className="mt-3 text-[10px] text-white/40">
                    Independent judge: {w.judge} ·{" "}
                    {w.paid ? "Payment recorded" : "Payment scheduled"}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}
        {!!data?.closed.length && (
          <section className="mt-8 text-xs text-white/50">
            {data.closed.map((r) => (
              <p key={r.key}>
                {r.key}: no eligible entries. No winner or prize payment this
                round.
              </p>
            ))}
          </section>
        )}
        <p className="mx-auto mt-8 max-w-3xl text-[11px] leading-6 text-white/45">
          UK residents 18+. One entry per returned rental, submitted before the
          round closes. No entry fee. All refundable security must be returned
          and holds released without deductions. Social evidence requires
          verification. Entries are labelled as incentivised website reviews and
          excluded from the ordinary rating average. Google reviews are not
          required. Originality 50%, craft insight 30%, clarity 20%; praise and
          star rating are not scored.{" "}
          <Link href="/legal/review-prize" className="text-amber-200 underline">
            Full competition terms
          </Link>
          .
        </p>
      </main>
    </>
  );
}
