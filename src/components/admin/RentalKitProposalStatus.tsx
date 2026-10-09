"use client";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import { rentalTitle } from "@/lib/rentalPresentation";
import styles from "@/components/rentals/RentalAdditionApproval.module.css";

type Proposal={_id:string;title:string;qty:number;start:number;end:number;status:string;lineTotal:number;securityCharge:number;holdTotal:number;membershipFee?:number;draftReplacement?:boolean;baseTotal?:number;paymentUrl?:string;sessionId?:string;paymentIntentId?:string;withdrawalRequestedAt?:number;heroImage?:string|null;imageSources?:string[];reason:string;createdAt:number};
const date=(n:number)=>new Date(n).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});
export function RentalKitProposalStatus({proposal:r,busy,onResume,onCheck,onWithdraw}:{proposal:Proposal;busy:boolean;onResume:()=>void;onCheck:()=>void;onWithdraw:()=>void}){
 const withdrawing=!!r.withdrawalRequestedAt;
 const label=withdrawing?(r.status==="refund_failed"?"Refund needs attention":"Withdrawal processing"):({awaiting_payment:"Payment required",paid:"Payment received",requires_action:"Customer bank approval required",held:"Security authorised",failed:"Security needs review",prepared:"Preparing proposal"} as Record<string,string>)[r.status]??r.status.replaceAll("_"," ");
 const amount=(r.draftReplacement?r.baseTotal??0:0)+r.lineTotal+r.securityCharge+(r.membershipFee??0);
 return <section className={`${styles.panel} ${styles.ownerStatus}`} aria-label="Saved kit proposal" data-testid="owner-kit-proposal">
  <header className={styles.header}><div><span className={styles.eyebrow}>Saved kit proposal</span><h3>{rentalTitle(r.title)}</h3></div><span className={styles.badge} role="status">{label}</span></header>
  <div className={styles.hero}><SmartImage src={r.heroImage} fallbackSources={r.imageSources} alt={r.title} className={styles.photo}/><div className={styles.heroCopy}><span className={styles.eyebrow}>Proposed equipment</span><h3>{r.qty}× {rentalTitle(r.title)}</h3><p>{date(r.start)} – {date(r.end)}</p><p>{r.reason}</p></div></div>
  <div className={styles.quote}><h3>Saved quote</h3><dl>{r.draftReplacement&&<div><dt>Existing rental checkout</dt><dd>{formatGbp(r.baseTotal??0)}</dd></div>}<div><dt>Additional rental</dt><dd>{formatGbp(r.lineTotal)}</dd></div>{!!r.membershipFee&&<div><dt>First subscription month</dt><dd>{formatGbp(r.membershipFee)}</dd></div>}<div><dt>Additional refundable security</dt><dd>{formatGbp(r.securityCharge)}</dd></div></dl><div className={styles.total}><span>{r.paymentIntentId?"Payment received":"Due for this checkout"}</span><strong>{formatGbp(amount)}</strong></div><div className={styles.security}><span>◇</span><div><strong>Updated card authorisation · {formatGbp(r.holdTotal)}</strong><p>Separate from the amount charged. The proposal remains pending until its payment and security requirements are resolved.</p></div></div></div>
  <div className={styles.actions}>{!withdrawing&&!r.paymentIntentId&&r.paymentUrl&&<a className={styles.primary} href={r.paymentUrl} target="_blank" rel="noopener noreferrer">Open saved payment link</a>}{!withdrawing&&<button className={styles.secondary} disabled={busy} type="button" onClick={r.sessionId?onCheck:onResume}>{busy?"Checking…":r.sessionId?"Check payment & continue":"Resume saved proposal"}</button>}<button className={styles.secondary} disabled={busy} type="button" onClick={onWithdraw}>{withdrawing?"Check withdrawal":"Withdraw proposal"}</button></div>
  <p className={styles.note}>{withdrawing?"Refunds must settle before this rental can be changed again.":"Finish or withdraw this proposal before changing dates, cancellation, refund or return settlement."}</p>
 </section>;
}
