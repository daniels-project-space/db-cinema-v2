"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { lateFeeQuote } from "@cvx/lib/lateFee";
import { formatGbp } from "@/lib/pricing";
import { normalizeReturnInspection, type InspectionInput } from "../../../shared/returnInspection";
import { ReturnSettlementReview } from "./ReturnSettlementReview";
import styles from "./ReturnRentalForm.module.css";
import { SmartImage } from "../SmartImage";

const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function ReturnRentalForm({ booking, token, onClose }: { booking: any; token: string; onClose: () => void }) {
  return <ScopedReturnRentalForm key={JSON.stringify([booking._id, token])} booking={booking} token={token} onClose={onClose} />;
}

function ScopedReturnRentalForm({ booking, token, onClose }: { booking: any; token: string; onClose: () => void }) {
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const submit = useAction(api.checkout.markReturned);
  const review = useAction(api.checkout.previewReturned);
  const recover = useAction(api.checkout.retryReturnDeposit);
  const [recoveryReason, setRecoveryReason] = useState("");
  const recoveryIdentity = useRef<{requestId:string;reason:string}|null>(null);
  const [reviewed, setReviewed] = useState<{ key: string; data: any } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const saved = booking.returnDecision;
  const schedule = useQuery(api.returnInspections.schedule, { token, bookingId: booking._id });
  const [conditions, setConditions] = useState<Record<string, InspectionInput>>(() => Object.fromEntries((saved?.inspection ?? []).map((i: InspectionInput) => [i.key, { key: i.key, condition: i.condition, details: i.details, openCase: i.openCase }])));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  const [returnedAt, setReturnedAt] = useState(() => saved ? new Date(saved.actualReturnedAt - new Date(saved.actualReturnedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : localNow());
  const [damage, setDamage] = useState(() => String(saved?.damageKept ?? 0));
  const [damageNote, setDamageNote] = useState(() => saved?.damageNote ?? "");
  const [chargeLate, setChargeLate] = useState(() => saved?.chargeLate ?? true);
  const [waiverReason, setWaiverReason] = useState(() => saved?.lateWaiverReason ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAt = new Date(returnedAt).getTime();
  const savedMinute = saved ? new Date(saved.actualReturnedAt - new Date(saved.actualReturnedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : null;
  const at = saved && returnedAt === savedMinute ? saved.actualReturnedAt : parsedAt;
  const quote = useMemo(() => {
    try { return Number.isFinite(at) ? lateFeeQuote(booking.lineItems, booking.returnTime, at) : null; }
    catch { return null; }
  }, [booking.lineItems, booking.returnTime, at]);
  const damageAmount = Number(damage);
  const legacyResume = !!saved && !saved.inspection;
  const inspectionValid = useMemo(() => {
    if (legacyResume) return true;
    if (!schedule) return false;
    try { normalizeReturnInspection(schedule.items, Object.values(conditions), damageAmount); return true; } catch { return false; }
  }, [legacyResume, schedule, conditions, damageAmount]);
  const valid = !!quote && Number.isFinite(at) && at <= Date.now() + 60000 && Number.isFinite(damageAmount) && damageAmount >= 0 &&
    damageAmount <= booking.depositAmount + (booking.depositHoldAmount ?? 0) &&
    (damageAmount === 0 || damageNote.trim().length >= 10) &&
    (chargeLate || !quote?.amount || waiverReason.trim().length >= 5) && inspectionValid;

  const selection = {
        token, bookingId: booking._id, actualReturnedAt: at,
        damageKept: damageAmount, damageNote: damageAmount ? damageNote.trim() : undefined,
        chargeLate, lateWaiverReason: !chargeLate ? waiverReason.trim() || undefined : undefined,
        inspection: legacyResume ? undefined : schedule?.items.map(i => conditions[i.key]),
  };
  const decisionKey = JSON.stringify(selection);
  const reviewData = reviewed?.key === decisionKey ? reviewed.data : null;
  async function inspectReview() {
    if (!valid || reviewBusy || working) return;
    setReviewBusy(true); setError(null); setReviewed(null);
    try { const data = await review(selection); if (alive.current) setReviewed({ key: decisionKey, data }); }
    catch (e: any) { if (alive.current) setError(e?.message ?? "Could not prepare the return statement. No settlement has been executed."); }
    finally { if (alive.current) setReviewBusy(false); }
  }

  async function finish() {
    if (!valid || working || reviewBusy || !reviewData || reviewData.alreadySettled) return;
    setWorking(true);
    setError(null);
    try {
      const result = await submit(selection);
      if (!alive.current) return;
      const pending=result.refundStatus&&result.refundStatus!=="succeeded";
      alert(`Return recorded. Damage/loss ${formatGbp(result.kept)}; cash deposit refund confirmed ${formatGbp(result.released)}; separate late charge assessed ${formatGbp(result.lateAmount)}. ${pending ? `The deposit refund is ${result.refundStatus === "pending" ? "processing" : "awaiting team review"}. Resume this settlement to check the existing refund. The final statement waits for bank confirmation.` : "The return statement is queued for email delivery."}`);
      onClose();
    } catch (e: any) { if (alive.current) setError(e?.message ?? "Return could not be recorded."); }
    finally { if (alive.current) setWorking(false); }
  }

  async function retryFailedRefund() {
    if (working || reviewBusy || reviewData?.refundProgress?.status !== "failed" || recoveryReason.trim().length < 10) return;
    setWorking(true); setError(null); setReviewed(null);
    const reason = recoveryReason.trim();
    if (!recoveryIdentity.current || recoveryIdentity.current.reason !== reason) recoveryIdentity.current = { requestId: crypto.randomUUID(), reason };
    try {
      const result = await recover({token,bookingId:booking._id,...recoveryIdentity.current});
      if (!alive.current) return;
      const data = await review(selection);
      if (!alive.current) return;
      setReviewed({key:decisionKey,data});
      if (alive.current && result.status !== "succeeded") setError(result.status === "pending" ? "The retry is processing. Reconcile this saved attempt before authorising another repayment." : "The retry has not completed. Review its saved bank receipt before authorising another repayment.");
    } catch (e:any) { if (alive.current) setError(e?.message ?? "Deposit recovery needs review. Resume the saved attempt before another payout."); }
    finally { if (alive.current) setWorking(false); }
  }

  function update(key: string, patch: Partial<InspectionInput>) { setConditions(previous => ({ ...previous, [key]: { key, condition: previous[key]?.condition ?? "issue", details: previous[key]?.details ?? "", openCase: previous[key]?.openCase ?? false, ...patch } })); }
  return <dialog ref={dialog} aria-labelledby="return-inspection-title" onCancel={e => { e.preventDefault(); if (!working) onClose(); }} className={styles.drawer}>
    <header className={styles.header}><div><h4 id="return-inspection-title">Return inspection & settlement</h4><p>Inspect each item, record issues and confirm the security settlement.</p></div><button disabled={working} onClick={onClose} aria-label="Close return inspection">×</button></header>
    <div className={styles.body}>
    {saved && <p className="mt-2 text-amber-200">A return was started but settlement did not finish. The saved time and amounts are loaded so you can retry safely.</p>}
    {legacyResume ? <p className="mt-3 text-amber-200">This older saved settlement has no individual inspection record. Resume its original financial decision; do not change the amounts during retry.</p> : <section className={styles.inspection}>
      <div className={styles.sectionHeading}><div><h5>Equipment condition</h5><p>{schedule ? `${schedule.items.length} individual items · ${schedule.items.filter(i => !!conditions[i.key]).length} conditions selected` : "Loading reserved equipment…"}</p></div><button disabled={working || !!saved || !schedule} onClick={() => { setConditions(Object.fromEntries(schedule!.items.map(i => [i.key, { key: i.key, condition: "good", details: "", openCase: false }]))); setDamage("0"); setDamageNote(""); }}>Mark all good</button></div>
      {schedule?.legacy && <p className="mt-2 text-xs text-amber-200">This legacy rental has no physical inventory schedule. The booked listings and quantities are shown.</p>}
      <div className={styles.items}>{schedule?.items.map((item, index) => { const value = conditions[item.key]; return <article key={item.key} aria-label={item.title} data-condition={value?.condition ?? "pending"}>
        <div className={styles.itemHeading}><SmartImage src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className={styles.itemPhoto} imgClassName={styles.containedPhoto} /><div><h6>{item.title}</h6>{item.sku && <p className={styles.sku}>Inventory SKU · {item.sku}</p>}<p className={styles.itemIndex}>Inspection item {index + 1}</p></div></div>
        <div className={styles.condition} role="group" aria-label={`Condition for ${item.title}`}><button disabled={working || !!saved} aria-pressed={value?.condition === "good"} onClick={() => update(item.key, { condition: "good", details: "", openCase: false })}>✓ Good condition</button><button disabled={working || !!saved} aria-pressed={value?.condition === "issue"} onClick={() => update(item.key, { condition: "issue" })}>○ Issues found</button></div>
        {value?.condition === "issue" && <><label>Issue details (required)<textarea disabled={working || !!saved} maxLength={2000} rows={3} value={value.details} onChange={e => update(item.key, { details: e.target.value })} placeholder="Describe damage, loss and the evidence" /></label><label className={styles.case}><input type="checkbox" disabled={working || !!saved} checked={value.openCase} onChange={e => update(item.key, { openCase: e.target.checked })} /><span>Open damage case<small>Creates a rental/account case and preserves verification copies while it remains open.</small></span></label></>}
      </article>; })}</div>
    </section>}
    <details className={styles.returnTiming}><summary>Return time &amp; late rental · {quote ? formatGbp(quote.amount) : "—"}</summary>
    <p className="mt-1 text-white/45">The return time is entered in your device’s local timezone. Late days are calculated against the agreed London return time and each item’s booked daily rate.</p>
    <label className="mt-3 block">Actual physical return time<input type="datetime-local" disabled={working || reviewBusy || !!saved} value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} className="input mt-1 w-full [color-scheme:dark]" /></label>
    <div className="mt-3 rounded-lg border border-white/10 p-2.5">
      <div className="font-semibold text-white">Late rental time · {quote ? formatGbp(quote.amount) : "—"}</div>
      {!booking.returnTime && !booking.lineItems.some((li: { returnTime?: string | null }) => li.returnTime) && <p className="mt-1 text-amber-200">No agreed return time is stored for this booking, so no automatic late charge can be assessed.</p>}
      {quote?.breakdown.map((line, i) => <div key={i} className="mt-1 flex justify-between gap-2"><span>{line.title} · {line.days} commenced day{line.days === 1 ? "" : "s"} × {formatGbp(line.dailyRate)}</span><span>{formatGbp(line.amount)}</span></div>)}
      {quote?.breakdown.some((line) => line.dailyRate === 0) && <p className="mt-1 text-amber-200">A booked daily rate is missing for at least one item; it will not be charged automatically.</p>}
      {quote && quote.amount > 0 && <label className="mt-2 flex items-center gap-2"><input type="checkbox" disabled={working || reviewBusy || !!saved} checked={chargeLate} onChange={(e) => setChargeLate(e.target.checked)} /> Apply this separately agreed late rental charge</label>}
      {quote && quote.amount > 0 && !chargeLate && <label className="mt-2 block">Reason for waiving late time<input disabled={working || reviewBusy || !!saved} value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)} className="input mt-1 w-full" placeholder="Required for the booking record" /></label>}
    </div>
    <p className="mt-3 text-white/45">An active card hold covers damage first. If there is no damage, an unused active hold may cover the late charge after the separate notice and dispute period. Any remaining late balance is a separate saved-card attempt.</p>
    </details>
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
    {!inspectionValid && !legacyResume && <p className="mt-3 text-amber-200">Select a condition for every item and complete the required issue details. Any deduction must correspond to an item with an issue.</p>}
    <ReturnSettlementReview data={reviewData} busy={reviewBusy || working} enabled={valid} onReview={inspectReview} paymentSummary={<section className={styles.paymentSummary}><h4>Payment summary</h4><dl><div><dt>Paid refundable deposit</dt><dd>{formatGbp(booking.depositAmount ?? 0)}</dd></div><div><dt>Original card authorisation</dt><dd>{formatGbp(booking.depositHoldAmount ?? 0)}</dd></div></dl><p>The review checks the current card balance and calculates the cash refund separately.</p><label>Documented damage or loss to retain (£)<input type="number" disabled={working || reviewBusy || !!saved} min="0" max={booking.depositAmount + (booking.depositHoldAmount ?? 0)} step="0.01" value={damage} onChange={e => setDamage(e.target.value)} /></label>{damageAmount > 0 && <label>Itemised evidence and reason<textarea disabled={working || reviewBusy || !!saved} value={damageNote} onChange={e => setDamageNote(e.target.value)} rows={3} placeholder="Describe the item, damage or loss, evidence, and calculation" /></label>}</section>} />
    {reviewData?.refundProgress?.status === "failed" && <section className={`${styles.paymentSummary} ${styles.recoveryCard}`} aria-label="Failed deposit refund recovery"><div className={styles.recoveryHeading}><span aria-hidden="true" className={styles.recoveryIcon}>↻</span><h4>Retry failed deposit refund</h4></div><p>Return only the outstanding deposit to its original payment method. Stripe must confirm the failed repayment returned to the business before another attempt.</p><label>Admin reason<textarea disabled={working || reviewBusy} value={recoveryReason} maxLength={1000} onChange={e => setRecoveryReason(e.target.value)} placeholder="Explain why this failed repayment should be retried" /></label><button type="button" disabled={working || reviewBusy || recoveryReason.trim().length < 10} onClick={retryFailedRefund}>Authorise original-payment retry</button></section>}
    <button type="button" disabled={!valid || working || reviewBusy || !reviewData || reviewData.alreadySettled} onClick={finish} className={styles.confirm}>{working ? "Settling…" : "Confirm settlement and email renter"}</button>
    </div>
  </dialog>;
}
