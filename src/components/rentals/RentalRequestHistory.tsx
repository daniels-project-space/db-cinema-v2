"use client";
import { useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";

const labels = { dates: "Date change", items: "Kit change", extension: "Extension", cancel: "Cancellation" };

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
        <div className={styles.heading}><h4>{labels[request.kind]}</h4><span className={styles.status} data-status={request.status}>{request.status === "approved" ? "Approved for arrangement" : request.status === "declined" ? "Declined" : "Awaiting team review"}</span></div>
        <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · London</time>
        <p>{request.detail}</p>
        {request.decisionNote && <div className={styles.reply}><strong>Team reply</strong><p>{request.decisionNote}</p></div>}
        {request.status === "approved" && <p className={styles.explanation}>Your rental stays unchanged until the team confirms the update and any payment or refund separately.</p>}
        {admin && request.status === "pending" && <div className={styles.actions}>
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
