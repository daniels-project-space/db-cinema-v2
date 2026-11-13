"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";
import { RentalRequestApply } from "./RentalRequestApply";
import { cancellationTimingBasis, isNoRefundWithin48HoursCancellationVersion } from "@/lib/cancellationPolicy";

const labels = { dates: "Date change", items: "Kit change", extension: "Extension", cancel: "Cancellation", handover: "Pickup / return time" };

type BlockingRequestActions = { any: boolean; dates: boolean; cancel: boolean; handover: boolean };
type ItemChangeQuoteRequest = { requestId: string; lineIndexes: number[] };
export function RentalRequestHistory(props: { token: string; bookingId: string; admin?: boolean; onBlockingRequests?: (pending: BlockingRequestActions, ready: boolean) => void; onPrepareItemChange?: (request: ItemChangeQuoteRequest) => void }) {
  // Remount drafts and pending response state whenever the private rental scope changes.
  return <RequestHistory key={JSON.stringify([props.token, props.bookingId, !!props.admin])} {...props} />;
}

function RequestHistory({ token, bookingId, admin = false, onBlockingRequests, onPrepareItemChange }: { token: string; bookingId: string; admin?: boolean; onBlockingRequests?: (pending: BlockingRequestActions, ready: boolean) => void; onPrepareItemChange?: (request: ItemChangeQuoteRequest) => void }) {
  const { results: requests, status, loadMore } = usePaginatedQuery(api.rentalRequests.list, { token, bookingId: bookingId as any, admin }, { initialNumItems: 30 });
  const requestBlockers = useQuery(api.rentalRequests.blockingActions, admin ? { token, bookingId: bookingId as any } : "skip");
  const review = useMutation(api.rentalRequests.review);
  const approveAndApply = useAction(api.rentalRequests.approveAndApply);
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "declined">("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!admin || !onBlockingRequests) return;
    const pending: BlockingRequestActions = requestBlockers
      ? { any: requestBlockers.any, dates: requestBlockers.dates, cancel: requestBlockers.cancel, handover: requestBlockers.handover }
      : { any: true, dates: true, cancel: true, handover: true };
    onBlockingRequests(pending, requestBlockers?.ready === true);
  }, [admin, onBlockingRequests, requestBlockers]);
  // The dedicated extension panel owns every live extension decision. Filter
  // its active statuses here so the same request cannot flash in both panels
  // while the sibling query is still loading.
  const liveExtensionStatuses = new Set(["pending", "approved", "awaiting_payment", "refund_pending"]);
  const visibleRequests = admin
    ? requests.filter(request => request.kind !== "extension" || !liveExtensionStatuses.has(request.status))
    : requests;
  if (!visibleRequests.length) return null;
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
      const structuredRequest = request.kind === "dates"
        ? request.requestedStart !== undefined && request.requestedEnd !== undefined && !!request.requestedSnapshot
        : request.kind === "handover"
          ? !!request.requestId && !!request.requestedSnapshot && !!request.requestedHandover
          : request.kind === "cancel"
            ? !!request.cancellationKindAtRequest && !!request.cancellationTermsVersion && (request.cancellationKindAtRequest !== "full_refund" || !!request.cancellationChoice)
            : false;
      if (decision === "approved" && structuredRequest) {
        const result = await approveAndApply({ token, bookingId: bookingId as any, id: selected as any, note });
        setNotice(result.status === "applied"
          ? "Approved and applied here. Rental Manager sync is shown below."
          : result.status === "needs_review"
            ? "Approved. This cancellation needs the payment review shown below."
            : "Approved. The change is processing and will update automatically when settlement finishes.");
      } else {
        await review({ token, bookingId: bookingId as any, id: selected as any, decision, note });
        setNotice(decision === "approved" && request.kind === "extension"
          ? "Approved for a live quote. The rental stays unchanged until the renter accepts and pays."
          : decision === "approved" && (request.kind === "dates" || request.kind === "cancel" || request.kind === "handover")
            ? "Approval saved. This older request needs a fresh availability and terms review before it can be applied."
            : "Decision saved and shared in this rental conversation.");
      }
      setSelected(null); setNote("");
    } catch (e: any) {
      if (decision === "approved") { setSelected(null); setNote(""); }
      setError(e.data?.message ?? e.message ?? "The decision could not be saved. Please retry.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className={styles.root} aria-label={admin ? "Review customer requests" : "Your rental requests"}>
    <header><h3>{admin ? "Customer requests" : "Your requests"}</h3><span>{visibleRequests.filter(r => r.status === "pending").length} awaiting review{status !== "Exhausted" ? " shown" : ""}</span></header>
    <div className={styles.history}>
      {visibleRequests.map(request => {
        const requestedItems = request.requestedItems;
        const requestId = request.requestId;
        return <article key={request._id} className={styles.card}>
        <div className={styles.heading}><h4>{labels[request.kind]}</h4><span className={styles.status} data-status={request.status}>{request.execution?.status === "applied" ? "Completed" : request.execution?.status === "processing" ? "Settlement processing" : request.kind === "extension" && request.status === "approved" ? "Needs live quote" : request.status === "approved" ? "Approved for arrangement" : request.status === "declined" ? "Declined" : "Awaiting team review"}</span></div>
        <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · London</time>
        <p>{request.detail}</p>
        {admin && request.kind === "dates" && request.requestedStart !== undefined && <p className={styles.explanation}>Renter’s proposal: {new Date(request.requestedStart).toISOString().slice(0, 10)} → {request.requestedEnd === undefined ? "return date unavailable" : new Date(request.requestedEnd).toISOString().slice(0, 10)} · all items move together; original duration and handover times stay the same.</p>}
        {request.kind === "items" && requestedItems && <div className={styles.explanation} data-testid={`requested-item-lines-${request._id}`}>
          <p>Selected: {request.itemChangeItems?.map((item: { qty: number; title: string }) => `${item.qty}× ${item.title}`).join(", ") ?? `${requestedItems.lineIndexes.length} booked items`}.</p>
          {admin && request.itemSelectionStale && <p className={styles.error} data-testid={`stale-item-selection-${request._id}`}>The kit changed after this request. Ask the renter to select the items again.</p>}
          {admin && request.status === "approved" && !request.execution && requestId && onPrepareItemChange && !request.itemSelectionStale && request.currentLineIndexes?.length === requestedItems.lineIndexes.length && <button type="button" data-testid={`prepare-item-quote-${request._id}`} className="mt-2 min-h-10 rounded-xl border border-[#d5a474]/30 bg-[#d5a474]/[.08] px-3 text-xs font-semibold text-[#edc89f]" onClick={() => onPrepareItemChange({ requestId, lineIndexes: request.currentLineIndexes! })}>Prepare live quote</button>}
        </div>}
        {admin && request.kind === "items" && !request.requestedItems && <p className={styles.explanation}>Older request · ask the renter to select the kit items again.</p>}
        {request.kind === "extension" && !admin && <p className={styles.explanation}>Your current return times stay in place. Send a priced extension request from the rental controls.</p>}
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
          : request.status === "approved" && <p className={styles.explanation}>{request.kind === "extension" || request.kind === "items" ? "Your rental stays unchanged until you accept the live quote and any payment or refund." : "This approved request still needs its saved availability and terms checks before the rental can change."}</p>}
        {admin && request.status === "approved" && !request.execution && (request.kind === "dates" || request.kind === "cancel" || request.kind === "handover") && <RentalRequestApply token={token} bookingId={bookingId} id={request._id} requestId={request.requestId} kind={request.kind} decisionNote={request.decisionNote} requestedStart={request.requestedStart} requestedEnd={request.requestedEnd} requestedSnapshot={request.requestedSnapshot} requestedHandover={request.requestedHandover} handoverItems={request.handoverItems} cancellationKindAtRequest={request.cancellationKindAtRequest} cancellationTermsVersion={request.cancellationTermsVersion} cancellationChoice={request.cancellationChoice} disabled={busy || request.kind === "cancel" && isNoRefundWithin48HoursCancellationVersion(request.cancellationTermsVersion) && request.cancellationKindAtRequest === "full_refund" && !request.cancellationChoice} />}
        {admin && request.status === "pending" && <div className={styles.actions}>
          {request.kind !== "extension" && <button type="button" data-testid={`approve-request-${request.kind}-${request._id}`} disabled={busy || request.approvalBlocked} onClick={() => open(request._id, "approved")}>{request.kind === "handover" ? "Review & apply time" : "Approve request"}</button>}
          <button type="button" disabled={busy} onClick={() => open(request._id, "declined")}>Decline request</button>
        </div>}
        {admin && request.status === "pending" && request.approvalBlocked && <p className={styles.explanation}>Finish the active rental operation before approving this request.</p>}
        {admin && selected === request._id && <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label>{decision === "approved" ? "Explain the agreed next step" : "Explain why this cannot be arranged"}<textarea aria-label="Reply to request" required minLength={5} maxLength={1000} disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></label>
          {decision === "approved" && <p className={styles.explanation}>{request.kind === "extension" || request.kind === "items" ? "Approval opens the live quote and payment step. No booking or price changes until the renter accepts." : "Approval rechecks availability and applies the saved change to the rental calendar."}</p>}
          <div className={styles.actions}><button data-testid={`approve-request-submit-${request.kind}`} disabled={busy}>{busy ? "Applying…" : decision === "approved" && request.kind === "dates" ? "Approve & apply dates" : decision === "approved" && request.kind === "cancel" ? "Approve & process cancellation" : decision === "approved" && request.kind === "handover" ? "Approve & apply time" : decision === "approved" && (request.kind === "extension" || request.kind === "items") ? "Approve for live quote" : decision === "approved" ? "Approve request" : "Decline request"}</button><button type="button" disabled={busy} onClick={() => { setSelected(null); setError(""); }}>Back</button></div>
        </form>}
      </article>;
      })}
    </div>
    {(status === "CanLoadMore" || status === "LoadingMore") && <div className={styles.actions}><button type="button" disabled={status === "LoadingMore" || busy} onClick={() => loadMore(30)}>{status === "LoadingMore" ? "Loading earlier requests…" : "Show earlier requests"}</button></div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </section>;
}
