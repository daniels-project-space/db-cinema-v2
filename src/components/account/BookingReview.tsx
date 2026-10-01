"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { IconStar } from "@/components/icons";

export function BookingReview({ bookingId, reviewed = false, token, inline = false }: {
  bookingId: string; reviewed?: boolean; token: string; inline?: boolean;
}) {
  const eligibility = useQuery(api.reviewInvitations.eligibility, { token, bookingId: bookingId as any });
  const check = useAction(api.reviewActions.checkEligibility);
  const submit = useMutation(api.reviews.submitNative);
  const checked = useRef("");
  const [open, setOpen] = useState(inline), [rating, setRating] = useState(0), [text, setText] = useState("");
  const [done, setDone] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  async function verify() {
    setBusy(true); setErr(null);
    try { await check({ token, bookingId: bookingId as any }); }
    catch { setErr("We couldn't confirm the security settlement yet. Please try again shortly."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (eligibility?.canCheck && !eligibility.eligible && checked.current !== bookingId) {
      checked.current = bookingId; void verify();
    }
  }, [eligibility?.canCheck, eligibility?.eligible, bookingId]);
  if (reviewed || done || eligibility?.reviewed) return <p className="text-xs text-emerald-300">Reviewed — thank you!</p>;
  if (!eligibility?.eligible) return err && eligibility?.canCheck ? <div className="text-xs text-white/50"><p>{err}</p><button type="button" disabled={busy} onClick={verify} className="mt-2 text-accent-300">{busy ? "Checking…" : "Check again"}</button></div> : null;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-accent-400">Leave a review</button>;
  async function send() {
    if (busy || !rating) return;
    setBusy(true); setErr(null);
    try { await submit({ token, bookingId: bookingId as any, rating, text }); setDone(true); }
    catch (e: any) { setErr(e.message ?? "Review could not be submitted."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
    <p className="mb-2 text-xs font-medium text-white/80">How was your rental?</p>
    <div className="flex gap-1" role="group" aria-label="Rental rating">
      {[1,2,3,4,5].map(n => <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} aria-pressed={rating === n} className={`rounded-lg p-1.5 ${n <= rating ? "text-accent-400" : "text-white/25"}`}><IconStar filled className="h-5 w-5"/></button>)}
    </div>
    <textarea aria-label="Your rental review" maxLength={2000} value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="How was the gear and service?" className="mt-2 w-full rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"/>
    {err && <p role="alert" className="mt-2 text-xs text-rose-300">{err}</p>}
    <p className="mt-1 text-[10px] text-white/40">Published on our website with your display name and profile photo.</p>
    <div className="mt-3 flex gap-3"><button type="button" disabled={busy || !rating || text.trim().length < 10} onClick={send} className="btn-primary px-4 py-2 text-xs disabled:opacity-40">{busy ? "Saving…" : "Publish review"}</button>{!inline && <button type="button" onClick={() => setOpen(false)} className="text-xs text-white/40">Cancel</button>}</div>
  </div>;
}
