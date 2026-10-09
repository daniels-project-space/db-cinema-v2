"use client";
import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {useAction,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {SmartImage} from "@/components/SmartImage";
import {formatGbp} from "@/lib/pricing";
import {rentalTitle} from "@/lib/rentalPresentation";
import drawer from "@/components/rentals/RentalRequestApply.module.css";
import styles from "@/components/rentals/RentalAdditionApproval.module.css";
const iso=(at:number)=>new Date(at).toISOString().slice(0,10);
type Props={token:string;bookingId:string;changeRequestId?:string;decisionNote?:string;onClose:()=>void};
export function RentalKitProposal(props:Props){return <KitProposal key={JSON.stringify([props.token,props.bookingId,props.changeRequestId])} {...props}/>;}
function KitProposal({token,bookingId,changeRequestId,decisionNote,onClose}:Props){
 const titleId=useId(),dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),request=useRef<string|null>(null);
 const [search,setSearch]=useState(""),[lookup,setLookup]=useState(""),[listingId,setListingId]=useState(""),[qty,setQty]=useState(1),[start,setStart]=useState(""),[end,setEnd]=useState(""),[reason,setReason]=useState((decisionNote??"").slice(0,400)),[complimentary,setComplimentary]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const b=useQuery(api.rentalOperations.details,{token,bookingId:bookingId as any});
 const catalog=useQuery(api.catalog.listListings,{search:lookup,limit:24});
 const [selection,setSelection]=useState<NonNullable<typeof catalog>[number]|null>(null);
 const q=useQuery(api.rentalAdditionState.proposalQuote,listingId?{token,bookingId:bookingId as any,listingId:listingId as any,qty,start:start?Date.parse(start+"T00:00:00Z"):undefined,end:end?Date.parse(end+"T00:00:00Z"):undefined,complimentary}:"skip");
 const send=useAction(api.rentalAdditions.start);
 useEffect(()=>{const node=dialog.current,previous=document.activeElement as HTMLElement|null;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>{const timer=setTimeout(()=>setLookup(search),300);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>{if(b?.activeAdditionId&&!busy)onClose();},[b?.activeAdditionId,busy,onClose]);
 async function submit(){
  if(inFlight.current||!q?.available||q.amount===undefined||q.holdTotal===undefined||q.start===undefined||q.end===undefined)return;
  inFlight.current=true;setBusy(true);setError("");
  try{request.current??=crypto.randomUUID();await send({token,bookingId:bookingId as any,requestId:request.current,changeRequestId:changeRequestId as any,listingId:listingId as any,qty,reason,complimentary,start:q.start,end:q.end,expectedAmount:q.amount,expectedHoldTotal:q.holdTotal});onClose();}
  catch(e:any){setError(e.data?.message??e.message??"The proposal could not be saved. Check the rental and retry.");}
  finally{inFlight.current=false;setBusy(false);}
 }
 const selected=selection;
 return createPortal(<dialog ref={dialog} className={drawer.dialog} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><form className={drawer.panel} data-testid="admin-kit-proposal" onSubmit={e=>{e.preventDefault();void submit();}}>
  <header className={drawer.header}><div><span className={drawer.brand}>DB <span>CINEMA</span><small>RENTALS</small></span><h2 id={titleId}>Kit change proposal</h2></div><button type="button" className={drawer.close} aria-label="Close kit proposal" disabled={busy} onClick={onClose}>×</button></header>
  {!b?<p role="status">Loading rental details…</p>:<>
   {b.customer&&<div className={drawer.customer}><span>{(b.customer.name??b.customer.email).slice(0,2).toUpperCase()}</span><div><strong>{b.customer.name??"Rental customer"}</strong><a href={`mailto:${b.customer.email}`}>{b.customer.email}</a></div></div>}
   <section className={drawer.section}><h3>Current kit</h3><div className={styles.ownerKit}>{b.lineItems.map((item,i)=><div className={styles.item} key={i}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><strong>{item.qty}× {rentalTitle(item.title)}</strong></div>)}</div></section>
   <section className={drawer.section}><h3>Add equipment to proposal</h3><label>Search catalogue<input aria-label="Search kit for proposal" value={search} disabled={busy} onChange={e=>setSearch(e.target.value)} placeholder="Camera, lens or kit name"/></label><div className={styles.catalog}>{catalog===undefined?<p role="status">Loading equipment…</p>:catalog.filter(item=>!item.displayOnly).slice(0,12).map(item=><button type="button" key={item._id} aria-pressed={listingId===item._id} disabled={busy} onClick={()=>{setListingId(item._id);setSelection(item);}}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><span>{rentalTitle(item.title)}</span></button>)}{catalog&&!catalog.filter(item=>!item.displayOnly).length&&<p>No matching equipment. Try another search.</p>}</div>
    {selected&&<div className={styles.hero}><SmartImage src={selected.heroImage} fallbackSources={selected.imageSources} alt={selected.title} className={styles.photo}/><div className={styles.heroCopy}><h3>{rentalTitle(selected.title)}</h3><label>Quantity<div className={styles.quantity}><button type="button" aria-label="Reduce quantity" disabled={busy||qty<=1} onClick={()=>setQty(q=>q-1)}>−</button><input required aria-label="Proposed quantity" type="number" min={1} max={20} value={qty} disabled={busy} onChange={e=>setQty(Number(e.target.value))}/><button type="button" aria-label="Increase quantity" disabled={busy||qty>=20} onClick={()=>setQty(q=>q+1)}>+</button></div></label></div></div>}
    <div className={drawer.inputs}><label>Rental collection date<input type="date" value={start||(q?.start!==undefined?iso(q.start):"")} disabled={busy} onChange={e=>setStart(e.target.value)}/></label><label>Rental return date<input type="date" min={start||undefined} value={end||(q?.end!==undefined?iso(q.end):"")} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label></div>
    {listingId&&<p role="status" className={drawer.note}>{q===undefined?"Checking stock and price…":q?.available?"✓ Stock available for these dates":q?.reason??"Unable to quote this equipment."}</p>}
   </section>
   {selected&&<section className={styles.comparison} aria-label="Current and proposed kit"><div className={styles.kit}><h3>Current kit</h3>{b.lineItems.map((item,i)=><div className={styles.item} key={i}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><strong>{item.qty}× {rentalTitle(item.title)}</strong></div>)}</div><span className={styles.arrow} aria-hidden="true">→</span><div className={`${styles.kit} ${styles.proposed}`}><h3>Proposed kit</h3>{b.lineItems.map((item,i)=><div className={styles.item} key={i}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><strong>{item.qty}× {rentalTitle(item.title)}</strong></div>)}<div className={`${styles.item} ${styles.added}`}><SmartImage src={selected.heroImage} fallbackSources={selected.imageSources} alt={selected.title} className={styles.thumb}/><strong>+ {qty}× {rentalTitle(selected.title)}</strong></div></div></section>}
   {q?.available&&q.amount!==undefined&&<section className={styles.quote} data-testid="admin-kit-live-quote"><h3>Quote breakdown</h3><dl>{!!q.baseAmount&&<div><dt>Original unpaid rental</dt><dd>{formatGbp(q.baseAmount)}</dd></div>}{q.membershipFee!==undefined&&q.membershipFee>0&&<div><dt>First membership payment</dt><dd>{formatGbp(q.membershipFee)}</dd></div>}<div><dt>Additional rental</dt><dd>{formatGbp(q.lineTotal??0)}</dd></div><div><dt>Additional refundable security</dt><dd>{formatGbp(q.securityCharge??0)}</dd></div></dl><div className={styles.total}><span>Due for this checkout</span><strong>{formatGbp(q.amount)}</strong></div><div className={styles.security}><span aria-hidden="true">◇</span><div><strong>Updated authorisation · {formatGbp(q.holdTotal??0)}</strong><p>Bank authorisation is arranged separately from the amount charged. Payment and security checks apply before confirmation.</p></div></div></section>}
   <label className={drawer.check}><input type="checkbox" checked={complimentary} disabled={busy} onChange={e=>setComplimentary(e.target.checked)}/>No additional rental charge · any required refundable security still applies.</label><label className={drawer.reason}>Proposal reason · required<textarea required minLength={5} maxLength={400} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Explain the agreed kit change"/></label>
  </>}
  {error&&<p role="alert" className={drawer.error}>{error}</p>}<footer className={drawer.actions}><button className={drawer.primary} disabled={busy||!q?.available||reason.trim().length<5}>{busy?"Saving proposal…":"Send proposal & payment link"}</button><button type="button" className={drawer.launch} disabled={busy} onClick={onClose}>Discard proposal</button></footer><p className={drawer.note}>Items are added after payment and the required security checks.</p>
 </form></dialog>,document.body);
}
