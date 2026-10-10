"use client";
import { REVIEW_PRIZE_GBP } from "../../../shared/reviewPrize";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useAction, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "../account/AccountProvider";
import {
  REVIEW_PRIZE_TERMS,
  REVIEW_SOCIAL,
  prizeDate,
} from "../../../shared/reviewPrize";
export function StoryEntry() {
  const { token, me } = useAccount();
  const data = useQuery(api.reviewPrize.mine, token && me ? { token, includeBookings: false } : "skip");
  const { results: bookings, status: rentalPageStatus, loadMore } = usePaginatedQuery(
    api.reviewPrize.rentalsPage, token && me ? { token } : "skip", { initialNumItems: 20 },
  );
  const check = useAction(api.reviewActions.checkEligibility),
    upload = useMutation(api.reviewPrize.uploadEvidence),
    submit = useMutation(api.reviewPrize.submit);
  const [bookingId, setBookingId] = useState(""),
    [story, setStory] = useState(""),
    [review, setReview] = useState(""),
    [rating, setRating] = useState(5),
    [handle, setHandle] = useState(""),
    [post, setPost] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [accepted, setAccepted] = useState(false),
    [follow, setFollow] = useState(false),
    [ad, setAd] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selectedRental = useQuery(api.reviewPrize.rental,
    token && me && bookingId ? { token, bookingId: bookingId as any } : "skip");
  const booking = selectedRental ?? bookings.find((b) => b._id === bookingId);
  const editing = data?.entries.find((e) => e.bookingId === bookingId);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !file) return;
    setBusy(true);
    setError("");
    try {
      if (!(await check({ token, bookingId: bookingId as any })).eligible)
        throw Error(
          "Security is not fully settled yet. Please check again after return/refund completion.",
        );
      if (
        file.size > 8 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw Error("Use a JPG, PNG or WebP screenshot under 8 MB.");
      const url = await upload({ token });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw Error("Evidence upload failed; please retry.");
      const { storageId } = await response.json();
      await submit({
        token,
        bookingId: bookingId as any,
        story,
        rating: booking?.review?.rating ?? rating,
        review: booking?.review?.text ?? review,
        socialHandle: handle,
        postUrl: post,
        evidenceStorageId: storageId,
        termsVersion: REVIEW_PRIZE_TERMS,
        adult: accepted,
        followDeclared: follow,
        disclosureDeclared: ad,
      });
      setBookingId("");
      setStory("");
      setFile(null);
      setAccepted(false);
    } catch (e: any) {
      setError(e.message ?? "Entry could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const input =
    "mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-amber-200/50";
  if (!token || !me)
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.025] p-6">
        <h3 className="font-display text-xl">
          Your story starts in your account.
        </h3>
        <p className="mt-2 text-sm text-white/50">
          Sign in to see eligible returned rentals and keep every entry step
          saved.
        </p>
        <Link className="btn-primary mt-5" href="/account">
          Sign in to enter
        </Link>
      </div>
    );
  return (
    <div data-testid="story-entry" className="space-y-6">
      {data?.entries.map((e) => (
        <article
          key={e._id}
          className="rounded-2xl border border-amber-200/15 bg-white/[.02] p-5"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="text-sm font-medium">Your {e.roundKey} story</h3>
            <span className="text-xs text-amber-200">
              {e.round?.paid
                ? `£${REVIEW_PRIZE_GBP} payment recorded`
                : e.status === "winner"
                  ? `Winner · £${REVIEW_PRIZE_GBP} payment due`
                  : e.status.replaceAll("_", " ")}
            </span>
          </div>
          <ol className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
            {[
              ["Return & security", e.securitySettled],
              ["Review & story", true],
              ["Social evidence", !!e.socialVerifiedAt],
              ["Independent judging", !!e.judgedAt],
            ].map(([label, done]) => (
              <li
                key={String(label)}
                className={done ? "text-emerald-300" : "text-white/45"}
              >
                {done ? "✓" : "◌"} {label}
              </li>
            ))}
          </ol>
          {e.status === "needs_evidence" &&
            e.roundKey === data.currentRoundKey && (
              <button
                type="button"
                className="mt-3 text-xs text-amber-200 underline"
                onClick={() => {
                  setBookingId(e.bookingId);
                  setStory(e.story);
                  setHandle(e.socialHandle);
                  setPost(e.postUrl);
                  setFile(null);
                  setAccepted(false);
                  setFollow(false);
                  setAd(false);
                  document
                    .getElementById("story-form")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Update evidence and resubmit
              </button>
            )}
          {e.verificationNote && (
            <p className="mt-3 text-xs text-white/65">{e.verificationNote}</p>
          )}
          {e.round && (
            <p className="mt-3 text-[11px] text-white/40">
              Closes {prizeDate(e.round.deadline)} · announcement by{" "}
              {prizeDate(e.round.announceBy)} · winner payment by{" "}
              {prizeDate(e.round.payBy)}
            </p>
          )}
        </article>
      ))}
      <form
        id="story-form"
        onSubmit={send}
        className="rounded-3xl border border-white/10 bg-white/[.025] p-6 sm:p-8"
      >
        <h3 className="font-display text-2xl">Tell us what happened on set.</h3>
        <p className="mt-2 text-xs leading-6 text-white/50">
          Honest reviews of any rating qualify. The story is judged, never the
          number of stars. Evidence is checked by the team; ticking a box does
          not verify a follow.
        </p>
        <label className="mt-5 block text-xs text-white/65">
          Your returned rental
          <select
            required
            className={input}
            value={bookingId}
            onChange={(e) => {
              setBookingId(e.target.value);
              setReview("");
            }}
          >
            <option value="">Choose a rental</option>
            {(booking && !bookings.some(b => b._id === booking._id) ? [booking, ...bookings] : bookings)
              .filter(
                (b) =>
                  b._id === bookingId ||
                  !data?.entries.some((e) => e.bookingId === b._id),
              )
              .map((b) => (
                <option key={b._id} value={b._id}>
                  {b.title}
                </option>
              ))}
          </select>
        </label>
        {(rentalPageStatus === "CanLoadMore" || rentalPageStatus === "LoadingMore") && (
          <button type="button" className="mt-3 text-xs text-amber-200 disabled:opacity-50"
            disabled={rentalPageStatus === "LoadingMore"} onClick={() => loadMore(20)}>
            {rentalPageStatus === "LoadingMore" ? "Loading older rentals…" : "Show more returned rentals"}
          </button>
        )}
        {!bookings.length && rentalPageStatus === "Exhausted" && (
          <p className="mt-3 text-xs text-white/45">
            Entries become available once a rental is returned, its deposit is
            fully refunded and every hold is released without deductions.
          </p>
        )}
        {booking && !booking.review && (
          <div className="mt-5 grid gap-3">
            <label className="text-xs text-white/65">
              Your honest rating
              <select
                className={input}
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/65">
              Website review
              <textarea
                required
                minLength={10}
                maxLength={2000}
                className={input}
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
            </label>
          </div>
        )}
        {booking?.review && (
          <p className="mt-4 text-xs text-emerald-200">
            Your existing website review will be linked and labelled as a prize
            entrant.
          </p>
        )}
        <label className="mt-5 block text-xs text-white/65">
          Your story · 150–3,000 characters
          <textarea
            required
            minLength={150}
            maxLength={3000}
            rows={5}
            className={input}
            placeholder="The shot you chased. The problem you solved. The moment the crew made it happen."
            value={story}
            onChange={(e) => setStory(e.target.value)}
          />
        </label>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-white/65">
            Your Instagram handle
            <input
              required
              className={input}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@yourhandle"
            />
          </label>
          <label className="text-xs text-white/65">
            Public Instagram post or reel link
            <input
              required
              type="url"
              className={input}
              value={post}
              onChange={(e) => setPost(e.target.value)}
              placeholder="https://www.instagram.com/p/…"
            />
          </label>
        </div>
        <label className="mt-5 block text-xs leading-5 text-white/65">
          Evidence screenshot showing your follow, set-experience post, @tag and
          #ad / prize-entry disclosure
          <input
            required
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={input}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="mt-5 space-y-3 text-xs leading-5 text-white/60">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              required
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="mt-1 accent-amber-200"
            />
            <span>
              I follow{" "}
              <a
                href={REVIEW_SOCIAL.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-200 underline"
              >
                @{REVIEW_SOCIAL.handle}
              </a>{" "}
              and my public set-experience post tags this account.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              required
              checked={ad}
              onChange={(e) => setAd(e.target.checked)}
              className="mt-1 accent-amber-200"
            />
            <span>
              My post clearly starts with #ad and states it is a DB Cinema £{REVIEW_PRIZE_GBP}{" "}
              story-prize entry.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 accent-amber-200"
            />
            <span>
              I am 18+, live in the UK and accept the{" "}
              <Link
                href="/legal/review-prize"
                target="_blank"
                className="text-amber-200 underline"
              >
                competition terms
              </Link>
              , including evidence checks and public prize-entry labelling.
            </span>
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-xs text-red-300">
            {error}
          </p>
        )}
        <button
          disabled={busy || !bookingId}
          className="btn-primary mt-6 w-full disabled:opacity-40"
        >
          {busy
            ? "Checking settlement & saving…"
            : editing
              ? "Resubmit my corrected entry"
              : "Submit my story & track my entry"}
        </button>
      </form>
    </div>
  );
}
