"use client";
import { useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalRequestHistory.module.css";
import { RentalKitSwap } from "@/components/admin/RentalKitSwap";
import { RentalKitRemoval } from "@/components/admin/RentalKitRemoval";
import { RentalKitProposal } from "@/components/admin/RentalKitProposal";
import { SmartImage } from "@/components/SmartImage";
import { rentalTitle } from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
import { RentalRequestApply } from "./RentalRequestApply";
import { ownerConversationUrl } from "../../../shared/ownerConversationRoute";

const dayLabel=(at:number)=>new Date(at).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});
const labels = { dates: "Date change", items: "Kit change", extension: "Extension", cancel: "Cancellation" };
const additionLabels:Record<string,string>={prepared:"Preparing proposal",awaiting_payment:"Payment required",paid:"Payment received · security pending",requires_action:"Customer bank approval required",held:"Security authorised · updating kit",failed:"Security needs review",applied:"Kit updated",applied_draft:"Kit updated · checkout verification continues",withdrawing:"Withdrawal processing",refund_pending:"Refund processing",refund_failed:"Refund needs attention",refunded:"Proposal refunded",expired:"Proposal closed",unavailable:"Proposal needs review"};
const extensionLabels: Record<string, string> = { pending: "Awaiting team approval", approved: "Preparing payment link", awaiting_payment: "Payment required", applied: "Extension confirmed", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn", refund_pending: "Refund processing", refunded: "Refunded", unavailable: "Extension needs review" };

export function RentalRequestHistory(props: { token: string; bookingId: string; admin?: boolean; consolidatedExtensions?: boolean }) {
  // Remount drafts and pending response state whenever the private rental scope changes.
  return <RequestHistory key={JSON.stringify([props.token, props.bookingId, !!props.admin])} {...props} />;
}

function RequestHistory({ token, bookingId, admin = false, consolidatedExtensions = false }: { token: string; bookingId: string; admin?: boolean; consolidatedExtensions?: boolean }) {
  const { results: requests, status, loadMore } = usePaginatedQuery(api.rentalRequests.list, { token, bookingId: bookingId as any, admin }, { initialNumItems: 30 });
  const review = useMutation(api.rentalRequests.review);
  const [kitRequest,setKitRequest]=useState<string|null>(null);
  const swapLauncher=useRef<HTMLButtonElement|null>(null);
  const [swapRequest,setSwapRequest]=useState<string|null>(null);
  const [removeRequest,setRemoveRequest]=useState<string|null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "declined">("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const visibleRequests=consolidatedExtensions?requests.filter(r=>!r.extension||!["pending","approved","awaiting_payment","refund_pending"].includes(r.extension.status)):requests;
  if (!visibleRequests.length&&status==="Exhausted") return null;
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
    <header><h3>{admin ? "Requests & changes" : "Your requests"}</h3><span>{visibleRequests.filter(r => r.status === "pending").length} awaiting review{status !== "Exhausted" ? " shown" : ""}</span></header>
    <div className={styles.history}>
      {visibleRequests.map(request => request.addition ? <details key={request._id} className={styles.extensionActivity}><summary><span>Kit-change activity</span><span>{additionLabels[request.addition.status]??"Proposal needs review"}</span></summary><p>{request.detail}</p>{request.decisionNote&&<div className={styles.reply}><strong>Team reply</strong><p>{request.decisionNote}</p></div>}{request.addition.title&&<p>{request.addition.qty}× {request.addition.title}{request.addition.amount!==null?` · ${formatGbp(request.addition.amount)} checkout`:""}</p>}<p>{["applied","applied_draft"].includes(request.addition.status)?"The agreed equipment update has been applied. Rental verification and pickup requirements still apply.":["withdrawing","refund_pending","refund_failed"].includes(request.addition.status)?"The proposal is being withdrawn. Any captured payment must be settled before further rental changes.":["refunded","expired"].includes(request.addition.status)?"This proposal is closed. It does not confirm a new kit update.":"The rental kit stays unchanged until payment and the required security checks succeed."}</p><a href={admin?ownerConversationUrl({bookingId}):`/account?rental=${encodeURIComponent(bookingId)}#chat`} onClick={event=>{const panel=document.getElementById(`kit-proposal-${request.addition?.id}`);if(panel?.dataset.bookingId===bookingId){event.preventDefault();panel.scrollIntoView({behavior:"smooth",block:"start"});panel.focus({preventScroll:true});}}}>Open kit proposal controls</a></details> : request.extension ? <details key={request._id} className={styles.extensionActivity}><summary><span>Extension activity</span><span>{extensionLabels[request.extension.status] ?? "Extension needs review"}</span></summary><p>{request.detail}</p><time>{new Date(request.createdAt).toLocaleString("en-GB", {timeZone:"Europe/London",dateStyle:"medium",timeStyle:"short"})} · London</time>{request.extension.status === "applied" && <p>Payment confirmed and rental dates updated.</p>}<a href={admin ? ownerConversationUrl({ bookingId }) : `/account?rental=${encodeURIComponent(bookingId)}#chat`} onClick={event => { const panel = document.getElementById("rental-extension-panel"); if (panel?.dataset.bookingId === bookingId) { event.preventDefault(); panel.scrollIntoView({behavior:"smooth",block:"start"}); panel.focus({preventScroll:true}); } }}>Open rental extension controls</a></details> : <article key={request._id} className={styles.card} data-completed={request.execution?.status === "applied"} data-testid="rental-change-card">
        <div className={styles.heading}><h4>{labels[request.kind]}</h4><span className={styles.status} data-status={request.status}>{request.execution?.status === "applied" ? "Completed" : request.execution?.status === "processing" ? "Settlement processing" : request.swapProposalState === "accepted" ? "Accepted · awaiting settlement" : request.swapProposalState === "declined" ? "Proposal declined" : request.swapProposalState === "withdrawn" ? "Proposal withdrawn" : request.swapProposalState === "offered" ? admin ? "Awaiting renter decision" : "Awaiting your decision" : request.status === "approved" ? "Approved for arrangement" : request.status === "declined" ? "Declined" : "Awaiting team review"}</span></div>
        <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · London</time>
        {!!request.equipment?.length && <div className={styles.equipmentHero}>
          <SmartImage src={request.equipment[0].heroImage} fallbackSources={request.equipment[0].imageSources} alt={request.equipment[0].title} className={styles.equipmentPhoto}/>
          <div className={styles.equipmentCopy}><span className={styles.eyebrow}>{request.kitSelection?.change === "remove" ? "Equipment removal" : request.kitSelection?.change === "swap" ? "Equipment swap" : request.kitSelection?.change === "add" ? "Equipment addition" : "Rental equipment"}</span><h5>{rentalTitle(request.equipment[0].title)}</h5><p>{request.equipment[0].qty}× {request.kitSelection?.change === "remove" ? request.execution?.status === "applied" ? "removed" : "to remove" : request.kitSelection ? "in this request" : "in this rental"}</p>
            {request.equipment.slice(1).map(item=><div className={styles.swapEquipment} key={item.listingId}><span aria-hidden="true">→</span><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.equipmentThumb}/><span>{item.qty}× {rentalTitle(item.title)}</span></div>)}
          </div>
        </div>}
        {request.dateSelection&&<div className={styles.dateComparison} aria-label="Requested rental period"><div><span>Original hire</span><strong>{dayLabel(Math.min(...request.dateSelection.source.map(line=>line.start)))} – {dayLabel(Math.max(...request.dateSelection.source.map(line=>line.end)))}</strong><small>Saved period at request</small></div><span aria-hidden="true">→</span><div><span>{request.execution?.status==="applied"?"Confirmed hire":"Requested hire"}</span><strong>{dayLabel(request.dateSelection.start)} – {dayLabel(request.dateSelection.end)}</strong><small>Collection {request.dateSelection.pickupTime} · Return {request.dateSelection.returnTime} · London</small></div></div>}
        {(!request.execution || request.execution.status !== "applied")&&!(["declined","withdrawn"].includes(request.swapProposalState??"")) ? <ol className={styles.progress} aria-label="Request progress">
          <li data-done="true"><span>✓</span><strong>Requested</strong></li>
          <li data-done={request.status === "approved"} data-active={request.status === "pending"}><span>{request.status === "approved" ? "✓" : "2"}</span><strong>{request.status === "declined" ? "Declined" : "Team review"}</strong></li>
          <li data-active={request.status === "approved"}><span>3</span><strong>{request.execution?.status === "processing" ? "Processing" : "Rental update"}</strong></li>
        </ol> : null}
        <p className={styles.requestLead}>{request.detail.length > 160 ? `${request.detail.slice(0, 157)}…` : request.detail}</p>
        <details className={styles.requestDetails}><summary>Request details</summary><p>{request.detail}</p></details>
        {request.decisionNote && <div className={styles.reply}><strong>Team reply</strong><p>{request.decisionNote}</p></div>}
        {request.execution?.status === "applied" ? <div className={styles.reply}><strong>Completed update</strong><p>{request.execution.detail}</p></div>
          : request.execution?.status === "processing" ? <p className={styles.explanation}>Cancellation and settlement are processing. The rental remains reserved until refunds and card authorisation releases are confirmed.</p>
          : request.status === "approved" && <p className={styles.explanation}>Your rental stays unchanged until the team confirms the update and any payment or refund separately.</p>}
        {admin && request.status === "approved" && !request.execution && (request.kind === "dates" || request.kind === "cancel") && <RentalRequestApply token={token} bookingId={bookingId} id={request._id} kind={request.kind} decisionNote={request.decisionNote} disabled={busy} />}
        {admin && request.status === "approved" && request.kind === "items" && !request.execution && <div className={styles.actions}>
          {(!request.kitSelection || request.kitSelection.change === "add") && <button type="button" disabled={busy} onClick={()=>setKitRequest(request._id)}>Create agreed kit proposal</button>}
          {(!request.kitSelection || request.kitSelection.change === "remove") && <button type="button" disabled={busy} onClick={()=>setRemoveRequest(request._id)}>Apply agreed equipment removal</button>}
          {request.kitSelection?.change === "swap" && <button type="button" disabled={busy} onClick={event=>{swapLauncher.current=event.currentTarget;setSwapRequest(request._id);}}>Review agreed swap</button>}
        </div>}
        {!admin&&request.status==="approved"&&request.kitSelection?.change==="swap"&&request.swapProposalId&&!request.execution&&<div className={styles.actions}><button type="button" onClick={event=>{swapLauncher.current=event.currentTarget;setSwapRequest(request._id);}}>Review swap proposal</button></div>}
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
    {admin&&kitRequest&&<RentalKitProposal token={token} bookingId={bookingId} changeRequestId={kitRequest} decisionNote={requests.find(r=>r._id===kitRequest)?.decisionNote} onClose={()=>setKitRequest(null)}/>}
    {swapRequest&&<RentalKitSwap token={token} bookingId={bookingId} id={swapRequest} admin={!!admin} returnFocus={swapLauncher.current} onClose={()=>setSwapRequest(null)}/>}
    {admin&&removeRequest&&<RentalKitRemoval token={token} bookingId={bookingId} id={removeRequest} onClose={()=>setRemoveRequest(null)}/>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </section>;
}
