"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { PICKUP_SLOTS } from "@/lib/site";
import { rentalTitle } from "@/lib/rentalPresentation";
import { SmartImage } from "@/components/SmartImage";
import styles from "./RentalExtensionPanel.module.css";

const DAY = 86400000;
const date = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const labels: Record<string, string> = { pending: "Awaiting approval", approved: "Preparing payment link", awaiting_payment: "Payment required", applied: "Extension confirmed", declined: "Request declined", expired: "Approval expired", withdrawn: "Approval withdrawn", refund_pending: "Refund processing", refunded: "Payment refunded" };
function ClockIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16"/></svg>; }

export function RentalExtensionPanel(props: { token: string; bookingId: string; admin?: boolean; embeddedHeader?: boolean }) {
  return <ExtensionPanel key={JSON.stringify([props.token, props.bookingId, !!props.admin])} {...props} />;
}

function ExtensionPanel({ token, bookingId, admin = false, embeddedHeader = false }: { token: string; bookingId: string; admin?: boolean; embeddedHeader?: boolean }) {
  const state = useQuery(api.rentalExtensions.state, { token, bookingId: bookingId as any, admin });
  const [open, setOpen] = useState(false), [days, setDays] = useState(1), [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0), [reviewId, setReviewId] = useState<string | null>(null), [reason, setReason] = useState("");
  const [returnTime, setReturnTime] = useState(""), [approvedTime, setApprovedTime] = useState("");
  const key = useRef<string | null>(null), inFlight = useRef(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const drawer=useRef<HTMLDialogElement>(null),detailsLauncher=useRef<HTMLButtonElement>(null),drawerTitle=useId();
  useEffect(()=>{if(!detailsOpen)return;const node=drawer.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();detailsLauncher.current?.focus();};},[detailsOpen]);
  const quote = useQuery(api.rentalExtensions.quote, open && !admin ? { token, bookingId: bookingId as any, extraDays: days, lineItemIndexes: selected.length ? selected : undefined, refreshKey } : "skip");
  const request = useMutation(api.rentalExtensions.request), decline = useMutation(api.rentalExtensions.decline);
  const approve = useAction(api.rentalExtensionPayments.approve), withdraw = useAction(api.rentalExtensionPayments.withdraw);
  useEffect(() => { if (!open) return; const timer = setInterval(() => setRefreshKey(Date.now()), 60000); return () => clearInterval(timer); }, [open]);
  useEffect(() => { setNotice(""); }, [state?.requests[0]?.status]);
  if (!state) return null;
  const current = state.requests.find(r => ["pending", "approved", "awaiting_payment", "refund_pending"].includes(r.status));
  const recent = state.requests.find(r => r.id === reviewId) ?? current ?? state.requests[0];
  const eligible = ["confirmed", "active"].includes(state.status);
  if ((!eligible && !recent) || (admin && !recent)) return null;
  const activeRequest = open ? undefined : recent;
  const proposed = open ? quote?.items ?? [] : recent?.items ?? [];
  const chosen = state.items.filter(item => open ? !selected.length || selected.includes(item.index) : !recent || proposed.some(p => p.lineIndex === item.index && p.listingId === item.listingId));
  const hero = chosen.find(item => proposed.some(p => p.lineIndex === item.index)) ?? chosen[0];
  const amount = open ? quote?.priceDelta : recent?.amount;
  const extraDays = open ? days : recent?.days;
  const paymentDone = activeRequest?.status === "applied";
  const approved = !!activeRequest?.approvedAt;
  const stopped = !!activeRequest && ["declined", "expired", "withdrawn", "refund_pending", "refunded"].includes(activeRequest.status);
  const proposedTime = open ? returnTime : reviewId && recent?.status === "pending" ? approvedTime : recent?.approvedReturnTime ?? recent?.requestedReturnTime;
  const detailed = open || !!recent;
  async function send() {
    if (inFlight.current || !quote?.available || !quote.items || quote.priceDelta === undefined || !quote.baseLines || !returnTime) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      key.current ??= crypto.randomUUID();
      await request({ token, bookingId: bookingId as any, requestKey: key.current, extraDays: days, lineItemIndexes: selected.length ? selected : undefined, expectedAmount: quote.priceDelta, expectedBase: quote.baseLines, requestedReturnTime: returnTime });
      setOpen(false); setNotice("Request sent to the team.");
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "Your extension request could not be sent."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function decide(accept: boolean) {
    if (!reviewId || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (accept) await approve({ token, requestId: reviewId as any, reason, approvedReturnTime: approvedTime });
      else await decline({ token, requestId: reviewId as any, reason });
      setReviewId(null); setReason(""); setNotice(accept ? "Payment link sent. Dates change after payment succeeds." : "Request declined. The renter has been notified.");
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "The request could not be updated."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function withdrawRequest() {
    if (!recent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await withdraw({ token, requestId: recent.id as any }); setNotice("Unpaid approval withdrawn. Original dates are unchanged."); }
    catch (e: any) { setError(e.data?.message ?? e.message ?? "The approval could not be withdrawn."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function review() { if (!recent) return; setReviewId(recent.id); setApprovedTime(recent.approvedReturnTime ?? recent.requestedReturnTime ?? ""); setReason(recent.status === "approved" ? recent.reason ?? "Recovering approved extension" : ""); setError(""); }
  const workflow=<section className={styles.workflow} aria-label="Extension progress"><h3>Extension workflow</h3><ol>
          {[{label:"Requested",done:!!activeRequest,active:!activeRequest,detail:activeRequest ? date(activeRequest.createdAt) : "Choose the extra days"},{label:"Team approval",done:approved,active:!!activeRequest&&!approved&&!stopped,detail:approved ? "Approved by the team" : stopped ? "Request closed" : "Review and approve"},{label:"Payment",done:paymentDone,active:approved&&!paymentDone&&!stopped,detail:paymentDone ? "Payment confirmed" : stopped ? "Not applied" : "Confirm extra rental days"}].map((step,i)=><li key={step.label} data-done={step.done} data-active={step.active}><span className={styles.step}>{step.done ? "✓" : i+1}</span><strong>{step.label}</strong><small>{step.detail}</small></li>)}
        </ol></section>;
  const controls=<>    {detailed && <div className={styles.workspace}>
      <div className={styles.main}>
        {hero && <div className={styles.hero}>
          <SmartImage src={hero.heroImage} fallbackSources={hero.imageSources} alt={hero.title} className={styles.heroImage} imgClassName={styles.productImage}/>
          <div className={styles.heroCopy}><span className={styles.eyebrow}>Your equipment</span><h3>{rentalTitle(hero.title)}</h3><p>{chosen.reduce((sum, item) => sum + item.qty, 0)} item{chosen.reduce((sum, item) => sum + item.qty, 0) === 1 ? "" : "s"}{extraDays ? ` · ${extraDays} extra day${extraDays === 1 ? "" : "s"}` : ""}</p><dl><div><dt>Current rental period</dt><dd>{date(hero.start)} – {date(hero.end)}</dd></div><div><dt>Return time zone</dt><dd>London</dd></div></dl></div>
        </div>}
        {chosen.length > 1 && <div className={styles.equipmentStrip}>{chosen.map(item => <div key={item.index}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><span>{item.qty}× {rentalTitle(item.title)}</span></div>)}</div>}
        <section className={styles.period}><h3>Rental period change</h3>
          {(proposed.length ? proposed : chosen.map(item => ({ lineIndex: item.index, title: item.title, end: item.end + days * DAY }))).map(item => {
            const original = open ? state.items.find(li => li.index === item.lineIndex) : recent?.originalItems.find((li: any) => li.lineIndex === item.lineIndex);
            if (!original) return null;
            return <div key={item.lineIndex} className={styles.periodItem}>
              {proposed.length > 1 && <h4>{rentalTitle(item.title)}</h4>}
              <div className={styles.dateGrid}><div className={styles.dateCard}><CalendarIcon/><div><span>{paymentDone ? "Previous return" : "Current return"}</span><strong>{date(original.end)}</strong><p>{original.returnTime ?? "Time to confirm"} · London</p><small>Original booking</small></div></div><span aria-hidden="true" className={styles.arrow}>→</span><div className={`${styles.dateCard} ${styles.newDate}`}><CalendarIcon/><div><span>{paymentDone ? "Confirmed return" : approved ? "Approved return" : "Proposed return"}</span><strong>{date(item.end)}</strong><p>{proposedTime || "Choose a time"} · London</p><small>+ {extraDays} extra day{extraDays === 1 ? "" : "s"}</small></div></div></div>
              <DateStrip original={original.end} proposed={item.end}/>
            </div>;
          })}
        </section>
        {admin&&workflow}
        {admin&&activeRequest?.reason && <section className={styles.teamReply}><h3>Team decision</h3><p>{activeRequest.reason}</p></section>}
      </div>
      <div className={styles.side}>
        <section className={styles.quote} aria-label="Extension quote" data-testid={open && quote?.available ? "extension-live-quote" : undefined}>
          <h3>Extension quote</h3>
          <dl>{proposed.map(item => "dailyRate" in item ? <div key={item.lineIndex}><dt>{rentalTitle(item.title)} · daily</dt><dd>{formatGbp(item.dailyRate)}</dd></div> : null)}<div><dt>Extra days</dt><dd>{extraDays ?? "—"}</dd></div></dl>
          <div className={styles.total}><span>{paymentDone ? "Extension paid" : "Due for extension"}</span><strong>{amount === undefined || amount === null ? "—" : formatGbp(amount)}</strong></div>
          {!admin&&workflow}
          <div className={styles.security}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><div><strong>Existing security unchanged</strong><p>Your existing deposit and authorisation remain in place.</p></div></div>
          {!admin&&activeRequest?.reason&&<details className={styles.renterNote}><summary>Team note</summary><p>{activeRequest.reason}</p></details>}
          {open && !admin && <form onSubmit={e=>{e.preventDefault();void send();}} data-testid="extension-request-form" className={styles.form}>
            <label>Extra rental days<select data-testid="extension-extra-days" value={days} disabled={busy} onChange={e=>{setDays(Number(e.target.value));key.current=null;}}>{Array.from({length:30},(_,i)=><option key={i} value={i+1}>{i+1} {i ? "days" : "day"}</option>)}</select></label>
            <label>Proposed return time · London<select required data-testid="extension-return-time" value={returnTime} disabled={busy} onChange={e=>{setReturnTime(e.target.value);key.current=null;}}><option value="">Choose time</option>{PICKUP_SLOTS.map(time=><option key={time} value={time}>{time}</option>)}</select></label>
            {state.items.length>1&&<fieldset><legend>Items to extend · none selected means all</legend>{state.items.map(item=><label className={styles.check} key={item.index}><input type="checkbox" checked={selected.includes(item.index)} disabled={busy} onChange={e=>{setSelected(s=>e.target.checked?[...s,item.index].sort((a,b)=>a-b):s.filter(i=>i!==item.index));key.current=null;}}/>{item.qty}× {rentalTitle(item.title)}</label>)}</fieldset>}
            {quote===undefined ? <p role="status">Checking dates and price…</p> : quote.available ? <p className={styles.available}>✓ Available · subject to team approval</p> : <p role="status" className={styles.warning}>{quote.reason}</p>}
            <button data-testid="extension-send-request" className={styles.primary} disabled={busy||!quote?.available||!returnTime}>{busy ? "Sending…" : "Send extension request"}</button>
          </form>}
          {admin && recent?.status==="pending" && !reviewId && <button type="button" data-testid="extension-review" className={styles.primary} disabled={busy} onClick={review}>Review extension request</button>}
          {admin && recent?.status==="approved" && !reviewId && <button type="button" className={styles.primary} disabled={busy} onClick={review}>Recover payment link</button>}
          {admin && reviewId && <form className={styles.form} data-testid="extension-owner-review" onSubmit={e=>{e.preventDefault();void decide(true);}}>
            <label>Approved return time · London<select data-testid="extension-approved-time" value={approvedTime} disabled={recent?.status!=="pending"||busy} onChange={e=>setApprovedTime(e.target.value)}><option value="">Choose time</option>{PICKUP_SLOTS.map(time=><option key={time} value={time}>{time}</option>)}</select></label>
            <label>Approval reason · required<input required minLength={5} maxLength={500} data-testid="extension-decision-reason" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Explain the agreed change"/></label>
            <button data-testid="extension-approve" className={styles.primary} disabled={busy||reason.trim().length<5||!approvedTime||!state.paymentsEnabled}>{busy ? "Processing…" : "Approve & send payment link"}</button>
            {recent?.status==="pending"&&<button type="button" data-testid="extension-decline" className={styles.secondary} disabled={busy||reason.trim().length<5} onClick={()=>void decide(false)}>Decline request</button>}
            <button type="button" className={styles.quiet} disabled={busy} onClick={()=>setReviewId(null)}>Back</button>
            {!state.paymentsEnabled&&<p role="status" className={styles.warning}>Rental payments are temporarily paused. The request can remain pending.</p>}
          </form>}
          {!admin && activeRequest?.status==="awaiting_payment" && activeRequest.url && <a data-testid="extension-pay-link" className={styles.primary} href={activeRequest.url}>Pay {formatGbp(activeRequest.amount!)} & confirm</a>}
          {admin && activeRequest && ["approved","awaiting_payment"].includes(activeRequest.status) && !reviewId && <button type="button" data-testid="extension-withdraw" className={styles.secondary} disabled={busy} onClick={()=>void withdrawRequest()}>Withdraw unpaid approval</button>}
          {activeRequest?.status==="awaiting_payment"&&activeRequest.expiresAt&&<p className={styles.deadline}><ClockIcon/>Payment deadline: {new Date(activeRequest.expiresAt).toLocaleString("en-GB",{timeZone:"Europe/London",dateStyle:"medium",timeStyle:"short"})} London time.</p>}
          {!paymentDone&&!stopped&&<p className={styles.note}>Your original return time applies until approval and payment succeed.</p>}
          {stopped&&<p role="status" className={styles.note}>{activeRequest.status==="refund_pending" ? "The rental remains locked while the payment refund is confirmed." : "This request has not changed the rental dates."}</p>}
        </section>
      </div>
    </div>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}
</>;
  return <aside id="rental-extension-panel" tabIndex={-1} data-booking-id={bookingId} data-testid="rental-extension-panel" className={`${styles.panel} ${admin?styles.adminOverview:""}`}>
    <header className={styles.header}>
      {!embeddedHeader && <div><span className={styles.eyebrow}>{admin ? "Requests & changes" : "Your rental"}</span><h2>{admin ? "Rental extension" : "Keep the shoot going"}</h2></div>}
      {activeRequest && <span data-testid="extension-request-status" className={styles.badge} data-status={activeRequest.status}><ClockIcon/>{labels[activeRequest.status] ?? "Team review required"}</span>}
      {!admin && eligible && !current && <button type="button" data-testid="request-extension-open" className={styles.secondary} disabled={state.locked || busy} onClick={() => { setOpen(!open); setError(""); setNotice(""); key.current = null; }}>{open ? "Close" : "Request extension"}</button>}
    </header>
    {admin&&recent?<>
      <div className={styles.requestHero}>
        <div className={styles.requestHeading}><span className={styles.eyebrow}>Extension request</span><h3>{extraDays} extra shoot day{extraDays===1?"":"s"}</h3>{hero&&<p>{hero.qty}× {rentalTitle(hero.title)}{chosen.length>1?` · ${chosen.length} equipment lines`:""}</p>}</div>
        {hero&&<SmartImage src={hero.heroImage} fallbackSources={hero.imageSources} alt={hero.title} className={styles.requestImage}/>}
      </div>
      <div className={styles.requestSummary}>
        <div className={styles.comparison}>{proposed.map(item=>{const original=recent.originalItems.find((line:{lineIndex:number;end:number;returnTime?:string|null})=>line.lineIndex===item.lineIndex);return original?<div key={item.lineIndex}>{proposed.length>1&&<p>{rentalTitle(item.title)}</p>}<div className={styles.dateGrid}><div className={styles.dateCard}><CalendarIcon/><div><span>{paymentDone?"Previous return":"Current return"}</span><strong>{date(original.end)}</strong><p>{original.returnTime??"Time to confirm"} · London</p></div></div><span className={styles.arrow} aria-hidden="true">→</span><div className={`${styles.dateCard} ${styles.newDate}`}><CalendarIcon/><div><span>{paymentDone?"Confirmed return":approved?"Approved return":"Requested return"}</span><strong>{date(item.end)}</strong><p>{proposedTime??"Time to confirm"} · London</p></div></div></div></div>:null;})}</div>
        <div className={styles.cardQuote}><span>{paymentDone?"Extension paid":"Total due"}</span><strong>{amount==null?"—":formatGbp(amount)}</strong><small>{extraDays} extra day{extraDays===1?"":"s"}</small></div>
      </div>
      <ol className={styles.cardProgress} aria-label="Extension request progress"><li data-done="true"><span>✓</span><strong>Requested</strong><small>{date(recent.createdAt)}</small></li><li data-done={approved} data-active={!approved&&!stopped}><span>{approved?"✓":"2"}</span><strong>{stopped&&!approved?"Request closed":"Team approval"}</strong><small>{recent.approvedAt?date(recent.approvedAt):stopped?labels[recent.status]:"Awaiting review"}</small></li><li data-done={paymentDone} data-active={approved&&!paymentDone&&!stopped}><span>{paymentDone?"✓":"3"}</span><strong>{paymentDone?"Confirmed":stopped?labels[recent.status]:"Awaiting payment"}</strong><small>{paymentDone?"Rental dates updated":stopped?"Update not applied":"Original dates retained"}</small></li></ol>
      {recent.reason&&<div className={styles.cardNote}><span aria-hidden="true">▤</span><div><strong>Team note</strong><p>{recent.reason}</p></div></div>}
      <div className={styles.cardActions}><button ref={detailsLauncher} type="button" className={styles.primary} data-testid="extension-view-details" onClick={()=>setDetailsOpen(true)}>View extension <span aria-hidden="true">↗</span></button>{["approved","awaiting_payment"].includes(recent.status)&&<button type="button" className={styles.secondary} data-testid="extension-card-withdraw" disabled={busy} onClick={()=>void withdrawRequest()}>Withdraw unpaid approval</button>}</div>
      {!paymentDone&&!stopped&&<p className={styles.note}>Original return applies until approval and payment succeed.</p>}
      {!detailsOpen&&error&&<p role="alert" className={styles.error}>{error}</p>}{!detailsOpen&&notice&&<p role="status" className={styles.notice}>{notice}</p>}
      {detailsOpen&&createPortal(<dialog ref={drawer} className={`${styles.panel} ${styles.dialog}`} aria-labelledby={drawerTitle} onCancel={event=>{event.preventDefault();if(!busy)setDetailsOpen(false);}}><header className={styles.drawerHeader}><div><span className={styles.brand}>DB <span>CINEMA</span><small>RENTALS</small></span><h2 id={drawerTitle}>Extension approval</h2><p>{hero?rentalTitle(hero.title):"Rental extension"}</p></div><button type="button" aria-label="Close extension details" className={styles.close} disabled={busy} onClick={()=>setDetailsOpen(false)}>×</button></header>{controls}<button type="button" className={styles.drawerBack} disabled={busy} onClick={()=>setDetailsOpen(false)}>← Back to requests</button></dialog>,document.body)}
    </>:controls}
  </aside>;
}
function DateStrip({ original, proposed }: { original: number; proposed: number }) {
  if (!Number.isFinite(original) || !Number.isFinite(proposed) || proposed <= original) return null;
  const length = Math.round((proposed-original)/DAY);
  const days = length <= 5 ? Array.from({length:length+3},(_,i)=>original+(i-1)*DAY) : [original-DAY,original,original+DAY,proposed-DAY,proposed,proposed+DAY];
  return <div className={styles.calendar} aria-label={`Return moves from ${date(original)} to ${date(proposed)}`}><div className={styles.calendarLabel}>{new Date(proposed).toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"})}</div><div className={styles.calendarDays}>{days.map((at,i)=><div key={at} className={styles.calendarDay} data-original={at===original} data-extension={at>original&&at<=proposed} data-gap={i>0&&at-days[i-1]>DAY}><span>{new Date(at).toLocaleDateString("en-GB",{weekday:"short",timeZone:"UTC"})}</span><strong>{new Date(at).getUTCDate()}</strong></div>)}</div><div className={styles.legend}><span>○ Original return</span><span>● Extension period</span></div></div>;
}
