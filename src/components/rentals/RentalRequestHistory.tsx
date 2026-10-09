"use client";
import { useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";
import { RentalRequestApply } from "./RentalRequestApply";
import { ownerConversationUrl } from "../../../shared/ownerConversationRoute";

const labels = { dates: "Date change", items: "Kit change", extension: "Extension", cancel: "Cancellation" };
const extensionLabels: Record<string, string> = { pending: "Awaiting team approval", approved: "Preparing payment link", awaiting_payment: "Payment required", applied: "Extension confirmed", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn", refund_pending: "Refund processing", refunded: "Refunded", unavailable: "Extension needs review" };

export function RentalRequestHistory(props: { token: string; bookingId: string; admin?: boolean }) {
  // Remount drafts and pending response state whenever the private rental scope changes.
  return <RequestHistory key={JSON.stringify([props.token, props.bookingId, !!props.admin])} {...props} />;
}

function RequestHistory({ token, bookingId, admin = false }: { token: string; bookingId: string; admin?: boolean }) {
  const { results: requests, status, loadMore } = usePaginatedQuery(api.rentalRequests.list, { token, bookingId: bookingId as any, admin }, { initialNumItems: 30 });
  const review = useMutation(api.rentalRequests.review);
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "declined">("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  if (!requests.length) return null;
  function open(id: string, next: typeof decision) {
    setSelected(id); setDecision(next); setNote(""); setError(""); setNotice("");
  }
  async function submit() {
    if (!selected || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await review({ token, bookingId: bookingId as any, id: selected as any, decision, note });
      setNotice("Decision saved and shared in this rental conversation."); setSelected(null); setNote("");
    } catch (e: any) {
      setError(e.data?.message ?? e.message ?? "The decision could not be saved. Please retry.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className={styles.root} aria-label={admin ? "Review customer requests" : "Your rental requests"}>
    <header><h3>{admin ? "Customer requests" : "Your requests"}</h3><span>{requests.filter(r => r.status === "pending").length} awaiting review{status !== "Exhausted" ? " shown" : ""}</span></header>
    <div className={styles.history}>
      {requests.map(request => <article key={request._id} className={styles.card}>
        <div className={styles.heading}><h4>{labels[request.kind]}</h4><span className={styles.status} data-status={request.status}>{request.extension ? extensionLabels[request.extension.status] ?? "Extension needs review" : request.execution?.status === "applied" ? "Completed" : request.execution?.status === "processing" ? "Settlement processing" : request.status === "approved" ? "Approved for arrangement" : request.status === "declined" ? "Declined" : "Awaiting team review"}</span></div>
        <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · London</time>
        <p>{request.detail}</p>
        {request.decisionNote && <div className={styles.reply}><strong>Team reply</strong><p>{request.decisionNote}</p></div>}
        {request.extension ? <div className={styles.reply}>
          {request.extension.reason && <p>{request.extension.reason}</p>}
          {request.extension.returnTime && <p>{request.extension.returnTimeApproved ? "Agreed" : "Proposed"} return time: {request.extension.returnTime} London time.</p>}
          <p>{request.extension.status === "applied" ? "Payment confirmed and rental dates updated." : request.extension.status === "refund_pending" ? "The payment refund is processing. Original rental dates remain in place." : request.extension.status === "refunded" ? "The extension payment was refunded. Original rental dates remain in place." : ["pending", "approved", "awaiting_payment"].includes(request.extension.status) ? "Original return dates apply until approval and payment succeed." : "This extension has not changed the rental dates."}</p>
          {request.extension.status !== "unavailable" && <a href={admin ? ownerConversationUrl({ bookingId }) : `/account?rental=${encodeURIComponent(bookingId)}#chat`} onClick={event => {
            const panel = document.getElementById("rental-extension-panel");
            if (panel?.dataset.bookingId === bookingId) { event.preventDefault(); panel.scrollIntoView({ behavior: "smooth", block: "start" }); panel.focus({ preventScroll: true }); }
          }}>Open rental extension controls</a>}
        </div> : request.execution?.status === "applied" ? <div className={styles.reply}><strong>Completed update</strong><p>{request.execution.detail}</p></div>
          : request.execution?.status === "processing" ? <p className={styles.explanation}>Cancellation and settlement are processing. The rental remains reserved until refunds and card authorisation releases are confirmed.</p>
          : request.status === "approved" && <p className={styles.explanation}>Your rental stays unchanged until the team confirms the update and any payment or refund separately.</p>}
        {admin && request.status === "approved" && !request.execution && (request.kind === "dates" || request.kind === "cancel") && <RentalRequestApply token={token} bookingId={bookingId} id={request._id} kind={request.kind} decisionNote={request.decisionNote} disabled={busy} />}
        {admin && request.status === "pending" && !request.extension && <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => open(request._id, "approved")}>Approve for arrangement</button>
          <button type="button" disabled={busy} onClick={() => open(request._id, "declined")}>Decline request</button>
        </div>}
        {admin && selected === request._id && <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label>{decision === "approved" ? "Explain the agreed next step" : "Explain why this cannot be arranged"}<textarea aria-label="Reply to request" required minLength={5} maxLength={1000} disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></label>
          {decision === "approved" && <p className={styles.explanation}>This records your decision. Use the rental controls to apply the agreed change; availability, payment and refund checks still apply.</p>}
          <div className={styles.actions}><button disabled={busy}>{busy ? "Saving…" : decision === "approved" ? "Save approval and reply" : "Save decline and reply"}</button><button type="button" disabled={busy} onClick={() => { setSelected(null); setError(""); }}>Back</button></div>
        </form>}
      </article>)}
    </div>
    {(status === "CanLoadMore" || status === "LoadingMore") && <div className={styles.actions}><button type="button" disabled={status === "LoadingMore" || busy} onClick={() => loadMore(30)}>{status === "LoadingMore" ? "Loading earlier requests…" : "Show earlier requests"}</button></div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </section>;
}
