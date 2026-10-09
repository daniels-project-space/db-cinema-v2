"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { PICKUP_SLOTS, HOURS_LABEL } from "@/lib/site";
import { rentalTitle } from "@/lib/rentalPresentation";
import styles from "./RentalExtensionPanel.module.css";

const date = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const labels: Record<string, string> = { pending: "Awaiting team approval", approved: "Approved · preparing payment", awaiting_payment: "Approved · payment required", applied: "Extension confirmed", declined: "Request declined", expired: "Approval expired", withdrawn: "Approval withdrawn", refund_pending: "Payment refund processing", refunded: "Payment refunded" };

export function RentalExtensionPanel({ token, bookingId, admin = false }: { token: string; bookingId: string; admin?: boolean }) {
  return <ExtensionPanel key={JSON.stringify([token, bookingId, admin])} token={token} bookingId={bookingId} admin={admin} />;
}

function ExtensionPanel({ token, bookingId, admin = false }: { token: string; bookingId: string; admin?: boolean }) {
  const state = useQuery(api.rentalExtensions.state, { token, bookingId: bookingId as any, admin });
  const [open, setOpen] = useState(false), [days, setDays] = useState(1), [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0), [reviewId, setReviewId] = useState<string | null>(null), [reason, setReason] = useState("");
  const [returnTime, setReturnTime] = useState(""), [approvedTime, setApprovedTime] = useState("");
  const key = useRef<string | null>(null);
  const quote = useQuery(api.rentalExtensions.quote, open && !admin ? { token, bookingId: bookingId as any, extraDays: days, lineItemIndexes: selected.length ? selected : undefined, refreshKey } : "skip");
  const request = useMutation(api.rentalExtensions.request), decline = useMutation(api.rentalExtensions.decline);
  const approve = useAction(api.rentalExtensionPayments.approve);
  const withdraw = useAction(api.rentalExtensionPayments.withdraw);
  useEffect(() => { const timer = setInterval(() => setRefreshKey(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { setNotice(""); }, [state?.requests[0]?.status]);
  if (!state) return null;
  const current = state.requests.find(r => ["pending", "approved", "awaiting_payment", "refund_pending"].includes(r.status));
  const recent = current ?? state.requests[0];
  const eligible = ["confirmed", "active"].includes(state.status);
  if (!eligible && !recent) return null;
  async function send() {
    if (!quote?.available || !quote.items || quote.priceDelta === undefined || !quote.baseLines || !returnTime || busy) return;
    setBusy(true); setError("");
    try {
      key.current ??= crypto.randomUUID();
      await request({ token, bookingId: bookingId as any, requestKey: key.current, extraDays: days, lineItemIndexes: selected.length ? selected : undefined, expectedAmount: quote.priceDelta, expectedBase: quote.baseLines, requestedReturnTime: returnTime });
      setOpen(false); setNotice("Request sent. Your original return dates remain in place until the team approves and payment succeeds.");
    } catch (e: any) { setError(e.message ?? "Your extension request could not be sent."); }
    finally { setBusy(false); }
  }
  async function decide(accept: boolean) {
    if (!reviewId || busy) return;
    setBusy(true); setError("");
    try {
      if (accept) await approve({ token, requestId: reviewId as any, reason, approvedReturnTime: approvedTime });
      else await decline({ token, requestId: reviewId as any, reason });
      setReviewId(null); setReason(""); setNotice(accept ? "Approved. The payment link is in the renter's chat; dates change only after successful payment." : "Request declined. The renter has been notified in this conversation.");
    } catch (e: any) { setError(e.message ?? "The request could not be updated."); }
    finally { setBusy(false); }
  }
  return <aside id="rental-extension-panel" tabIndex={-1} data-booking-id={bookingId} data-testid="rental-extension-panel" className={`${styles.panel} scroll-mt-24`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-sky-200" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v4m10-4v4M3 10h18m-9 3v5m-2.5-2.5h5"/></svg><span className="text-sm font-medium text-white/85">{admin ? "Extension requests" : "Need more shoot time?"}</span></div>
      {!admin && eligible && !current && <button type="button" data-testid="request-extension-open" disabled={state.locked || busy} onClick={() => { setOpen(!open); setError(""); setNotice(""); key.current = null; }} className="rounded-full border border-sky-200/25 bg-sky-200/10 px-3 py-2 text-xs text-sky-100 disabled:opacity-40">{open ? "Close" : "Request extension"}</button>}
    </div>
    {recent && <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3" data-testid="extension-request-status">
      <div className="flex flex-wrap justify-between gap-2"><span className={`text-xs font-medium ${recent.status === "applied" ? "text-emerald-200" : "text-sky-200"}`}>{labels[recent.status] ?? recent.status}</span>{recent.amount !== null && <span className="text-sm font-semibold text-white">{formatGbp(recent.amount)}</span>}</div>
      <div className="mt-2 space-y-1">{recent.items.map(item => <p key={item.lineIndex} className="text-xs leading-relaxed text-white/60">{item.qty}× {rentalTitle(item.title)} <span className="text-white/60">· return {date(item.end)} at {recent.approvedReturnTime ?? recent.requestedReturnTime ?? "time to confirm"}</span></p>)}</div>
      {recent.reason && ["declined", "expired"].includes(recent.status) && <p className="mt-2 text-xs text-white/55">{recent.reason}</p>}
      {["pending", "approved", "awaiting_payment"].includes(recent.status) && <p className="mt-2 text-[11px] leading-relaxed text-white/65">Original return deadlines apply until approval and payment. The team may adjust the proposed time; the approved time is shown above, in London time. Security amounts stay unchanged.</p>}
      {!admin && recent.url && <a data-testid="extension-pay-link" href={recent.url} className="mt-3 inline-flex rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950">Pay {formatGbp(recent.amount!)} & confirm extension</a>}
      {recent.expiresAt && recent.status === "awaiting_payment" && <p className="mt-2 text-[10px] text-white/60">Payment deadline: {new Date(recent.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })} London time.</p>}
      {admin && recent.status === "pending" && <button type="button" data-testid="extension-review" onClick={() => { setReviewId(recent.id); setApprovedTime(recent.requestedReturnTime ?? ""); setReason(""); setError(""); }} className="mt-3 rounded-full border border-sky-200/30 px-3 py-2 text-xs text-sky-100">Review request</button>}
      {admin && recent.status === "approved" && <button type="button" disabled={busy} onClick={() => { setReviewId(recent.id); setApprovedTime(recent.approvedReturnTime ?? recent.requestedReturnTime ?? ""); setReason(recent.reason ?? "Recovering approved extension"); }} className="mt-3 rounded-full border border-sky-200/30 px-3 py-2 text-xs text-sky-100">Recover payment link</button>}
      {admin && ["approved", "awaiting_payment"].includes(recent.status) && <button type="button" data-testid="extension-withdraw" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await withdraw({ token, requestId: recent.id as any }); setNotice("Unpaid approval withdrawn. The original dates remain in place."); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} className="mt-3 rounded-full border border-white/15 px-3 py-2 text-xs text-white/60 disabled:opacity-40">Withdraw unpaid approval</button>}
      {admin && recent.status === "refund_pending" && <p className="mt-2 text-xs text-amber-200">The rental remains locked until Stripe confirms the refund.</p>}
    </div>}
    {admin && reviewId && <div className="mt-3 rounded-2xl border border-sky-200/20 p-4" data-testid="extension-owner-review">
      <p className="text-xs leading-relaxed text-white/60">Approval rechecks availability and the saved quote, then reserves the extra dates for up to 24 hours. No charge is taken automatically.</p>
      <label className="mt-3 block text-xs text-white/60">Approved return time · London<select data-testid="extension-approved-time" disabled={recent?.status !== "pending" || busy} value={approvedTime} onChange={e => setApprovedTime(e.target.value)} className="mt-1.5 block rounded-xl bg-[#222] px-3 py-2 text-sm text-white"><option value="">Choose time</option>{PICKUP_SLOTS.map(time => <option key={time} value={time}>{time}</option>)}</select><span className="mt-1 block text-[11px] text-white/65">Proposed: {recent?.requestedReturnTime ?? "not supplied"} · allowed {HOURS_LABEL}. Change the time here before approval.</span></label>
      <label className="mt-3 block text-xs text-white/60">Decision reason<input data-testid="extension-decision-reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} className="mt-1.5 w-full rounded-xl bg-black/30 px-3 py-2 text-sm text-white" placeholder="Explain your decision to the renter" /></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" data-testid="extension-approve" disabled={busy || reason.trim().length < 5 || !approvedTime || !state.paymentsEnabled} onClick={() => void decide(true)} className="rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950 disabled:opacity-40">{busy ? "Processing…" : "Approve & send payment link"}</button><button type="button" data-testid="extension-decline" disabled={busy || reason.trim().length < 5} onClick={() => void decide(false)} className="rounded-full border border-rose-300/25 px-4 py-2 text-xs text-rose-200 disabled:opacity-40">Decline</button><button type="button" disabled={busy} onClick={() => setReviewId(null)} className="px-2 py-2 text-xs text-white/65">Close</button></div>
      {!state.paymentsEnabled && <p className="mt-2 text-xs text-amber-200">Live rental payments have not been enabled yet.</p>}
    </div>}
    {!admin && open && !current && <form onSubmit={e => { e.preventDefault(); void send(); }} data-testid="extension-request-form" className="mt-3 space-y-3 rounded-2xl border border-white/10 p-4">
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Extra rental days<select data-testid="extension-extra-days" value={days} disabled={busy} onChange={e => { setDays(Number(e.target.value)); key.current = null; }} className="rounded-lg bg-[#222] px-3 py-2 text-sm text-white">{Array.from({ length: 30 }, (_, i) => <option key={i} value={i + 1}>{i + 1} {i ? "days" : "day"}</option>)}</select></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Proposed return time · London<select required data-testid="extension-return-time" value={returnTime} disabled={busy} onChange={e => { setReturnTime(e.target.value); key.current = null; }} className="rounded-lg bg-[#222] px-3 py-2 text-sm text-white"><option value="">Choose time</option>{PICKUP_SLOTS.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
      <p className="text-[11px] text-white/65">{HOURS_LABEL}. The team may propose a different time before approval.</p>
      {state.items.length > 1 && <fieldset><legend className="mb-2 text-[11px] text-white/65">Choose items · none selected means all</legend><div className="space-y-2">{state.items.map(item => <label key={item.index} className="flex items-start gap-2 text-xs text-white/70"><input type="checkbox" disabled={busy} checked={selected.includes(item.index)} onChange={e => { setSelected(s => e.target.checked ? [...s, item.index].sort((a, b) => a - b) : s.filter(i => i !== item.index)); key.current = null; }} className="mt-0.5 accent-sky-300" />{item.qty}× {rentalTitle(item.title)}</label>)}</div></fieldset>}
      {quote === undefined ? <p className="text-xs text-white/65">Checking dates and price…</p> : quote.available ? <div data-testid="extension-live-quote" className="rounded-xl bg-sky-200/[0.07] p-3"><div className="flex justify-between gap-2"><span className="text-xs text-sky-100">Available · subject to team approval</span><strong className="text-sm text-white">{formatGbp(quote.priceDelta!)}</strong></div>{quote.items?.map(item => <p key={item.lineIndex} className="mt-2 text-xs text-white/55">{rentalTitle(item.title)} · return {date(item.end)}{returnTime ? ` at ${returnTime} London time` : " · choose a time"} · {formatGbp(item.lineTotal)}</p>)}</div> : <p role="status" className="text-xs text-amber-200">{quote.reason} You can message the team below.</p>}
      <p className="text-[11px] leading-relaxed text-white/65">Extra days use the quoted daily gear rates, without additional discounts. Sending this request does not charge your card or change the rental. Approval is followed by a secure payment link.</p>
      <button data-testid="extension-send-request" disabled={busy || !quote?.available || !returnTime} className="rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950 disabled:opacity-35">{busy ? "Sending…" : "Send extension request"}</button>
    </form>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs leading-relaxed text-sky-100/80">{notice}</p>}
  </aside>;
}
