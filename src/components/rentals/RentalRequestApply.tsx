"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import { rentalTitle } from "@/lib/rentalPresentation";
import { RentalRequestCalendar } from "./RentalRequestCalendar";
import styles from "./RentalRequestApply.module.css";

const DAY=86400000;
const date=(at:number)=>new Date(at).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});
type Props={token:string;bookingId:string;id:string;kind:"dates"|"cancel";decisionNote?:string;disabled?:boolean};
type Preview={kind:"full_refund"|"store_credit";refundAmount:number;creditAmount:number;holdReleaseAmount:number;checkedAt:number};
export function RentalRequestApply(props:Props){return <RequestApply key={JSON.stringify([props.token,props.bookingId,props.id,props.kind])} {...props}/>;}
function RequestApply({token,bookingId,id,kind,decisionNote,disabled=false}:Props){
  const [open,setOpen]=useState(false),[start,setStart]=useState(""),[end,setEnd]=useState(""),[keepPrice,setKeepPrice]=useState(false),[consent,setConsent]=useState(false);
  const [reason,setReason]=useState((decisionNote??"Apply the agreed customer request.").slice(0,400)),[busy,setBusy]=useState(false),[error,setError]=useState(""),[refreshKey,setRefreshKey]=useState(0);
  const [preview,setPreview]=useState<Preview|null>(null),[previewError,setPreviewError]=useState("");
  const inFlight=useRef(false),dialog=useRef<HTMLDialogElement>(null),launcher=useRef<HTMLButtonElement>(null),titleId=useId();
  const details=useQuery(api.rentalOperations.details,open?{token,bookingId:bookingId as any,refreshKey}:"skip");
  const stock=useQuery(api.rentalOperations.reschedulePreview,open&&kind==="dates"&&start?{token,bookingId:bookingId as any,start:Date.parse(start+"T00:00:00Z"),end:end?Date.parse(end+"T00:00:00Z"):undefined,refreshKey}:"skip");
  const reschedule=useMutation(api.rentalOperations.reschedule),cancel=useAction(api.checkout.cancelByAdmin),getPreview=useAction(api.checkout.cancellationPreview);
  useEffect(()=>{if(!open)return;const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();launcher.current?.focus();};},[open]);
  useEffect(()=>{if(!open||kind!=="cancel")return;const timer=setInterval(()=>setRefreshKey(k=>k+1),60000);return()=>clearInterval(timer);},[open,kind]);
  useEffect(()=>{if(!open||kind!=="cancel")return;let active=true;setPreview(null);setPreviewError("");setConsent(false);getPreview({token,bookingId:bookingId as any}).then(value=>{if(active)setPreview(value);}).catch(e=>{if(active)setPreviewError(e.data?.message??e.message??"Unable to verify the current settlement.");});return()=>{active=false;};},[open,kind,token,bookingId,refreshKey,getPreview]);
  useEffect(()=>{setConsent(false);},[details?.cancellationKind]);
  async function submit(){
    if(inFlight.current||!details)return;inFlight.current=true;setBusy(true);setError("");
    try{
      if(kind==="dates"){
        if(!start)throw Error("Choose the agreed collection date.");
        await reschedule({token,bookingId:bookingId as any,changeRequestId:id as any,start:Date.parse(start+"T00:00:00Z"),end:end?Date.parse(end+"T00:00:00Z"):undefined,keepAgreedPrice:keepPrice,reason});
      }else{
        if(!consent||!preview||preview.kind!==details.cancellationKind)throw Error("Review and confirm the current cancellation settlement.");
        await cancel({token,bookingId:bookingId as any,changeRequestId:id as any,reason,expectedCancellationKind:preview.kind});
      }
      setOpen(false);
    }catch(e:any){setError(e.data?.message??e.message??"The update could not be completed. Check its status and retry.");setRefreshKey(k=>k+1);if(kind==="cancel")setConsent(false);}
    finally{inFlight.current=false;setBusy(false);}
  }
  const currentStart=details?.lineItems.length?Math.min(...details.lineItems.map(li=>li.start)):undefined;
  const currentEnd=details?.lineItems.length?Math.max(...details.lineItems.map(li=>li.end)):undefined;
  const chosenStart=start?Date.parse(start+"T00:00:00Z"):undefined;
  const chosenEnd=end?Date.parse(end+"T00:00:00Z"):chosenStart!==undefined&&currentStart!==undefined&&currentEnd!==undefined?currentEnd+chosenStart-currentStart:undefined;
  const hero=details?.lineItems[0],itemQuantity=details?.lineItems.reduce((n,li)=>n+li.qty,0)??0;
  return <><button ref={launcher} type="button" className={styles.launch} disabled={disabled||busy} onClick={()=>{setOpen(true);setError("");}}>{kind==="dates"?"Apply agreed dates":"Process agreed cancellation"}</button>{open&&createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)setOpen(false);}}>
    <form className={styles.panel} data-testid="rental-request-drawer" onSubmit={e=>{e.preventDefault();void submit();}}>
      <header className={styles.header}><div><span className={styles.brand}>DB <span>CINEMA</span><small>RENTALS</small></span><h2 id={titleId}>{kind==="dates"?"Change rental dates":"Cancel & settle rental"}</h2></div><button type="button" className={styles.close} aria-label="Close request panel" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
      {!details?<p role="status">Loading rental details…</p>:<>
        {details.customer&&<div className={styles.customer}><span>{(details.customer.name??details.customer.email).slice(0,2).toUpperCase()}</span><div><strong>{details.customer.name??"Rental customer"}</strong><a href={`mailto:${details.customer.email}`}>{details.customer.email}</a>{details.customer.phone&&<small>{details.customer.phone}</small>}</div></div>}
        {hero&&<section className={styles.hero}><SmartImage src={hero.heroImage} fallbackSources={hero.imageSources} alt={hero.title} className={styles.photo}/><div><span className={styles.eyebrow}>Rental equipment</span><h3>{rentalTitle(hero.title)}</h3><p>{itemQuantity} item{itemQuantity===1?"":"s"} · {details.status.replaceAll("_"," ")}</p></div></section>}
        {kind==="dates"?<>
          <section className={styles.periods}><div><span>Current hire</span><strong>{currentStart===undefined?"—":date(currentStart)} – {currentEnd===undefined?"—":date(currentEnd)}</strong><small>Original agreed dates</small></div><span className={styles.arrow}>→</span><div className={styles.agreed}><span>Agreed hire</span><strong>{chosenStart===undefined?"Choose dates":date(chosenStart)}{chosenEnd===undefined?"":` – ${date(chosenEnd)}`}</strong><small>{chosenStart!==undefined&&chosenEnd!==undefined?`${Math.round((chosenEnd-chosenStart)/DAY)+1} rental days`:"Select the new collection date"}</small></div></section>
          <section className={styles.section}><h3>Select new rental dates</h3><div className={styles.calendarLayout}>{currentStart!==undefined&&<RentalRequestCalendar initial={currentStart} start={start} end={end} onStart={setStart} onEnd={setEnd} disabled={busy}/>}<div className={styles.inputs}><label>Agreed collection date<input required type="date" value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/></label><label>Agreed return date · optional<input type="date" min={start||undefined} value={end} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label></div></div><p className={styles.note}>Leave return blank to keep the duration.</p></section>
          <section className={styles.section}><h3>Equipment & agreed times</h3>{details.lineItems.map((li,i)=><div className={styles.item} key={i}><span>{li.qty}× {rentalTitle(li.title)}</span><small>Pickup {li.pickupTime??details.pickupTime??"to confirm"} · Return {li.returnTime??details.returnTime??"to confirm"} · London</small></div>)}</section>
          <div className={styles.info} data-available={stock?.available}><span>{stock?.available?"✓":"◷"}</span><div><strong>{!start?"Choose dates to check availability":!stock?"Checking stock…":stock.available?"Stock available for the selected period":"Selected dates unavailable"}</strong><p>{stock?.reason??"Existing collection and return times are retained. Stock is checked again when confirmed."}</p></div></div><div className={styles.info}><span>£</span><div><strong>Agreed rental charge unchanged</strong><p>Any eligible refund is handled separately.</p></div></div>
          {end&&<label className={styles.check}><input required type="checkbox" disabled={busy} checked={keepPrice} onChange={e=>setKeepPrice(e.target.checked)}/>Keep the agreed charge. Additional days are complimentary; any refund is handled separately.</label>}
        </>:<>
          <ol className={styles.steps}><li data-active="true"><span>1</span><strong>Confirm cancellation</strong><small>Review settlement</small></li><li><span>2</span><strong>Refund & release</strong><small>Payment provider</small></li><li><span>3</span><strong>Completed</strong><small>Receipt and confirmation</small></li></ol>
          <section className={styles.section}><h3>Settlement preview</h3>{preview?<div className={styles.settlement} data-testid="cancellation-preview"><div><span>Original-payment refund</span><strong>{formatGbp(preview.refundAmount)}</strong><p>Refunded to the original payment method.</p></div><div><span>Account credit</span><strong>{formatGbp(preview.creditAmount)}</strong><p>{preview.creditAmount>0?"Credited to the renter’s account.":"No account credit will be issued."}</p></div><div><span>Card authorisation release</span><strong>{formatGbp(preview.holdReleaseAmount)}</strong><p>Uncaptured · released, not refunded.</p></div></div>:<p role="status">{previewError||"Verifying payment and hold balances with Stripe…"}</p>}<p className={styles.note}>Balances are checked again when settlement begins.</p>{previewError&&<button type="button" className={styles.launch} onClick={()=>setRefreshKey(k=>k+1)}>Retry settlement preview</button>}</section>
          <div className={styles.info}><span>✓</span><div><strong>{details.cancellationKind==="full_refund"?"Original-payment refund under agreed terms":"Account credit under agreed terms"}</strong><p>{details.cancellationKind==="full_refund"?"Remaining refundable payments return to their original method; used account credit is restored.":"Remaining rental value becomes account credit. Refundable security returns separately."}</p></div></div>
          <label className={styles.check}><input required type="checkbox" disabled={busy||!preview||preview.kind!==details.cancellationKind} checked={consent} onChange={e=>setConsent(e.target.checked)}/>I confirm this cancellation under the agreed rental terms, including the refund, credit and authorisation release shown above.</label>
        </>}
        <label className={styles.reason}>Reason for the update · required<textarea required minLength={5} maxLength={400} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/><small>{reason.length}/400</small></label>
      </>}
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      <footer className={styles.actions}><button className={styles.primary} disabled={busy||!details||disabled||(kind==="dates"&&!stock?.available)||(kind==="cancel"&&(!preview||!consent))}>{busy?"Processing…":kind==="dates"?"Confirm date update":"Confirm cancellation & settle"}</button><button type="button" className={styles.launch} disabled={busy} onClick={()=>setOpen(false)}>Back</button></footer>
      {kind==="cancel"&&<p className={styles.note}>Completion is confirmed after provider refunds and authorisation releases settle.</p>}
    </form>
  </dialog>,document.body)}</>;
}
