"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery, useConvex } from "convex/react";
import { loadStripe } from "@stripe/stripe-js";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import styles from "./SavedCardCharges.module.css";
import {isSavedCardRental} from '../../../shared/savedCardSecurity';
import {isImmediateClaimSecurityPolicy,isSetupIntentSecurityPolicy} from '../../../shared/rentalSecurity';
const when=(at:number)=>new Date(at).toLocaleString("en-GB",{timeZone:"Europe/London",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
export function SavedCardCharges({token,bookingId,admin=false}:{token:string;bookingId:string;admin?:boolean}) {
 return <ScopedCharges key={JSON.stringify([token,bookingId,admin])} token={token} bookingId={bookingId} admin={admin}/>;
}
function ScopedCharges({token,bookingId,admin}:{token:string;bookingId:string;admin:boolean}) {
 // This existing authenticated endpoint also lets older deployments render
 // historic rentals without calling a new saved-card-only API.
 const renterBooking=useQuery(api.bookings.verificationProgress,!admin?{token,bookingId:bookingId as any}:'skip');
 const ownerBooking=useQuery(api.rentalOperations.details,admin?{token,bookingId:bookingId as any}:'skip');
 const booking=admin?ownerBooking:renterBooking;
 const data=useQuery(api.securityChargeState.list,isSavedCardRental(booking)?{token,bookingId:bookingId as any,admin}:'skip');
 const prepareClaim=useAction(api.securityCharges.prepareClaim),submitClaim=useAction(api.securityCharges.submitClaim),retryCard=useAction(api.checkout.retrySavedCard);
 const request=useRef<string|null>(null);
 const [kind,setKind]=useState<"damage"|"late">("damage"),[claimBasis,setClaimBasis]=useState<"loss"|"severe_cosmetic_damage">("severe_cosmetic_damage"),[amount,setAmount]=useState(""),[reason,setReason]=useState(""),[ownerClaimToken,setOwnerClaimToken]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 if(!data)return null;
 const setupIntentPolicy=isSetupIntentSecurityPolicy(data.securityPolicyVersion);
 const immediateClaim=isImmediateClaimSecurityPolicy(data.securityPolicyVersion);
 const assessmentOnly=data.limit===null;
 const remaining=assessmentOnly?undefined:Math.max(0,data.cardStatus==="closed"?0:(data.remaining??(data.limit??0)-data.used-data.reserved-(data.depositRetained??0)));
 async function submit(e:React.FormEvent){e.preventDefault();if(busy||!confirmed||!ownerClaimToken.trim())return;setBusy(true);setError("");request.current??=crypto.randomUUID();try{
  const claim={token,ownerClaimToken:ownerClaimToken.trim(),confirmed:true,bookingId:bookingId as any,requestId:request.current,kind,...(setupIntentPolicy&&kind==="damage"?{claimBasis}:{}),amount:Number(amount),reason};
  if(immediateClaim){const result=await submitClaim(claim);if(result.status==="notice_failed"){setError("The notice could not be sent, so no card attempt was made. Retry this same request after checking the renter email.");return;}setError(result.status==="paid"?"Payment confirmed by Stripe.":result.status==="requires_action"?"The bank needs the renter to approve this payment. No payment is confirmed yet; the renter has been notified.":result.status==="failed"?"The bank did not complete the payment. No automatic retry was made.":result.status==="processing"||result.status==="uncertain"||result.status==="collecting"?"Stripe is still confirming the outcome. Reconcile this same attempt; do not create a replacement.":`Claim status: ${result.status.replaceAll("_"," ")}.`);
  }else{await prepareClaim(claim);setError("Itemised notice queued. No payment has been attempted; the accepted seven-day notice period remains in force.");}
  request.current=null;setAmount("");setReason("");setOwnerClaimToken("");setConfirmed(false);
 }catch(e:any){setError(e?.data?.message??e?.message??"The assessment could not be submitted. Check its history before retrying.");}finally{setBusy(false);}}
 return <section className={styles.panel} aria-label={admin?"Saved-card damage and late-fee controls":"Your damage and late-fee assessments"}>
  <header><div><p className={styles.eyebrow}>Saved-card security</p><h3>{admin?"Damage & late-fee collections":"Your card-payment permission"}</h3></div><span>{data.cardStatus==="saved"?"Card saved":data.cardStatus==="closed"?"Permission closed · no amount due":data.cardStatus==="awaiting_payment"?"Awaiting checkout payment":"Card setup needs attention"}</span></header>
  <div className={styles.metrics}>{!assessmentOnly&&<div><small>Agreed combined limit</small><strong>{formatGbp(data.limit??0)}</strong></div>}<div><small>Net collected</small><strong>{formatGbp(data.paid)}</strong></div>{!assessmentOnly&&<div><small>Available permission</small><strong>{formatGbp(remaining!)}</strong></div>}</div>
  <p>{data.depositPaid>0?<>Deposit paid {formatGbp(data.depositPaid)} · retained {formatGbp(data.depositRetained)} · refunded {formatGbp(data.depositRefunded)}. Retained deposit is deducted from the same assessment. </>:<>No security money was charged or blocked upfront. </>}{formatGbp(data.reserved)} is allocated to pending assessments in this rental record; it is not a bank hold.</p>
  {data.cardStatus==="needs_setup"&&<button disabled={busy} type="button" onClick={async()=>{setBusy(true);setError("");try{await retryCard({token,bookingId:bookingId as any,admin});}catch(e:any){setError(e?.message??"Card confirmation needs team support.");}finally{setBusy(false);}}}>Retry confirming the checkout card</button>}
  {admin&&data.returnedAt&&data.cardStatus==="saved"&&<details><summary>Prepare an itemised assessment</summary><form onSubmit={submit}>
   <p>Recorded damage/loss: {formatGbp(data.damageAssessed)} · assessed late time: {formatGbp(data.lateAssessed)}. Only the remaining evidenced assessment can be collected; retained deposit reduces the same loss.</p>
   {data.damageAssessed===0&&<p>For an inspected issue with a repair quote pending, enter the evidenced amount. The amount must fit the accepted limit and recorded inspection.</p>}
   <label>Assessment type<select disabled={busy} value={kind} onChange={e=>{setKind(e.target.value as "damage"|"late");request.current=null;setConfirmed(false);}}><option value="damage">Damage or loss</option><option value="late">Late-return fees</option></select></label>
   {setupIntentPolicy&&kind==="damage"&&<label>Recorded claim basis<select disabled={busy} value={claimBasis} onChange={e=>{setClaimBasis(e.target.value as "loss"|"severe_cosmetic_damage");request.current=null;setConfirmed(false);}}><option value="loss">Item lost or not returned</option><option value="severe_cosmetic_damage">Severe, permanent cosmetic damage</option></select></label>}
   <label>Amount to request (£)<input disabled={busy} type="number" min="0.01" max={remaining} step="0.01" required value={amount} onChange={e=>{setAmount(e.target.value);request.current=null;setConfirmed(false);}}/></label>
   <label>Itemised evidence and calculation<textarea disabled={busy} required minLength={10} maxLength={4000} value={reason} onChange={e=>{setReason(e.target.value);request.current=null;setConfirmed(false);}} placeholder="Identify the item, condition evidence, repair/valuation or late-rate calculation, and deductions for avoided costs or other recoveries."/></label>
   <label>Owner claim code<input type="password" autoComplete="off" required value={ownerClaimToken} onChange={e=>{setOwnerClaimToken(e.target.value);setConfirmed(false);}} disabled={busy} placeholder="Required to keep or charge money" /></label>
   <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/><span>{immediateClaim?"I confirm the permitted claim, evidence and amount. This sends the itemised notice and attempts the saved-card payment now.":setupIntentPolicy&&kind==="damage"?"I confirm this is a recorded loss or severe, permanent cosmetic damage beyond fair wear, supported by inspection evidence and a fair calculation. This sends a notice; it does not take payment.":"I checked the evidence and fair calculation. This sends a notice; it does not take payment."}</span></label>
   <button type="submit" disabled={busy||!ownerClaimToken.trim()||!confirmed||remaining!==undefined&&remaining<=0}>{busy?immediateClaim?"Sending & checking bank…":"Preparing notice…":immediateClaim?`Send notice & attempt ${formatGbp(Number(amount)||0)} now`:"Send itemised notice · no payment"}</button>
  </form></details>}
  <div className={styles.history}>{data.rows.map(row=><ChargeRow key={row.id} row={row} token={token} bookingId={bookingId} admin={admin} immediateClaim={immediateClaim}/>)}</div>
  {!data.rows.length&&<p className={styles.empty}>No damage or late-fee payment has been requested.</p>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
 </section>;
}
function ChargeRow({row,token,bookingId,admin,immediateClaim}:{row:any;token:string;bookingId:string;admin:boolean;immediateClaim:boolean}) {
 const convex=useConvex(),collect=useAction(api.securityCharges.collect),refresh=useAction(api.securityCharges.refresh),reference=useAction(api.securityCharges.reconcileReference),refund=useAction(api.securityCharges.refundPayment),resend=useAction(api.securityCharges.resendNotice),resendReceipt=useAction(api.securityCharges.resendReceipt),dispute=useMutation(api.securityChargeState.dispute),withdraw=useMutation(api.securityChargeState.closePrepared),propose=useMutation(api.securityChargeState.proposeResolution),accept=useMutation(api.securityChargeState.acceptResolution);
 const [now,setNow]=useState(Date.now),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[note,setNote]=useState(""),[reviewed,setReviewed]=useState(false),[bankRef,setBankRef]=useState('');
 useEffect(()=>{if(!['notice_sent','uncertain'].includes(row.state)||!row.collectAfter)return;const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t);},[row.state,row.collectAfter]);
 async function run(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setMessage("");try{await fn();}catch(e:any){setMessage(e?.data?.message??e?.message??"The payment status needs review.");}finally{setBusy(false);}}
 async function bank(){const result=await refresh({token,id:row.id});if(result.status!=="requires_action"||!result.clientSecret){setMessage(result.status==="paid"?"Payment confirmed.":"Payment status: "+result.status);return;}const key=process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;if(!key)throw Error("Bank approval is temporarily unavailable.");const stripe=await loadStripe(key);if(!stripe)throw Error("Bank approval could not open.");const result2=await stripe.confirmCardPayment(result.clientSecret);if(result2.error)throw Error(result2.error.message);const current=await refresh({token,id:row.id});setMessage(current.status==="paid"?"Payment confirmed.":"Payment status: "+current.status);}
 async function evidence(){const proof=await convex.query(api.securityChargeState.evidence,{token,id:row.id});const url=URL.createObjectURL(new Blob([JSON.stringify(proof,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="DB-Cinema-assessment-"+String(row.id).slice(-8)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function statement(){const params=new URLSearchParams({phase:'assessment',assessment:String(row.id)});const response=await fetch(`/api/invoice/${encodeURIComponent(bookingId)}?${params}`,{headers:{authorization:`Bearer ${token}`},cache:'no-store'});if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='application/pdf')throw Error('The assessment statement could not be opened.');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`DB-Cinema-assessment-${String(row.id).slice(-8)}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const unresolved=!!row.disputeReason&&!row.disputeResolvedAt;
 return <article className={styles.charge}>
  <div className={styles.row}><strong>{row.kind==="late"?"Late-return fees":"Damage / loss"}{row.claimBasis==="loss"?" · lost item":row.claimBasis==="severe_cosmetic_damage"?" · severe cosmetic damage":""} · {formatGbp(row.amount)}</strong><span>{unresolved?"Disputed · collection paused":row.state.replaceAll("_"," ")}</span></div><p>{row.reason}</p>
  {row.noticeAt&&<small>Notice accepted by the mail service {when(row.noticeAt)}; delivery is not confirmed{immediateClaim?" · one immediate attempt follows under this rental’s accepted terms":` · collection no earlier than ${when(row.collectAfter)} London time`}</small>}
  {row.state==="paid"&&<p>Bank-confirmed payment: {formatGbp(row.paid)}.</p>}
  {row.state==="paid"&&<button disabled={busy} onClick={()=>run(statement)}>Download assessment statement</button>}
  {row.refunded>0&&<p>Refunded to the original payment method: {formatGbp(row.refunded)}. This does not restore the used collection allowance.</p>}
  {admin&&row.refunded>0&&row.refundEmailStatus&&<small>Refund email · {row.refundEmailStatus}{row.refundEmailAt?` · accepted ${when(row.refundEmailAt)}`:""}{row.refundEmailError?` · ${row.refundEmailError}`:""}</small>}
  {row.refundStatus&&<p>Refund status: {row.refundStatus.replaceAll('_',' ')}.</p>}
  {row.error&&<p className={styles.error}>{row.error}</p>}
  {admin&&<div className={styles.actions}>
   {row.state==='paid'&&(row.receiptNoticeAt?<small>Receipt accepted by mail service; delivery is not confirmed.</small>:<button disabled={busy} onClick={()=>run(async()=>{await resendReceipt({token,id:row.id});setMessage('Receipt send requested. Check its status before retrying; delivery is not guaranteed.');})}>Retry receipt email</button>)}
   {row.state==="notice_pending"&&<button disabled={busy} onClick={()=>run(()=>resend({token,id:row.id}))}>Retry notice delivery</button>}
{["notice_sent","uncertain"].includes(row.state)&&<button className={styles.primary} disabled={busy||(!immediateClaim&&!reviewed)||unresolved||!row.collectAfter||row.collectAfter>now} onClick={()=>run(async()=>{const r=await collect({token,id:row.id});setMessage("Bank status: "+r.status);})}>{immediateClaim?`Check / attempt ${formatGbp(row.amount)}`:`Collect ${formatGbp(row.amount)}`}</button>}
{!immediateClaim&&["notice_sent","uncertain"].includes(row.state)&&<label className={styles.check}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/><span>I reviewed this exact amount and evidence.</span></label>}
   {["processing","requires_action","uncertain","collecting"].includes(row.state)&&<button disabled={busy} onClick={()=>run(async()=>{const r=await refresh({token,id:row.id,admin:true});setMessage("Bank status: "+r.status);})}>Reconcile bank status</button>}
   <button disabled={busy} onClick={()=>run(evidence)}>Download consent & evidence</button>
  </div>}
  {admin&&row.state==='paid'&&row.refunded<row.paid&&<details><summary>Refund collected claim</summary><p>Return {formatGbp(row.paid-row.refunded)} of this damage or late-fee payment to the original card. This does not add account credit.</p><label>Refund reason<textarea disabled={busy||!!row.refundReason&&row.refundStatus!=='failed'} minLength={5} maxLength={4000} value={row.refundReason&&row.refundStatus!=='failed'?row.refundReason:note} onChange={e=>setNote(e.target.value)}/></label><button disabled={busy||(row.refundReason??note).trim().length<5} onClick={()=>run(async()=>{const result=await refund({token,id:row.id,reason:row.refundStatus!=='failed'&&row.refundReason?row.refundReason:note});setMessage('Refund status: '+result.status);})}>{busy?'Reconciling…':row.refundStatus?'Reconcile / resume saved refund':'Refund remaining claim'}</button>{row.refundApprovalUrl&&<a href={row.refundApprovalUrl} target="_blank" rel="noopener noreferrer">Review Stripe approval request</a>}</details>}
  {!admin&&row.state==="requires_action"&&!unresolved&&<button disabled={busy} onClick={()=>run(bank)}>Review and approve {formatGbp(row.amount)} with your bank</button>}
  {admin&&row.state==='uncertain'&&<details><summary>Match an existing Stripe payment</summary><p>Use this when automatic history lookup cannot find the original attempt. This reads an existing payment and never creates a new charge.</p><label>Stripe payment reference<input value={bankRef} onChange={e=>setBankRef(e.target.value)} disabled={busy} placeholder="pi_…"/></label><button disabled={busy||!bankRef.startsWith('pi_')} onClick={()=>run(async()=>{const result=await reference({token,id:row.id,paymentIntentId:bankRef.trim()});setMessage('Bank status: '+result.status);})}>Verify existing bank receipt</button></details>}
  {(admin&&(["notice_pending","notice_sent"].includes(row.state)||unresolved)||!admin&&row.state!=="voided")&&<details><summary>{admin?"Review / withdraw assessment":"Raise a concern about this assessment"}</summary><label>{admin?"Reviewed evidence or withdrawal reason":"What needs review?"}<textarea maxLength={4000} minLength={5} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label>
   {admin?<div className={styles.actions}>{["notice_pending","notice_sent"].includes(row.state)&&<button disabled={busy||note.trim().length<5} onClick={()=>run(()=>withdraw({token,id:row.id,reason:note}))}>Withdraw without collection</button>}{unresolved&&<button disabled={busy||note.trim().length<10} onClick={()=>run(()=>propose({token,id:row.id,explanation:note}))}>Propose resolution to renter</button>}</div>:<button disabled={busy||note.trim().length<5||unresolved} onClick={()=>run(()=>dispute({token,id:row.id,reason:note}))}>Send concern · pause further collection</button>}
  </details>}
  {unresolved&&<p className={styles.error}>Concern: {row.disputeReason}</p>}
  {row.disputeResolution&&<div className={styles.resolution}><strong>Proposed resolution</strong><p>{row.disputeResolution}</p>{!admin&&!row.disputeResolvedAt&&<button disabled={busy} onClick={()=>run(()=>accept({token,id:row.id,expectedResolution:row.disputeResolution}))}>I have reviewed and accept this resolution</button>}</div>}
  {message&&<p role="status" className={styles.error}>{message}</p>}
 </article>;
}
