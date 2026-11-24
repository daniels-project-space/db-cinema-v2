"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function NativeReviewModeration() {
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setToken(localStorage.getItem("dbc_admin")), []);
  const authorized = useQuery(api.bookings.adminAuthorized, token ? { token } : "skip");
  const queue = useQuery(api.reviews.adminPendingNative, token && authorized === true ? { token, limit: 60 } : "skip");
  const moderate = useMutation(api.reviews.moderateNative);

  function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    localStorage.setItem("dbc_admin", value);
    setToken(value);
    setInput("");
  }

  function lock() {
    localStorage.removeItem("dbc_admin");
    setToken(null);
  }

  async function decide(reviewId: string, decision: "approve" | "reject") {
    const note = notes[reviewId]?.trim();
    if (decision === "reject" && (!note || note.length < 5)) {
      setError("Add a short reason before keeping a review private.");
      return;
    }
    setWorking(reviewId);
    setError("");
    setNotice("");
    try {
      await moderate({ token: token!, reviewId: reviewId as any, decision, note });
      setNotice(decision === "approve" ? "Review approved and published." : "Review kept private. The renter can revise it.");
      setNotes(current => ({ ...current, [reviewId]: "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this review. Refresh and try again.");
    } finally {
      setWorking(null);
    }
  }

  return <section aria-label="Website review moderation" className="mt-5 space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#d4a574]">Renter feedback</p><h2 className="mt-1 font-display text-2xl text-[#f3e8db]">Review submissions</h2><p className="mt-1 text-sm text-white/50">New reviews stay private until approved.</p></div>
      {token && <button type="button" onClick={lock} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white/85">Lock admin</button>}
    </header>

    {!token && <form onSubmit={enter} className="max-w-md rounded-2xl border border-white/10 bg-white/[.035] p-4">
      <label htmlFor="review-admin-passcode" className="text-xs text-white/70">Admin passcode</label>
      <div className="mt-2 flex gap-2"><input id="review-admin-passcode" type="password" autoComplete="current-password" value={input} onChange={event => setInput(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-[#d4a574]/60"/><button className="rounded-lg bg-[#c89b6d] px-4 text-xs font-semibold text-[#21170e]">Unlock</button></div>
    </form>}
    {token && authorized === false && <p role="alert" className="rounded-xl border border-rose-300/15 bg-rose-300/[.05] p-3 text-sm text-rose-100/75">Admin access was not accepted. Return to the admin page to sign in again.</p>}
    {authorized === true && queue === undefined && <p role="status" className="text-sm text-white/50">Loading submissions…</p>}
    {queue?.authorized && queue.items.length === 0 && <div className="rounded-2xl border border-white/10 bg-white/[.025] p-5 text-sm text-white/55">All clear — no reviews need attention.</div>}
    {queue?.authorized && queue.items.map(review => {
      const key = String(review._id);
      return <article key={key} data-testid="review-moderation-card" className="overflow-hidden rounded-2xl border border-white/[.09] bg-[#171615]/90 shadow-[0_18px_50px_-36px_#000]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] px-4 py-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white/90">{review.author}</h3><p className="mt-1 text-[11px] text-white/45">{review.product ?? "Rental review"} · {review.rating}/5 stars · {new Date(review.date).toLocaleDateString("en-GB")}</p></div>
          {review.bookingId && <a href={`/admin?rental=${encodeURIComponent(String(review.bookingId))}`} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-white/65 hover:border-[#d4a574]/35 hover:text-[#f1c48f]">Open rental ↗</a>}
        </div>
        <p className="whitespace-pre-wrap break-words px-4 py-4 text-sm leading-6 text-white/75">{review.text}</p>
        {review.incentivized && <p className="px-4 pb-2 text-[10px] text-[#dfb57f]">Disclosure: incentivised {review.prizeEntry ? "· story prize entry" : review.encoreReward ? "· Encore benefit" : ""}</p>}
        <div className="space-y-3 border-t border-white/[.07] bg-black/10 p-4">
          <label className="block text-[10px] font-medium uppercase tracking-[.12em] text-white/45">Private rejection note</label>
          <textarea aria-label={`Rejection note for ${review.author}`} maxLength={500} value={notes[key] ?? ""} onChange={event => setNotes(current => ({ ...current, [key]: event.target.value }))} placeholder="Required only if rejecting" rows={2} className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs leading-5 text-white/80 outline-none placeholder:text-white/30 focus:border-[#d4a574]/50" />
          <div className="flex flex-wrap gap-2"><button type="button" disabled={working === key} onClick={() => void decide(key, "approve")} className="min-h-10 rounded-lg bg-[#c89b6d] px-4 text-xs font-semibold text-[#21170e] disabled:opacity-50">{working === key ? "Saving…" : "Approve & publish"}</button><button type="button" disabled={working === key} onClick={() => void decide(key, "reject")} className="min-h-10 rounded-lg border border-white/15 px-4 text-xs text-white/70 hover:border-rose-200/30 hover:text-rose-100 disabled:opacity-50">Keep private</button></div>
        </div>
      </article>;
    })}
    {notice && <p role="status" className="text-sm text-emerald-200/80">{notice}</p>}
    {error && <p role="alert" className="text-sm text-rose-200/80">{error}</p>}
  </section>;
}
