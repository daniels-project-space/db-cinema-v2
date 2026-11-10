"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";
import { RentalRequestApply } from "./RentalRequestApply";
import { cancellationTimingBasis, isNoRefundWithin48HoursCancellationVersion } from "@/lib/cancellationPolicy";

const labels = { dates: "Date change", items: "Kit change", extension: "Extension", cancel: "Cancellation", handover: "Pickup / return time" };

type PendingApprovedActions = { dates: boolean; cancel: boolean };
export function RentalRequestHistory(props: { token: string; bookingId: string; admin?: boolean; onApprovedActions?: (pending: PendingApprovedActions, ready: boolean) => void }) {
  // Remount drafts and pending response state whenever the private rental scope changes.
  return <RequestHistory key={JSON.stringify([props.token, props.bookingId, !!props.admin])} {...props} />;
}

function RequestHistory({ token, bookingId, admin = false, onApprovedActions }: { token: string; bookingId: string; admin?: boolean; onApprovedActions?: (pending: PendingApprovedActions, ready: boolean) => void }) {
  const { results: requests, status, loadMore } = usePaginatedQuery(api.rentalRequests.list, { token, bookingId: bookingId as any, admin }, { initialNumItems: 30 });
  const review = useMutation(api.rentalRequests.review);
  const applyHandover = useMutation(api.rentalOperations.changeHandoverTimes);
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "declined">("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!admin || !onApprovedActions) return;
    const pending = requests.reduce<PendingApprovedActions>((result, request) => {
      if (request.status === "approved" && !request.execution) {
        if (request.kind === "dates") result.dates = true;
        if (request.kind === "cancel") result.cancel = true;
      }
      return result;
    }, { dates: false, cancel: false });
    onApprovedActions(pending, status !== "LoadingFirstPage");
  }, [admin, onApprovedActions, requests, status]);
  if (!requests.length) return null;
  function open(id: string, next: typeof decision) {
    setSelected(id); setDecision(next); setNote(""); setError(""); setNotice("");
  }
  async function submit() {
    if (!selected || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const request = requests.find(row => row._id === selected);
      if (!request) throw Error("Refresh the rental request and try again.");
      if (decision === "approved" && request.kind === "handover" && (!request.requestId || !request.requestedSnapshot || !request.requestedHandover)) throw Error("This time request is incomplete. Ask the renter to send it again.");
      await review({ token, bookingId: bookingId as any, id: selected as any, decision, note });
      if (decision === "approved" && request.kind === "handover" && request.requestedHandover && request.requestedSnapshot && request.requestId) {
        try {
          await applyHandover({ token, bookingId: bookingId as any, requestId: request.requestId, changeRequestId: selected as any, lineIndexes: request.requestedHandover.lineIndexes, kind: request.requestedHandover.kind, time: request.requestedHandover.time, expectedSnapshot: request.requestedSnapshot, reason: note.trim() });
        } catch (applyError: any) {
          setSelected(null); setNote("");
          throw Error(`Approval was saved, but the time could not be applied: ${applyError.data?.message ?? applyError.message ?? "availability changed"}. Refresh and review the saved request to retry.`);
        }
      }
      setNotice(decision === "approved" && request.kind === "handover" ? "Approved and applied. The renter’s message and rental calendar are updated." : "Decision saved and shared in this rental conversation."); setSelected(null); setNote("");
    } catch (e: any) {
      setError(e.data?.message ?? e.message ?? "The decision could not be saved. Please retry.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className={styles.root} aria-label={admin ? "Review customer requests" : "Your rental requests"}>
    <header><h3>{admin ? "Customer requests" : "Your requests"}</h3><span>{requests.filter(r => r.status === "pending").length} awaiting review{status !== "Exhausted" ? " shown" : ""}</span></header>
    <div className={styles.history}>
      {requests.map(request => <article key={request._id} className={styles.card}>
        <div className={styles.heading}><h4>{labels[request.kind]}</h4><span className={styles.status} data-status={request.status}>{request.execution?.status === "applied" ? "Completed" : request.execution?.status === "processing" ? "Settlement processing" : request.status === "approved" ? "Approved for arrangement" : request.status === "declined" ? "Declined" : "Awaiting team review"}</span></div>
        <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · London</time>
        <p>{request.detail}</p>
        {admin && request.kind === "dates" && request.requestedStart !== undefined && <p className={styles.explanation}>Renter’s proposal: {new Date(request.requestedStart).toISOString().slice(0, 10)} → {request.requestedEnd === undefined ? "return date unavailable" : new Date(request.requestedEnd).toISOString().slice(0, 10)} · all items move together; original duration and handover times stay the same.</p>}
        {request.kind === "handover" && request.requestedHandover && <p className={styles.explanation}>
          Proposed {request.requestedHandover.kind} time · {request.requestedHandover.time} London time · {request.handoverItems?.map((item: { qty: number; title: string }) => `${item.qty}× ${item.title}`).join(", ") ?? `${request.requestedHandover.lineIndexes.length} listings`}.
        </p>}
        {request.kind === "cancel" && request.cancellationKindAtRequest && <p className={styles.explanation}>
          {cancellationTimingBasis(request.cancellationKindAtRequest, request.cancellationTermsVersion) && <>At request time: {cancellationTimingBasis(request.cancellationKindAtRequest, request.cancellationTermsVersion)}. </>}
          {request.cancellationKindAtRequest === "full_refund"
            ? `At request time: ${request.cancellationChoice === "credit" ? "renter chose 100% account credit" : request.cancellationChoice === "refund" ? "renter chose a full refund" : "settlement choice not recorded"}.`
            : request.cancellationKindAtRequest === "store_credit"
              ? "At request time: account credit only under the accepted terms."
              : "At request time: no rental refund or account credit under the accepted terms."}
        </p>}
        {admin && request.kind === "cancel" && isNoRefundWithin48HoursCancellationVersion(request.cancellationTermsVersion) && request.cancellationKindAtRequest === "full_refund" && !request.cancellationChoice && <p className={styles.error}>This older request has no recorded renter choice. Ask them to submit a fresh cancellation request before processing.</p>}
        {request.decisionNote && <div className={styles.reply}><strong>Team reply</strong><p>{request.decisionNote}</p></div>}
        {request.execution?.status === "applied" ? <div className={styles.reply}><strong>Completed update</strong><p>{request.execution.detail}</p></div>
          : request.execution?.status === "processing" ? <p className={styles.explanation}>Cancellation and settlement are processing. The rental remains reserved until payment and any security settlement under the accepted terms are complete.</p>
          : request.status === "approved" && <p className={styles.explanation}>Your rental stays unchanged until the team confirms the update and any payment or refund separately.</p>}
        {admin && request.status === "approved" && !request.execution && (request.kind === "dates" || request.kind === "cancel" || request.kind === "handover") && <RentalRequestApply token={token} bookingId={bookingId} id={request._id} requestId={request.requestId} kind={request.kind} decisionNote={request.decisionNote} requestedStart={request.requestedStart} requestedEnd={request.requestedEnd} requestedSnapshot={request.requestedSnapshot} requestedHandover={request.requestedHandover} handoverItems={request.handoverItems} cancellationKindAtRequest={request.cancellationKindAtRequest} cancellationTermsVersion={request.cancellationTermsVersion} cancellationChoice={request.cancellationChoice} disabled={busy || request.kind === "cancel" && isNoRefundWithin48HoursCancellationVersion(request.cancellationTermsVersion) && request.cancellationKindAtRequest === "full_refund" && !request.cancellationChoice} />}
        {admin && request.status === "pending" && <div className={styles.actions}>
          <button type="button" disabled={busy || request.approvalBlocked} onClick={() => open(request._id, "approved")}>{request.kind === "handover" ? "Review & apply time" : "Approve for arrangement"}</button>
          <button type="button" disabled={busy} onClick={() => open(request._id, "declined")}>Decline request</button>
        </div>}
        {admin && request.status === "pending" && request.approvalBlocked && <p className={styles.explanation}>Finish the active rental operation before approving this request.</p>}
        {admin && selected === request._id && <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label>{decision === "approved" ? "Explain the agreed next step" : "Explain why this cannot be arranged"}<textarea aria-label="Reply to request" required minLength={5} maxLength={1000} disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></label>
          {decision === "approved" && <p className={styles.explanation}>Approval records agreement. Apply the update below to recheck availability and sync the booking calendar.</p>}
          <div className={styles.actions}><button disabled={busy}>{busy ? "Saving…" : decision === "approved" && request.kind === "handover" ? "Approve & apply time" : decision === "approved" ? "Save approval and reply" : "Save decline and reply"}</button><button type="button" disabled={busy} onClick={() => { setSelected(null); setError(""); }}>Back</button></div>
        </form>}
      </article>)}
    </div>
    {(status === "CanLoadMore" || status === "LoadingMore") && <div className={styles.actions}><button type="button" disabled={status === "LoadingMore" || busy} onClick={() => loadMore(30)}>{status === "LoadingMore" ? "Loading earlier requests…" : "Show earlier requests"}</button></div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </section>;
}
