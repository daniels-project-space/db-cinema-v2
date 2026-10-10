"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {useMutation,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {formatGbp} from "@/lib/pricing";
import styles from "./AccountCreditAdjust.module.css";
type Props={token:string;accountId:string;name:string;email:string;balance?:number;refundCredit?:number};
type Attempt={token:string;accountId:any;requestId:string;deltaPence:number;expectedBalancePence:number;reason:string};
export function AccountCreditAdjust(props:Props){return <CreditControl key={JSON.stringify([props.token,props.accountId])} {...props}/>;}
function CreditControl({token,accountId,name,email,balance,refundCredit}:Props){
 const [open,setOpen]=useState(false),[direction,setDirection]=useState("add"),[amount,setAmount]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[refreshKey,setRefreshKey]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),launcher=useRef<HTMLButtonElement|null>(null),inFlight=useRef(false),attempt=useRef<Attempt|null>(null),alive=useRef(true);
 const state=useQuery(api.accountCredit.state,open?{token,accountId:accountId as any,refreshKey}:"skip");
 const adjust=useMutation(api.accountCredit.adjust);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!open)return;dialog.current?.showModal();const timer=setInterval(()=>setRefreshKey(Date.now()),60000);return()=>{clearInterval(timer);dialog.current?.close();};},[open]);
 function closeDialog(){if(inFlight.current)return;setOpen(false);requestAnimationFrame(()=>launcher.current?.focus());}
 const pence=/^\d+(?:\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0;
 const delta=direction==="add"?pence:-pence;
 async function submit(){
  if(inFlight.current||!state)return;
  if(!attempt.current){if(!pence||pence>1000000||reason.trim().length<5)return;attempt.current={token,accountId:accountId as any,requestId:crypto.randomUUID(),deltaPence:delta,expectedBalancePence:state.balancePence,reason:reason.trim()};}
  inFlight.current=true;setBusy(true);setError("");setMessage("");
  try{await adjust(attempt.current);if(!alive.current)return;attempt.current=null;setAmount("");setReason("");setMessage("Adjustment recorded in this account’s credit history.");setRefreshKey(Date.now());}
  catch(e:any){if(!alive.current)return;setError(e.data?.message??e.message??"The result is not yet known. Retry the same adjustment to check it safely.");if(["invalid_adjustment","balance_changed","insufficient_manual_credit","account_missing","request_conflict"].includes(e.data?.code)){attempt.current=null;setRefreshKey(Date.now());}}
  finally{inFlight.current=false;if(alive.current)setBusy(false);}
 }
 function launch(button:HTMLButtonElement){launcher.current=button;setOpen(true);setRefreshKey(Date.now());}
 return <><header className={styles.cardHeader}><span>Account credit</span><button type="button" disabled={balance===undefined} onClick={e=>launch(e.currentTarget)}>Edit</button></header><strong className={styles.balance}>{balance===undefined?"…":formatGbp(balance)}</strong>{refundCredit!==undefined&&<small className={styles.refundCredit}>{formatGbp(refundCredit)} refund credit included</small>}<button type="button" disabled={balance===undefined} className={styles.launch} onClick={e=>launch(e.currentTarget)}>Adjust credit</button>
 {open&&createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="account-credit-title" onCancel={e=>{e.preventDefault();closeDialog();}}>
 <form onSubmit={e=>{e.preventDefault();void submit();}}>
 <header className={styles.heading}><div><small>Customers & Members</small><h2 id="account-credit-title">Adjust account credit</h2><p>{name}<span>{email}</span></p></div><button type="button" aria-label="Close credit adjustment" disabled={busy} onClick={closeDialog}>×</button></header>
 {!state?<p role="status">Loading this account’s credit…</p>:<>
 <div className={styles.totals}><div><span>Available account credit</span><strong>{formatGbp(state.balancePence/100)}</strong></div><div><span>Admin-issued credit available to remove</span><strong>{formatGbp(state.removablePence/100)}</strong></div></div>
 <fieldset disabled={busy||!!attempt.current} className={styles.fields}><label>Adjustment<select value={direction} onChange={e=>setDirection(e.target.value)}><option value="add">Add admin credit</option><option value="remove">Remove admin-issued credit</option></select></label><label>Amount · GBP<input inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" maxLength={12} aria-label="Credit adjustment amount"/><small>Maximum £10,000 per adjustment</small></label><label className={styles.reason}>Reason<textarea required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Recorded in this account’s credit history"/></label></fieldset>
 <p className={styles.note}>Admin credit expires after 365 days. Removal protects credit already reserved by a checkout. Refund and subscription credit follow their own settlement rules.</p>
 {pence>0&&<div className={styles.preview}><span>Balance after this adjustment</span><strong>{formatGbp(((attempt.current?.expectedBalancePence??state.balancePence)+(attempt.current?.deltaPence??delta))/100)}</strong></div>}
 <p className={styles.note}>This changes account credit. It does not refund or charge a card.</p>
 <footer className={styles.actions}><button type="submit" disabled={busy||(!attempt.current&&(!pence||pence>1000000||reason.trim().length<5||direction==="remove"&&pence>state.removablePence))}>{busy?"Saving…":attempt.current?"Retry same adjustment":"Save adjustment"}</button><button type="button" disabled={busy} onClick={closeDialog}>Back</button></footer>
 <section className={styles.history}><h3>Recent credit adjustments</h3>{!state.history.length?<p>No admin adjustments recorded yet.</p>:state.history.map(row=><article key={row.id}><div><strong>{row.deltaPence>0?"+":"−"}{formatGbp(Math.abs(row.deltaPence)/100)}</strong><time>{new Date(row.at).toLocaleString("en-GB",{timeZone:"Europe/London"})}</time></div><p>{row.reason}</p><small>Balance after adjustment {formatGbp(row.balanceAfterPence/100)}</small></article>)}</section>
 </>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
 </form></dialog>,document.body)}</>;
}
