"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { IconStar } from "@/components/icons";
import { ReviewEye } from "@/components/ReviewEye";

export function BookingReview({ bookingId, reviewed = false, token, inline = false }: {
  bookingId: string; reviewed?: boolean; token: string; inline?: boolean;
}) {
  const eligibility = useQuery(api.reviewInvitations.eligibility, { token, bookingId: bookingId as any });
  const check = useAction(api.reviewActions.checkEligibility);
  const submit = useMutation(api.reviews.submitNative);
  const checked = useRef("");
  const reviewInputId = useId();
  const [open, setOpen] = useState(inline), [rating, setRating] = useState(0), [text, setText] = useState("");
  const [done, setDone] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [showProfilePhoto, setShowProfilePhoto] = useState(false);
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
  useEffect(() => { if (inline) setOpen(true); }, [inline]);
  if (reviewed || done || eligibility?.reviewed) return <div role="status" className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-3 text-xs text-emerald-100"><span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-300/30 text-base">✓</span><span>Reviewed — thank you!</span></div>;
  if (!eligibility?.eligible) return err && eligibility?.canCheck ? <div className="text-xs text-white/50"><p>{err}</p><button type="button" disabled={busy} onClick={verify} className="mt-2 text-accent-300">{busy ? "Checking…" : "Check again"}</button></div> : null;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-accent-400">Leave a review</button>;
  async function send() {
    if (busy || !rating) return;
    setBusy(true); setErr(null);
    try { await submit({ token, bookingId: bookingId as any, rating, text, showProfilePhoto }); setDone(true); }
    catch (e: any) { setErr(e.message ?? "Review could not be submitted."); }
    finally { setBusy(false); }
  }
  return <div data-testid="rental-review-form" className="mt-3 min-w-0 max-w-md overflow-hidden rounded-2xl border border-[#d2a36d]/25 bg-[radial-gradient(ellipse_at_top_right,rgba(202,153,98,0.17),transparent_56%),linear-gradient(145deg,#26211e,#141414)] p-4 shadow-[0_16px_40px_-24px_#000] backdrop-blur-xl sm:p-5">
    <div className="mb-4 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#dfb57f]">Trust that is earned</p><p className="mt-1 font-serif text-lg leading-tight text-[#faf1e6]">How was your rental?</p></div><ReviewEye /></div>
    {eligibility.encoreEligible&&<p className="mb-4 rounded-xl border border-[#d5a474]/20 bg-[#d5a474]/[.06] p-3 text-xs leading-5 text-[#e6cfb3]">Your honest review unlocks your next Encore saving. All ratings count equally.</p>}
    <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-[#c8b6a3]">Your rating</p>
    <div className="mt-1 flex flex-wrap items-center gap-0.5" role="group" aria-label="Rental rating">
      {[1,2,3,4,5].map(n => <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} aria-pressed={rating === n} className={`grid h-11 w-11 place-items-center rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 ${n <= rating ? "text-[#e3af72]" : "text-white/45 hover:text-[#d3a774]"}`}><IconStar filled className="h-6 w-6"/></button>)}
    </div>
    <p className="mt-1 text-xs text-[#d6c6b2]" aria-live="polite">{rating ? `${rating} of 5` : "Choose 1 to 5 stars"}</p>
    <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[.13em] text-[#c8b6a3]" htmlFor={reviewInputId}>Your review</label>
    <textarea id={reviewInputId} aria-label="Your rental review" maxLength={2000} value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="How was the gear and service?" className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/45 focus:border-[#d5a474]/60"/>
    <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-xs text-white/70">
      <input type="checkbox" checked={showProfilePhoto} onChange={event => setShowProfilePhoto(event.target.checked)} className="h-4 w-4 accent-[#d5a474]" />
      <span>Show my profile photo with this review</span>
    </label>
    {err && <p role="alert" className="mt-2 text-xs text-rose-300">{err}</p>}
    <p className="mt-1 text-[11px] leading-5 text-white/60">Your name and review are public. Your photo is optional.{eligibility.encoreEligible?" Labelled as an incentivised review.":""}</p>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !rating || text.trim().length < 10} onClick={send} className="min-h-11 rounded-xl bg-[#c89b6d] px-4 text-xs font-semibold text-[#21170e] transition-colors hover:bg-[#deb486] disabled:bg-white/10 disabled:text-white/45">{busy ? "Saving…" : "Publish review"}</button>{!inline && <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs text-white/70">Cancel</button>}</div>
  </div>;
}
