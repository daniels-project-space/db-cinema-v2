"use client";
import { useRef, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { loadStripe } from "@stripe/stripe-js";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { rentalTitle } from "@/lib/rentalPresentation";
import { SmartImage } from "@/components/SmartImage";
import styles from "./RentalAdditionApproval.module.css";
const resultMessage=(status:string)=>status==="held"?"Items added to your order.":status==="scheduled"?"Items added. The security authorisation is scheduled for pickup.":status==="draft_applied"?"Items added to your checkout. Complete the updated checkout to continue.":status==="awaiting_payment"?"Review and pay for the proposed items using the link above.":"The team is checking the payment and security status.";
const date=(at:number)=>new Date(at).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});
export function RentalAdditionApproval({
  token,
  bookingId,
}: {
  token: string;
  bookingId: string;
}) {
  return <AdditionApproval key={JSON.stringify([token, bookingId])} token={token} bookingId={bookingId} />;
}

function AdditionApproval({ token, bookingId }: { token: string; bookingId: string }) {
  const r = useQuery(api.rentalAdditionState.customerState, {
    token,
    bookingId: bookingId as any,
  });
  const resume = useAction(api.rentalAdditions.resumeByCustomer);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const inFlight=useRef(false);
  if (!r) return null;
  async function approve() {
    if(inFlight.current)return;inFlight.current=true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await resume({ token, bookingId: bookingId as any });
      if (result.clientSecret) {
        const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!key)
          throw Error("Bank approval is unavailable. Contact the team.");
        const stripe = await loadStripe(key);
        if (!stripe) throw Error("Bank approval could not open.");
        const confirmation = await stripe.confirmCardPayment(
          result.clientSecret,
        );
        if (confirmation.error)
          throw Error(
            confirmation.error.message ?? "Your bank did not approve the hold.",
          );
        const final = await resume({ token, bookingId: bookingId as any });
        setMessage(
          resultMessage(final.status),
        );
      } else
        setMessage(
          resultMessage(result.status),
        );
    } catch (e: any) {
      setMessage(e.data?.message ?? (typeof e.data==="string"?e.data:typeof e.message==="string"&&!e.message.includes("[CONVEX")?e.message:"We could not confirm this update. Please retry or message the team."));
    } finally {
      inFlight.current=false;setBusy(false);
    }
  }
  if (["withdrawing", "refund_pending", "refund_failed"].includes(r.status)) return <aside role="status" className={`${styles.panel} ${styles.withdrawn}`}><h3>Kit proposal withdrawn</h3><p>{r.qty}× {rentalTitle(r.title)}</p><p>{r.status==="refund_failed"?"The refund needs the team’s attention. Please contact us in this rental conversation.":"We’re confirming payment and any refund to the original payment method. This item will not be added while withdrawal is processing."}</p></aside>;
  const paid=r.paymentReceived;
  return <aside className={styles.panel} id={`kit-proposal-${r.id}`} data-booking-id={bookingId} tabIndex={-1} data-testid="kit-addition-approval"><header className={styles.header}><div><span className={styles.eyebrow}>Your rental</span><h2>Your kit proposal</h2></div><span className={styles.badge}>{r.status==="awaiting_payment"?"Payment required":r.status==="requires_action"?"Bank approval required":r.status==="failed"?"Security needs review":"Checking your proposal"}</span></header>
    <section className={styles.hero}><SmartImage src={r.heroImage} fallbackSources={r.imageSources} alt={r.title} className={styles.photo}/><div className={styles.heroCopy}><span className={styles.eyebrow}>Proposed equipment</span><h3>{rentalTitle(r.title)}</h3><p>{r.qty}× · {date(r.start)} – {date(r.end)}</p><strong>+ {formatGbp(r.lineTotal)} rental</strong></div></section>
    <ol className={styles.steps}><li data-done="true"><span>✓</span>Team proposal</li><li data-done={paid} data-active={!paid}><span>{paid?"✓":"2"}</span>Payment</li><li data-active={paid}><span>3</span>{r.securityDeferred?"Pickup security":"Security & confirmation"}</li></ol>
    <section className={styles.comparison} aria-label="Current and proposed equipment"><div className={styles.kit}><h3>Current kit</h3>{r.currentItems.map((item,i)=><div className={styles.item} key={i}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><div><strong>{item.qty}× {rentalTitle(item.title)}</strong><small>{date(item.start)} – {date(item.end)}</small></div></div>)}</div><span aria-hidden="true" className={styles.arrow}>→</span><div className={`${styles.kit} ${styles.proposed}`}><h3>Proposed kit</h3>{r.currentItems.map((item,i)=><div className={styles.item} key={i}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><div><strong>{item.qty}× {rentalTitle(item.title)}</strong><small>{date(item.start)} – {date(item.end)}</small></div></div>)}<div className={`${styles.item} ${styles.added}`}><SmartImage src={r.heroImage} fallbackSources={r.imageSources} alt={r.title} className={styles.thumb}/><div><strong>+ {r.qty}× {rentalTitle(r.title)}</strong><small>{date(r.start)} – {date(r.end)}</small></div></div></div></section>
    <section className={styles.quote}><h3>Quote breakdown</h3><dl>{r.baseAmount>0&&<div><dt>Original unpaid rental</dt><dd>{formatGbp(r.baseAmount)}</dd></div>}{r.membershipFee!==undefined&&r.membershipFee>0&&<div><dt>First membership payment</dt><dd>{formatGbp(r.membershipFee)}</dd></div>}<div><dt>Additional rental</dt><dd>{formatGbp(r.lineTotal)}</dd></div><div><dt>Additional refundable security</dt><dd>{formatGbp(r.securityCharge)}</dd></div></dl><div className={styles.total}><span>{paid?"Proposal payment":"Due for this checkout"}</span><strong>{formatGbp(r.amount)}</strong></div><div className={styles.security}><span aria-hidden="true">◇</span><div><strong>Updated card authorisation · {formatGbp(r.holdTotal)}</strong><p>{r.securityDeferred?"Scheduled for the agreed pickup. This authorisation is separate from the amount charged today.":"Any required bank authorisation is checked separately before the items join your order."}</p></div></div><div className={styles.actions}>
      {r.url&&r.status==="awaiting_payment"&&<a href={r.url} data-testid="kit-proposal-pay" className={styles.primary}>Review & pay {formatGbp(r.amount)}</a>}
      {r.sessionId&&["awaiting_payment","paid","requires_action","held","failed"].includes(r.status)&&<button disabled={busy} data-testid="kit-proposal-resume" onClick={()=>void approve()} className={r.status==="requires_action"?styles.primary:styles.secondary}>{busy?"Checking your bank…":r.status==="requires_action"?"Approve card hold":"Check payment status"}</button>}
    </div><p className={styles.note}>The proposed items join your order after payment and the required security checks.</p><p className={styles.note}>Payment deadline: {new Date(r.expiresAt).toLocaleString("en-GB",{timeZone:"Europe/London",dateStyle:"medium",timeStyle:"short"})} · London</p></section>
    {message&&<p role="status" className={styles.message}>{message}</p>}
  </aside>;
}
