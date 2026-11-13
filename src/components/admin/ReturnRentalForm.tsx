"use client";
import { hasCashDepositPolicy, ASSESSMENT_SECURITY_POLICY_VERSION, cardLimitForPolicy, depositForBookingPolicy, isCardHoldSecurityPolicy, isSetupIntentSecurityPolicy } from "../../../shared/rentalSecurity";

import { REFUNDABLE_DEPOSIT_POLICY_VERSION } from "../../../shared/rentalSecurity";
import {DepositRefundStatus} from "./DepositRefundStatus";
import { DepositSettlementControl } from "./DepositSettlementControl";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { lateFeeQuote } from "@cvx/lib/lateFee";
import { formatGbp } from "@/lib/pricing";
import { normalizeReturnInspection, type InspectionInput } from "../../../shared/returnInspection";
import { ReturnSettlementReview } from "./ReturnSettlementReview";
import styles from "./ReturnRentalForm.module.css";
import { SmartImage } from "../SmartImage";

import {isSavedCardRental,savedCardRentalValue} from "../../../shared/savedCardSecurity";

type ReturnClaimOutcome = { kind: "damage" | "late"; amount: number; status: string; message?: string };

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
  const [reviewed, setReviewed] = useState<{ key: string; data: any } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const saved = booking.returnDecision;
  const refundablePolicy=hasCashDepositPolicy(booking.securityPolicyVersion);
  const [depositKept,setDepositKept]=useState<number>(saved?.depositKept??0);
  const schedule = useQuery(api.returnInspections.schedule, { token, bookingId: booking._id });
  const [conditions, setConditions] = useState<Record<string, InspectionInput>>(() => Object.fromEntries((saved?.inspection ?? []).map((i: InspectionInput) => [i.key, { key: i.key, condition: i.condition, details: i.details, openCase: i.openCase }])));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  const [returnedAt, setReturnedAt] = useState(() => saved ? new Date(saved.actualReturnedAt - new Date(saved.actualReturnedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : localNow());
  const [damage, setDamage] = useState(() => String(saved?.damageKept ?? 0));
  const [damageNote, setDamageNote] = useState(() => saved?.damageNote ?? "");
  const [chargeLate, setChargeLate] = useState(() => saved?.chargeLate ?? false);
  const waiverReason = saved?.lateWaiverReason ?? "";
  const [lateClaimReason, setLateClaimReason] = useState(() => saved?.lateClaimReason ?? "");
  const [ownerClaimToken, setOwnerClaimToken] = useState("");
  const legacyReturnDecision = !!saved && saved.lateClaimPolicyVersion !== "owner-claim-v1";
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{ released: number; kept: number; lateAmount: number; refundState?: string; claims?: ReturnClaimOutcome[] } | null>(null);
  const parsedAt = new Date(returnedAt).getTime();
  const savedMinute = saved ? new Date(saved.actualReturnedAt - new Date(saved.actualReturnedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : null;
  const at = saved && returnedAt === savedMinute ? saved.actualReturnedAt : parsedAt;
  const quote = useMemo(() => {
    try { return Number.isFinite(at) ? lateFeeQuote(booking.lineItems, booking.returnTime, at) : null; }
    catch { return null; }
  }, [booking.lineItems, booking.returnTime, at]);
  const damageAmount = Number(damage);
  const savedCard=isSavedCardRental(booking);
  const cardHoldPolicy=isCardHoldSecurityPolicy(booking.securityPolicyVersion);
  const setupIntentPolicy=isSetupIntentSecurityPolicy(booking.securityPolicyVersion);
  const [claimDamage,setClaimDamage]=useState(!!saved&&((saved.damageKept??0)>0||(saved.depositKept??0)>0));
  const [claimBasis,setClaimBasis]=useState<""|"loss"|"severe_cosmetic_damage">(saved?.claimBasis??"");
  const damageClaimNeeded=damageAmount>0||(refundablePolicy&&depositKept>0);
  const ownerClaimNeeded=(claimDamage&&(damageAmount>0||(refundablePolicy&&depositKept>0)))||(chargeLate&&(quote?.amount??0)>0);
  let damageLimit=booking.depositAmount+(booking.depositHoldAmount??0);
  if(savedCard){try{damageLimit=savedCardRentalValue(booking);}catch{damageLimit=0;}}
  const legacyResume = !!saved && !saved.inspection;
  const inspectionValid = useMemo(() => {
    if (legacyResume) return true;
    if (!schedule) return false;
    try { normalizeReturnInspection(schedule.items, Object.values(conditions), damageAmount); return true; } catch { return false; }
  }, [legacyResume, schedule, conditions, damageAmount]);
  const valid = !!quote && Number.isFinite(at) && at <= Date.now() + 60000 && Number.isFinite(damageAmount) && damageAmount >= 0 &&
    damageAmount <= damageLimit && (!refundablePolicy || (Number.isFinite(depositKept)&&depositKept>=0&&depositKept<=Math.min(booking.depositAmount??0,damageAmount))) &&
    (damageAmount === 0 || damageNote.trim().length >= 10) &&
    (!damageClaimNeeded || claimDamage) &&
    (!chargeLate || !quote?.amount || legacyReturnDecision || lateClaimReason.trim().length >= 10) &&
    (!setupIntentPolicy || damageAmount <= 0 || !claimDamage || claimBasis !== "") &&
    (!legacyReturnDecision || chargeLate || !quote?.amount || waiverReason.trim().length >= 5) && inspectionValid;
  const canSettle=valid&&(!ownerClaimNeeded||ownerClaimToken.trim().length>0);

  const selection = {
        token, bookingId: booking._id, actualReturnedAt: at,
        damageKept: claimDamage ? damageAmount : 0, ...(refundablePolicy?{depositKept:claimDamage?depositKept:0}:{}), ...(setupIntentPolicy&&damageAmount>0&&claimDamage&&claimBasis?{claimBasis}:{}), damageNote: claimDamage&&damageAmount ? damageNote.trim() : undefined,
        chargeLate, lateWaiverReason: legacyReturnDecision && !chargeLate ? waiverReason.trim() || undefined : undefined,
        lateClaimReason: chargeLate && quote?.amount ? lateClaimReason.trim() || undefined : undefined,
        inspection: legacyResume ? undefined : schedule?.items.map(i => conditions[i.key]),
  };
  const decisionKey = JSON.stringify(selection);
  const reviewData = reviewed?.key === decisionKey ? reviewed.data : null;
  async function inspectReview() {
    if (!valid || reviewBusy || working) return;
    setReviewBusy(true); setError(null);
    try { const data = await review(selection); if (alive.current) setReviewed({ key: decisionKey, data }); }
    catch (e: any) { if (alive.current) setError(e?.message ?? "Could not prepare the return statement. No settlement has been executed."); }
    finally { if (alive.current) setReviewBusy(false); }
  }

  async function finish() {
    const retrySavedClaim = savedCard && !!saved && ((saved.damageKept ?? 0) > (saved.depositKept ?? 0) || saved.chargeLate);
    if (!canSettle || working || reviewBusy || !reviewData || (reviewData.alreadySettled && !retrySavedClaim)) return;
    setWorking(true);
    setError(null);
    try {
      const result = await submit({...selection,expectedSnapshot:reviewData.snapshot,...(ownerClaimNeeded?{ownerClaimToken:ownerClaimToken.trim()}:{})});
      if (!alive.current) return;
      setOwnerClaimToken("");
      setCompletedResult(result);
    } catch (e: any) { if (alive.current) setError(e?.data?.code === "DEPOSIT_REFUND_REVIEW" ? "The return is saved, but the deposit refund needs Stripe review. Use the refund status panel to open the existing approval; do not create another refund." : e?.message ?? "Return could not be recorded."); }
    finally { if (alive.current) setWorking(false); }
  }

  async function retrySavedClaims() {
    const retrySavedClaim = savedCard && !!saved && ((saved.damageKept ?? 0) > (saved.depositKept ?? 0) || saved.chargeLate);
    if (!retrySavedClaim || !canSettle || working || reviewBusy || !reviewData) return;
    setWorking(true);
    setError(null);
    try {
      const result = await submit({ ...selection, expectedSnapshot: reviewData.snapshot,...(ownerClaimNeeded?{ownerClaimToken:ownerClaimToken.trim()}:{}) });
      if (alive.current) { setOwnerClaimToken(""); setCompletedResult(result); }
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? "The saved return could not be checked again.");
    } finally {
      if (alive.current) setWorking(false);
    }
  }

  function update(key: string, patch: Partial<InspectionInput>) { setConditions(previous => ({ ...previous, [key]: { key, condition: previous[key]?.condition ?? "issue", details: previous[key]?.details ?? "", openCase: previous[key]?.openCase ?? false, ...patch } })); }
  return <dialog ref={dialog} aria-labelledby="return-inspection-title" onCancel={e => { e.preventDefault(); if (!working) onClose(); }} className={styles.drawer}>
    <header className={styles.header}><div><h4 id="return-inspection-title">{completedResult ? "Return recorded" : "Return inspection & settlement"}</h4><p>{completedResult ? "The rental return is saved." : "Inspect each item, record issues and confirm the security settlement."}</p></div><button disabled={working} onClick={onClose} aria-label="Close return inspection">×</button></header>
    {completedResult ? <section className={`${styles.body} space-y-3`} role="status" aria-live="polite">
      <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.08] p-4">
        <p className="text-sm font-semibold text-emerald-100">✓ Return saved</p>
        {refundablePolicy ? <p className="mt-2 text-sm text-white/75">{completedResult.released > 0 ? `${completedResult.refundState === "pending" ? "Refund processing" : "Stripe confirmed refund"} of ${formatGbp(completedResult.released)} to the original payment method. Your bank may take 5–10 business days to show it.` : "No deposit refund is due."}</p> : cardHoldPolicy ? <p className="mt-2 text-sm text-white/75">Any active card authorisation was released. No cash security refund was due.</p> : <p className="mt-2 text-sm text-white/75">No cash security or card hold was taken. No saved-card claim was made.</p>}
      </div>
      {completedResult.kept > 0 && <p className="text-sm text-white/70">Recorded deduction: <strong>{formatGbp(completedResult.kept)}</strong>. The itemised reason is in the return statement.</p>}
      {completedResult.claims?.map(claim => <div key={claim.kind} className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-sm">
        <p className="font-medium text-white">{claim.kind === "damage" ? "Damage / loss claim" : "Late return claim"} · {formatGbp(claim.amount)}</p>
        <p className="mt-1 text-white/65">{claim.status === "paid" ? "Payment confirmed. The itemised assessment and receipt are being emailed." :
          claim.status === "requires_action" ? "The renter’s bank requires an extra approval. No payment is confirmed yet." :
          claim.status === "processing" || claim.status === "uncertain" ? "Payment status is being checked. No second attempt will be made automatically." :
          claim.status === "failed" ? "The bank did not complete payment; nothing was taken." :
          claim.status === "notice_pending" ? "Itemised notice prepared under this rental’s agreed notice period." :
          claim.status === "notice_failed" ? "The itemised notice failed, so no card attempt was made." :
          "The return is saved; this claim needs attention before it can proceed."}</p>
        {claim.status === "needs_attention" && claim.message && <p className="mt-1 text-amber-200">{claim.message}</p>}
      </div>)}
      {completedResult.claims?.some(claim => claim.status === "needs_attention") && <button type="button" disabled={working} onClick={retrySavedClaims} className={styles.secondary}>Retry saved assessment</button>}
      {completedResult.lateAmount > 0 && !completedResult.claims?.some(claim => claim.kind === "late") && <p className="text-sm text-white/70">Late claim recorded: <strong>{formatGbp(completedResult.lateAmount)}</strong>.</p>}
      <p className="text-xs text-white/50">An itemised return statement will be sent by email.</p>
      <button type="button" onClick={onClose} className={styles.confirm}>Done</button>
    </section> : <div className={styles.body}>
    {saved && <p className="mt-2 text-amber-200">A return was started but settlement did not finish. The saved time and amounts are loaded so you can retry safely.</p>}
    {refundablePolicy&&<DepositRefundStatus token={token} bookingId={booking._id}/>}
    {refundablePolicy&&(booking.depositAmount??0)>0&&<DepositSettlementControl paid={booking.depositAmount} kept={depositKept} disabled={working||reviewBusy||!!saved} onChange={value=>{setDepositKept(value);if(value>damageAmount)setDamage(String(value));}}/>}
    {legacyResume ? <p className="mt-3 text-amber-200">This older saved settlement has no individual inspection record. Resume its original financial decision; do not change the amounts during retry.</p> : <section className={styles.inspection}>
      <div className={styles.sectionHeading}><div><h5>Equipment condition</h5><p>{schedule ? `${schedule.items.length} individual items · ${schedule.items.filter(i => !!conditions[i.key]).length} conditions selected` : "Loading reserved equipment…"}</p></div><button disabled={working || !!saved || !schedule} onClick={() => { setConditions(Object.fromEntries(schedule!.items.map(i => [i.key, { key: i.key, condition: "good", details: "", openCase: false }]))); setDamage("0"); setDamageNote(""); }}>Mark all good</button></div>
      {schedule?.legacy && <p className="mt-2 text-xs text-amber-200">This legacy rental has no physical inventory schedule. The booked listings and quantities are shown.</p>}
      <div className={styles.items}>{schedule?.items.map((item, index) => { const value = conditions[item.key]; return <article key={item.key} aria-label={item.title} data-condition={value?.condition ?? "pending"}>
        <div className={styles.itemHeading}><SmartImage fit="contain" src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className={styles.itemPhoto} imgClassName={styles.containedPhoto} /><div><h6>{item.title}</h6>{item.sku && <p className={styles.sku}>Inventory SKU · {item.sku}</p>}<p className={styles.itemIndex}>Inspection item {index + 1}</p></div></div>
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
      {quote && quote.amount > 0 && <label className="mt-2 flex items-center gap-2"><input type="checkbox" disabled={working || reviewBusy || !!saved} checked={chargeLate} onChange={(e) => setChargeLate(e.target.checked)} /> I am claiming this late amount</label>}
      {quote && quote.amount > 0 && chargeLate && <label className="mt-2 block">Reason for your claim<input disabled={working || reviewBusy || !!saved} value={lateClaimReason} onChange={(e) => setLateClaimReason(e.target.value)} className="input mt-1 w-full" placeholder="Explain the reason for claiming this amount" /></label>}
      {quote && quote.amount > 0 && !chargeLate && <p className="mt-2 text-emerald-200">No late fee will be claimed.</p>}
    </div>
    <p className="mt-3 text-white/45">{savedCard ? refundablePolicy ? "The cash deposit is settled separately. A card claim can cover only any eligible amount not covered by retained cash." : isSetupIntentSecurityPolicy(booking.securityPolicyVersion) ? "No claim means no card charge. Any claim needs an amount, itemised evidence and a reason." : "A saved-card claim follows this rental’s signed notice and dispute terms. No unclaimed amount is taken." : cardHoldPolicy ? "No claim means no amount is captured. Any unused card hold is released when the return is settled." : "A damage deduction requires an amount, itemised evidence and a reason. Otherwise, the full unused deposit is refunded."}</p>
    </details>
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
    {!inspectionValid && !legacyResume && <p className="mt-3 text-amber-200">Select a condition for every item and complete the required issue details. Any deduction must correspond to an item with an issue.</p>}
    <ReturnSettlementReview data={reviewData} busy={reviewBusy || working} enabled={valid} onReview={inspectReview} paymentSummary={<section className={styles.paymentSummary}><h4>Payment summary</h4><dl><div><dt>Paid refundable deposit</dt><dd>{formatGbp(booking.depositAmount ?? 0)}</dd></div>{booking.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION&&<div><dt>{savedCard?"Saved-card collection limit · not held":"Original card authorisation"}</dt><dd>{formatGbp(savedCard?booking.savedCardLimit:booking.depositHoldAmount ?? 0)}</dd></div>}</dl><p>{savedCard ? refundablePolicy ? "The deposit decision controls the cash refund. An additional card claim uses only the amount not covered by retained cash." : "No security funds were held. A card payment is attempted only for an explicit, itemised claim." : "The review checks the current card balance and calculates the cash refund separately."}</p><label>{savedCard ? "Damage or loss amount to claim (£)" : "Documented damage or loss to retain (£)"}<input type="number" disabled={working || reviewBusy || !!saved} min="0" max={Number.isFinite(damageLimit)?damageLimit:undefined} step="0.01" value={damage} onChange={e => {setDamage(e.target.value);if(refundablePolicy)setDepositKept(previous=>Math.min(previous,Math.max(0,Number(e.target.value))));}} /></label>{damageClaimNeeded && <label className={styles.damageClaim}><input type="checkbox" disabled={working || reviewBusy || !!saved} checked={claimDamage} onChange={e => setClaimDamage(e.target.checked)} /><span>I am claiming this amount</span></label>}{damageAmount > 0 && <label>Itemised evidence and reason<textarea disabled={working || reviewBusy || !!saved} value={damageNote} onChange={e => setDamageNote(e.target.value)} rows={3} placeholder="Item, evidence and amount calculation" /></label>}{setupIntentPolicy && damageAmount > 0 && claimDamage && <label>Claim basis<select disabled={working || reviewBusy || !!saved} value={claimBasis} onChange={e => setClaimBasis(e.target.value as typeof claimBasis)} className="input mt-1 w-full"><option value="">Choose claim basis</option><option value="severe_cosmetic_damage">Severe permanent cosmetic damage</option><option value="loss">Lost / unreturned item</option></select></label>}</section>} />
    {ownerClaimNeeded && <label className="mt-3 block rounded-xl border border-amber-200/15 bg-amber-100/[.035] p-3 text-xs text-white/70">Owner claim code<input type="password" autoComplete="off" aria-label="Owner return claim code" value={ownerClaimToken} onChange={event=>setOwnerClaimToken(event.target.value)} className="input mt-1 w-full" placeholder="Required to keep or charge money" /><span className="mt-1 block text-[10px] text-white/45">Clean returns need no code.</span></label>}
    <button type="button" disabled={!canSettle || working || reviewBusy || !reviewData || (reviewData.alreadySettled && !(savedCard && !!saved && ((saved.damageKept ?? 0) > (saved.depositKept ?? 0) || saved.chargeLate)))} onClick={finish} className={styles.confirm}>{working ? "Settling…" : reviewData?.alreadySettled ? "Retry / check saved claim" : refundablePolicy?"Confirm return and deposit refund":savedCard?"Confirm return":"Confirm settlement and email renter"}</button>
    </div>}
  </dialog>;
}
