"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";

export function RentalRequestApply({ token, bookingId, id, kind, decisionNote, disabled = false }: {
  token: string; bookingId: string; id: string; kind: "dates" | "cancel"; decisionNote?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
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
  useEffect(() => { setConsent(false); }, [details?.cancellationKind]);
  const reschedule = useMutation(api.rentalOperations.reschedule);
  const cancel = useAction(api.checkout.cancelByAdmin);
  async function submit() {
    if (inFlight.current || !details) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (kind === "dates") {
        if (!start) throw Error("Choose the agreed collection date.");
        await reschedule({ token, bookingId: bookingId as any, changeRequestId: id as any, start: Date.parse(start + "T00:00:00Z"), end: end ? Date.parse(end + "T00:00:00Z") : undefined, keepAgreedPrice: keepPrice, reason });
      } else {
        if (!consent) throw Error("Confirm cancellation under the rental's agreed terms.");
        await cancel({ token, bookingId: bookingId as any, changeRequestId: id as any, reason, expectedCancellationKind: details.cancellationKind });
      }
      setOpen(false);
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "The change could not be completed. Check its status and retry."); setRefreshKey(k => k + 1); if (kind === "cancel") setConsent(false); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!open) return <div className={styles.actions}><button type="button" disabled={disabled || busy} onClick={() => { setOpen(true); setError(""); }}>{kind === "dates" ? "Apply agreed dates" : "Process agreed cancellation"}</button></div>;
  return <form aria-label={kind === "dates" ? "Apply approved date request" : "Apply approved cancellation request"} onSubmit={e => { e.preventDefault(); void submit(); }}>
    {!details ? <p role="status">Loading rental details…</p> : <>
      {kind === "dates" ? <>
        <label>Agreed collection date<input required type="date" value={start} disabled={busy} onChange={e => setStart(e.target.value)} /></label>
        <label>Agreed return date · optional<input type="date" min={start || undefined} value={end} disabled={busy} onChange={e => setEnd(e.target.value)} /></label>
        <p className={styles.explanation}>Leave the return date blank to keep the duration. Existing collection and return times are retained. Stock is checked before the dates change.</p>
        {end && <label className={styles.check}><input required type="checkbox" disabled={busy} checked={keepPrice} onChange={e => setKeepPrice(e.target.checked)} />Keep the agreed charge. Any additional days are complimentary; any refund is handled separately.</label>}
      </> : <>
        <p className={styles.explanation}>{details.cancellationKind === "full_refund" ? "Cancel under the agreed terms: remaining refundable card payment returns to its original payment method and used credit is restored." : "Cancel under the agreed terms: remaining rental value becomes account credit. Refundable security is settled separately."} The request completes after refunds and card authorisation releases are confirmed.</p>
        <label className={styles.check}><input required type="checkbox" disabled={busy} checked={consent} onChange={e => setConsent(e.target.checked)} />Process this agreed cancellation under the rental terms.</label>
      </>}
      <label>Reason for the update<textarea required minLength={5} maxLength={400} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </>}
    <div className={styles.actions}><button disabled={busy || !details || disabled}>{busy ? "Processing…" : kind === "dates" ? "Confirm date update" : "Confirm cancellation and settlement"}</button><button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Back</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
