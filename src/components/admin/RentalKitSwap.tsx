"use client";
import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {SmartImage} from "@/components/SmartImage";
import {formatGbp} from "@/lib/pricing";
import {rentalTitle} from "@/lib/rentalPresentation";
import drawer from "@/components/rentals/RentalRequestApply.module.css";
import swapStyles from "./RentalKitSwap.module.css";
import styles from "@/components/rentals/RentalAdditionApproval.module.css";
const date=(at:number)=>new Date(at).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});
export function RentalKitSwap({token,bookingId,id,onClose,returnFocus}:{token:string;bookingId:string;id:string;onClose:()=>void;returnFocus?:HTMLElement|null}){return <Swap key={JSON.stringify([token,bookingId,id])} token={token} bookingId={bookingId} id={id} onClose={onClose} returnFocus={returnFocus}/>;}
function Swap({token,bookingId,id,onClose,returnFocus}:{token:string;bookingId:string;id:string;onClose:()=>void;returnFocus?:HTMLElement|null}){
 const dialog=useRef<HTMLDialogElement>(null),title=useId(),[refreshKey,setRefreshKey]=useState(0);
 const q=useQuery(api.rentalSwaps.preview,{token,bookingId:bookingId as any,id:id as any,refreshKey});
 useEffect(()=>{const node=dialog.current,previous=returnFocus??document.activeElement as HTMLElement|null;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>{const timer=setInterval(()=>setRefreshKey(n=>n+1),60000);return()=>clearInterval(timer);},[]);
 return createPortal(<dialog ref={dialog} className={drawer.dialog} aria-labelledby={title} onCancel={event=>{event.preventDefault();onClose();}}><div className={`${drawer.panel} ${swapStyles.panel}`} data-testid="admin-kit-swap"><header className={drawer.header}><div><span className={drawer.brand}>DB <span>CINEMA</span><small>RENTALS</small></span><h2 id={title}>Review agreed swap</h2></div><button type="button" className={drawer.close} aria-label="Close swap review" onClick={onClose}>×</button></header>
 {q===undefined?<p role="status">Checking the agreed kit and price difference…</p>:!q?.available?<p role="alert" className={drawer.error}>{q?.reason??"This swap is unavailable."}</p>:<>
 <section className={`${styles.comparison} ${swapStyles.comparison}`} aria-label="Agreed equipment swap"><div className={styles.kit}><h3>Original equipment</h3><SmartImage src={q.source.heroImage} fallbackSources={q.source.imageSources} alt={q.source.title} className={styles.photo}/><strong>{q.source.qty}× {rentalTitle(q.source.title)}</strong></div><span className={styles.arrow} aria-hidden="true">→</span><div className={`${styles.kit} ${styles.proposed}`}><h3>Replacement</h3><SmartImage src={q.replacement.heroImage} fallbackSources={q.replacement.imageSources} alt={q.replacement.title} className={styles.photo}/><strong>{q.replacement.qty}× {rentalTitle(q.replacement.title)}</strong></div></section>
 <section className={drawer.section}><h3>Agreed rental period</h3><p>{date(q.start)} – {date(q.end)}</p><p className={drawer.note}>Collection {q.pickupTime??"to confirm"} · Return {q.returnTime??"to confirm"} · London</p></section>
 <section className={styles.quote} data-testid="swap-price-difference"><h3>Price difference</h3><dl><div><dt>Original equipment rental</dt><dd>{formatGbp(q.originalAmount)}</dd></div><div><dt>Replacement equipment rental</dt><dd>{formatGbp(q.replacementAmount)}</dd></div><div><dt>Rental difference</dt><dd>{q.difference<0?"−":"+"}{formatGbp(Math.abs(q.difference))}</dd></div>{q.securityCharge>0&&<div><dt>Additional refundable security</dt><dd>{formatGbp(q.securityCharge)}</dd></div>}</dl>{q.charge>0&&<div className={styles.total} data-testid="swap-additional-payment"><span>Additional payment</span><strong>{formatGbp(q.charge)}</strong></div>}{q.refund>0&&<div className={styles.total} data-testid="swap-original-method-refund"><span>Proposed refund to original payment method</span><strong>{formatGbp(q.refund)}</strong></div>}{q.charge===0&&q.refund===0&&<div className={styles.total}><span>No additional cash payment</span><strong>{formatGbp(0)}</strong></div>}{q.nonCashDifference>0&&<p className={drawer.note}>{formatGbp(q.nonCashDifference)} exceeds the remaining refundable rental payment. Redeemed credits and amounts already refunded are separate from a new cash refund.</p>}<div className={styles.security}><span aria-hidden="true">◇</span><div><strong>Replacement card authorisation · {formatGbp(q.holdTotal)}</strong><p>A card authorisation is separate from a payment or cash refund.</p></div></div></section>
 <p className={drawer.note}>This is a live calculation. The original kit, payment and authorisation remain unchanged.{q.activeRental?" The collected equipment also needs its return and handover recorded before stock can be released.":""}</p>
 </>}<footer className={drawer.actions}><button type="button" className={drawer.primary} onClick={onClose}>Back to rental requests</button></footer></div></dialog>,document.body);
}
