"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";
import { cancellationTimingBasis, isNoRefundWithin48HoursCancellationVersion } from "@/lib/cancellationPolicy";

export function RentalRequestApply({ token, bookingId, id, requestId, kind, decisionNote, requestedStart, requestedEnd, requestedSnapshot, requestedHandover, handoverItems, cancellationKindAtRequest, cancellationTermsVersion, cancellationChoice, disabled = false }: {
  token: string; bookingId: string; id: string; requestId?: string; kind: "dates" | "cancel" | "handover"; decisionNote?: string; disabled?: boolean;
  requestedStart?: number; requestedEnd?: number; requestedSnapshot?: string;
  requestedHandover?: { lineIndexes: number[]; kind: "pickup" | "return"; time: string };
  handoverItems?: { title: string; qty: number }[];
  cancellationKindAtRequest?: "full_refund" | "store_credit" | "no_refund";
  cancellationTermsVersion?: string;
  cancellationChoice?: "refund" | "credit";
}) {
  const [open, setOpen] = useState(false);
  const requestedStartText = requestedStart === undefined ? "" : new Date(requestedStart).toISOString().slice(0, 10);
  const [start, setStart] = useState(requestedStartText);
  const [end, setEnd] = useState("");
  const [keepPrice, setKeepPrice] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState((decisionNote ?? "Apply the agreed customer request.").slice(0, 400));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { if (!open || kind !== "cancel") return; const timer = setInterval(() => setRefreshKey(k => k + 1), 60000); return () => clearInterval(timer); }, [open, kind]);
  const details = useQuery(api.rentalOperations.details, open ? { token, bookingId: bookingId as any, refreshKey } : "skip");
  const decisionKind = cancellationKindAtRequest ?? details?.cancellationKind;
  const decisionVersion = cancellationTermsVersion ?? details?.cancellationTermsVersion;
  const timingBasis = cancellationTimingBasis(decisionKind, decisionVersion);
  const cancellationExplanation = timingBasis
    ? `At the renter’s request time: ${timingBasis}. ${decisionKind === "no_refund" ? "No rental refund or account credit." : decisionKind === "store_credit" ? "Account credit only." : "The renter could choose a full refund or 100% account credit."} Refundable security is settled separately.`
    : decisionKind === "full_refund"
      ? "Cancel under the accepted terms: remaining refundable card payment returns to its original payment method and used credit is restored."
      : "Cancel under the accepted terms: remaining rental value becomes account credit. Refundable security is settled separately.";
  useEffect(() => { setConsent(false); }, [details?.cancellationKind]);
  const reschedule = useMutation(api.rentalOperations.reschedule);
  const changeHandoverTimes = useMutation(api.rentalOperations.changeHandoverTimes);
  const cancel = useAction(api.checkout.cancelByAdmin);
  async function submit() {
    if (inFlight.current || !details) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (kind === "dates") {
        if (!start) throw Error("Choose the agreed collection date.");
        const startMs = Date.parse(start + "T00:00:00Z");
        if (requestedStart !== undefined && (startMs !== requestedStart || requestedEnd === undefined || !requestedSnapshot)) throw Error("This renter date request is incomplete or no longer matches its saved proposal.");
        await reschedule({ token, bookingId: bookingId as any, changeRequestId: id as any, start: startMs, end: requestedStart === undefined && end ? Date.parse(end + "T00:00:00Z") : undefined, keepAgreedPrice: requestedStart === undefined ? keepPrice : undefined, reason, ...(requestedStart !== undefined ? { expectedSnapshot: requestedSnapshot } : {}) });
      } else if (kind === "cancel") {
        if (!consent) throw Error("Confirm cancellation under the rental's agreed terms.");
        const acceptedKind = cancellationKindAtRequest ?? details.cancellationKind;
        const acceptedVersion = cancellationTermsVersion ?? details.cancellationTermsVersion;
        const choicePolicy = isNoRefundWithin48HoursCancellationVersion(acceptedVersion);
        if (choicePolicy && acceptedKind === "full_refund" && !cancellationChoice) throw Error("Ask the renter to submit a new request with their refund or credit choice.");
        await cancel({ token, bookingId: bookingId as any, changeRequestId: id as any, reason, expectedCancellationKind: acceptedKind, ...(choicePolicy && acceptedKind === "full_refund" && cancellationChoice ? { customerChoice: cancellationChoice } : {}) });
      } else {
        if (!requestedHandover || !requestedSnapshot) throw Error("This approved time request is incomplete. Ask the renter to send it again.");
        if (!requestId) throw Error("This approved time request is missing its execution reference. Refresh the rental and retry.");
        await changeHandoverTimes({ token, bookingId: bookingId as any, requestId, changeRequestId: id as any, lineIndexes: requestedHandover.lineIndexes, kind: requestedHandover.kind, time: requestedHandover.time, expectedSnapshot: requestedSnapshot, reason });
      }
      setOpen(false);
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "The change could not be completed. Check its status and retry."); setRefreshKey(k => k + 1); if (kind === "cancel") setConsent(false); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!open) return <div className={styles.actions}><button type="button" disabled={disabled || busy} onClick={() => { setOpen(true); setError(""); }}>{kind === "dates" ? "Apply agreed dates" : kind === "handover" ? "Apply approved time" : "Process agreed cancellation"}</button></div>;
  return <form aria-label={kind === "dates" ? "Apply approved date request" : kind === "handover" ? "Apply approved pickup or return time" : "Apply approved cancellation request"} onSubmit={e => { e.preventDefault(); void submit(); }}>
    {!details ? <p role="status">Loading rental details…</p> : <>
      {kind === "dates" ? <>
        {requestedStart !== undefined ? <p className={styles.explanation}>Renter’s requested dates · {requestedStartText} → {requestedEnd === undefined ? "return date unavailable" : new Date(requestedEnd).toISOString().slice(0, 10)}. All items move together; original duration, times, and agreed price stay the same.</p> : <>
          <label>Agreed collection date<input required type="date" value={start} disabled={busy} onChange={e => setStart(e.target.value)} /></label>
          <label>Agreed return date · optional<input type="date" min={start || undefined} value={end} disabled={busy} onChange={e => setEnd(e.target.value)} /></label>
          <p className={styles.explanation}>Leave the return date blank to keep the duration. Existing collection and return times are retained. Stock is checked before the dates change.</p>
          {end && <label className={styles.check}><input required type="checkbox" disabled={busy} checked={keepPrice} onChange={e => setKeepPrice(e.target.checked)} />Keep the agreed charge. Any additional days are complimentary; any refund is handled separately.</label>}
        </>}
      </> : kind === "handover" ? <>
        {!requestedHandover || !requestedSnapshot ? <p role="alert" className={styles.error}>This time request is incomplete. Ask the renter to send it again.</p> : <>
          <p className={styles.explanation}>Apply the approved {requestedHandover.kind} time · {requestedHandover.time} London time · {handoverItems?.map(item => `${item.qty}× ${item.title}`).join(", ") ?? `${requestedHandover.lineIndexes.length} listings`}. Availability and the live calendar will be checked again.</p>
        </>}
      </> : <>
        <p className={styles.explanation}>{cancellationExplanation} The decision follows the terms and timing saved with the renter’s request.</p>
        {isNoRefundWithin48HoursCancellationVersion(cancellationTermsVersion ?? details.cancellationTermsVersion) && (cancellationKindAtRequest ?? details.cancellationKind) === "full_refund" && <p className={styles.reply}>{cancellationChoice === "credit" ? "Renter selected 100% account credit · 365 days." : cancellationChoice === "refund" ? "Renter selected a full refund to the original payment method." : "No renter settlement choice was recorded. Ask them to submit a new request before processing."}</p>}
        <label className={styles.check}><input required type="checkbox" disabled={busy} checked={consent} onChange={e => setConsent(e.target.checked)} />Process this agreed cancellation under the rental terms.</label>
      </>}
      <label>Reason for the update<textarea required minLength={5} maxLength={400} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </>}
    <div className={styles.actions}><button disabled={busy || !details || disabled || kind === "handover" && (!requestedHandover || !requestedSnapshot) || kind === "cancel" && isNoRefundWithin48HoursCancellationVersion(cancellationTermsVersion ?? details?.cancellationTermsVersion) && (cancellationKindAtRequest ?? details?.cancellationKind) === "full_refund" && !cancellationChoice}>{busy ? "Processing…" : kind === "dates" ? "Confirm date update" : kind === "handover" ? "Apply approved time" : "Confirm cancellation and settlement"}</button><button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Back</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
