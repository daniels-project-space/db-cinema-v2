"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { IdVerify } from "@/components/IdVerify";
import { formatGbp } from "@/lib/pricing";
import { verificationCanStart } from "../../../shared/verificationProgress";
import { verificationJourney } from "../../../shared/verificationJourney";
import type { VerificationBooking } from "../../../shared/rentalReadiness";
import { SmartImage } from "@/components/SmartImage";
import { IconCheck, IconLock } from "@/components/icons";
import { ManagementShell } from "@/components/management/ManagementShell";
import styles from "./VerificationProgress.module.css";
import { DroneLicenceUpload } from "./DroneLicence";
import { useVerificationRefresh } from "./useVerificationRefresh";
import { rentalStageLabel } from "../../../shared/rentalReadiness";

export function VerificationBar({ booking }: { booking: VerificationBooking }) {
  const {steps,current}=verificationJourney(booking);
  return <ol aria-label="Verification progress" className={styles.steps} style={{gridTemplateColumns:`repeat(${steps.length},minmax(0,1fr))`}}>
    {steps.map((step,i)=><li key={step.label} aria-current={i===current?"step":undefined} className={`${styles.step} ${step.done?styles.stepDone:i===current?styles.stepCurrent:""}`}>
      <span aria-hidden className={styles.circle}>{step.done?<IconCheck className="h-4 w-4"/>:i+1}</span>
      <strong>{step.label}{step.done&&<span className="sr-only"> complete</span>}</strong><small>{step.detail}</small>
    </li>)}
  </ol>;
}
export function VerificationLink({ booking, compact = false }: { booking: VerificationBooking & { _id: string }; compact?: boolean }) {
  const approved = verificationJourney(booking).reviewed;
  const dronePending = booking.requiresDroneLicence && booking.droneLicenceStatus !== "approved";
  const label = booking.idVerifyStatus === "verified" && dronePending
    ? booking.droneLicenceStatus === "review" ? "Drone licence review · view progress" : booking.droneLicenceStatus === "requires_input" ? "Replace drone licence · view progress" : "Upload drone licence · view progress"
    : approved ? "View approved verification" : booking.idVerifyStatus === "requires_input" ? "Replace documents · view progress" : "View verification progress";
  return <section className={compact ? "mb-4" : "mb-4 rounded-2xl border border-accent-400/20 bg-accent-400/[.04] p-4"}>
    {!compact && <VerificationBar booking={booking} />}
    <Link href={`/account/verification/${booking._id}`} className={`${compact ? "" : "mt-3"} inline-block text-sm font-medium text-accent-300 hover:underline`}>{label} ↗</Link>
  </section>;
}
const checkLabels: Record<string, string> = { waiting: "Waiting for upload", processing: "Processing", approved: "Check passed", requires_input: "Upload needed", review: "Team review", rejected: "Needs attention" };
const statusLabels: Record<string, string> = { required: "Verify your identity", processing: "Checking your documents", manual_review: "Your verification is under review", requires_input: "Replace the requested documents", rejected: "Verification needs attention", verified: "Verification approved" };
function CheckIllustration({kind}:{kind:"identity"|"selfie"|"address"}) {
  const paths={identity:"M5 10h54v39H5z M5 19h54 M14 40v-3a7 7 0 0 1 14 0v3 M17 28a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M35 28h16 M35 35h12 M35 42h10",selfie:"M6 18V6h12 M46 6h12v12 M58 46v12H46 M18 58H6V46 M22 24a10 10 0 1 0 20 0 10 10 0 0 0-20 0 M15 53a17 17 0 0 1 34 0",address:"M10 4h31l12 12v44H10z M41 4v13h12 M19 18h13 M19 26h23 M19 34h14 M26 48l10-9 10 9 M29 46v10h14V46 M34 56v-6h5v6"};
  return <svg className={styles.illustration} aria-hidden viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
}
function dateLabel(date:number){return new Date(date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});}

export function VerificationProgress({ bookingId, checkoutSessionId, autoStart = false, presentation="embedded" }: { bookingId: string; checkoutSessionId?: string | null; autoStart?: boolean; presentation?:"embedded"|"page" }) {
  const account = useAccount(),router=useRouter();
  const booking = useQuery(api.bookings.verificationProgress, account.token || checkoutSessionId ? { bookingId: bookingId as any, token: account.token ?? undefined, checkoutSessionId: checkoutSessionId ?? undefined } : "skip");
  const refreshError = useVerificationRefresh(bookingId, account.token, checkoutSessionId, false, !!booking && booking.verificationAvailable && booking.idVerifyStatus !== "verified");
  if (account.loading || ((account.token || checkoutSessionId) && booking === undefined)) return <p role="status" className="py-6 text-sm text-white/50">Loading verification progress…</p>;
  if (!booking) return <div className="rounded-2xl border border-white/10 p-6"><h2 className="font-display text-xl text-white">Sign in to view this rental</h2><p className="mt-2 text-sm text-white/50">Use the account linked to your booking to see its verification and upload documents.</p><Link href={`/account?rental=${encodeURIComponent(bookingId)}`} className="btn-primary mt-4 px-5 py-2">Go to my account</Link></div>;
  const journey=verificationJourney(booking),wide=presentation==="page";
  const ready = booking.verificationAvailable && verificationCanStart(booking);
  const approved = journey.reviewed;
  const expired=(booking.verificationExpiresAt!=null&&booking.verificationExpiresAt<=Date.now())||(booking.documentExpiresAt!=null&&booking.documentExpiresAt<=Date.now());
  const uploadStatus=expired&&booking.idVerifyStatus==="verified"?"requires_input":booking.idVerifyStatus;
  const chat=`/account?rental=${encodeURIComponent(bookingId)}#chat`;
  const descriptions={identity:"A valid government-issued photo ID.",selfie:"A quick selfie to match your photo ID.",address:"A recent bill, bank statement or official address document."};
  const stage=booking.cancellationPending?"Cancellation in progress":booking.returnPending?"Return being settled":!journey.closed&&!approved&&ready?booking.idVerifyStatus==="manual_review"?"Verification under review":expired||booking.idVerifyStatus==="requires_input"?"Documents needed":booking.idVerifyStatus==="rejected"?"Verification needs attention":booking.idVerifyStatus==="verified"?"Saving verification documents":"Verification needed":rentalStageLabel(booking);
  const content=<section aria-label="Rental verification" className={styles.journey}>
    <div className={wide?styles.layout:undefined}>
      <div className={styles.main}>
        <span className={styles.badge}>{stage}</span>
        <VerificationBar booking={booking}/>
        {refreshError&&<p role="status" className={styles.refresh}>The latest check is delayed. Your saved progress is shown; we'll retry automatically.</p>}
        <div className={styles.panel}>
          <h2>{journey.closed?booking.cancellationPending?"Cancellation in progress":booking.returnPending?"Return being settled":"Rental closed":approved?"Your documents are approved":expired?"Renew your verification":statusLabels[booking.idVerifyStatus]??"Verify your identity"}</h2>
          <p role="status" aria-live="polite" className={styles.intro}>{journey.closed?"This rental no longer accepts document uploads.":!ready?"Complete your rental payment before verification can begin.":approved?booking.verificationReused?"Your recent verified documents have been reused for this rental.":"Your identity and address checks are complete.":booking.idVerifyStatus==="manual_review"?"The team is reviewing your documents. We'll contact you if anything else is needed.":"Have your photo ID and proof of address ready."}</p>
          {ready&&!journey.closed&&<div className={styles.checks}>{([['identity','Photo ID'],['selfie','Selfie check'],['address','Proof of address']] as const).map(([key,label])=>{
            const check=expired?"requires_input":booking.verificationChecks?.[key]??(approved?"approved":"waiting");
            return <div key={key} className={`${styles.check} ${check==="approved"?styles.checkApproved:""}`}><span className={styles.checkStatus}>{check==="waiting"?"Required":checkLabels[check]??"Pending"}</span><CheckIllustration kind={key}/><h3>{label}</h3><p>{descriptions[key]}</p></div>;
          })}</div>}
          {ready&&!journey.closed&&<div id="verification-upload" className={styles.action}><IdVerify bookingId={bookingId} compact status={uploadStatus} note={expired?"Your previous verification has expired. Complete a new check.":booking.verificationNote} checkoutSessionId={checkoutSessionId} autoStart={autoStart&&!approved&&!expired}/><p className={styles.secure}><IconLock/>Secure verification with Didit</p></div>}
          {ready&&!journey.closed&&booking.requiresDroneLicence&&<div className="mt-5"><DroneLicenceUpload bookingId={bookingId} token={account.token??undefined} checkoutSessionId={checkoutSessionId??undefined} status={booking.droneLicenceStatus} note={booking.droneLicenceNote}/></div>}
          {booking.verificationUpdatedAt&&<p className={styles.timestamp}>Updated {new Date(booking.verificationUpdatedAt).toLocaleString("en-GB",{timeZone:"Europe/London"})} · London time</p>}
          {!wide&&<Link href={chat} className={`${styles.link} mt-5`}>Message the team</Link>}
        </div>
      </div>
      {wide&&<aside className={styles.aside} aria-label="Your rental summary">
        <div className={`${styles.panel} ${styles.booking}`}>
          <div className={styles.bookingHead}><h2>Your rental</h2><Link href={chat} className={styles.link}>View rental</Link></div>
          {booking.lineItems.map((item,index)=><div className={styles.kit} key={index}>
            <SmartImage src={item.images[0]} fallbackSources={item.images.slice(1)} alt={item.title} className={styles.photo} imgClassName="!object-contain"/>
            <div><h3>{item.qty>1?`${item.qty} × `:""}{item.title}</h3><p>{dateLabel(item.start)} – {dateLabel(item.end)}<br/>{booking.fulfilment==="delivery"?"Delivery":"Pickup"} {item.pickupTime??"To be agreed"} · {booking.fulfilment==="delivery"?"Collection":"Return"} {item.returnTime??"To be agreed"}</p></div>
          </div>)}
          <dl className={styles.money}><div><dt>Rental subtotal</dt><dd>{formatGbp(booking.subtotal)}</dd></div>{booking.discount>0&&<div><dt>Discount</dt><dd>−{formatGbp(booking.discount)}</dd></div>}{booking.creditApplied>0&&<div><dt>Account credit</dt><dd>−{formatGbp(booking.creditApplied)}</dd></div>}{booking.membershipCreditApplied>0&&<div><dt>Subscription credit</dt><dd>−{formatGbp(booking.membershipCreditApplied)}</dd></div>}{booking.deliveryFee>0&&<div><dt>Delivery</dt><dd>{formatGbp(booking.deliveryFee)}</dd></div>}<div><dt>Refundable deposit</dt><dd>{formatGbp(booking.depositAmount)}</dd></div><div className={styles.total}><dt>Booking total</dt><dd>{formatGbp(booking.total)}</dd></div></dl>
          {booking.depositHoldAmount>0&&<div className={styles.hold}><div className={styles.holdTop}><span>{booking.depositHoldStatus==="scheduled"?"Card hold at pickup":"Card authorisation"}</span><strong>{formatGbp(booking.depositHoldAmount)}</strong></div><p>{booking.depositHoldStatus==="scheduled"?`Scheduled${booking.securityHoldDueAt?` for ${new Date(booking.securityHoldDueAt).toLocaleString("en-GB",{timeZone:"Europe/London",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} London time`:""}. Authorisation only · not a charge.`:booking.depositHoldStatus==="held"?"Authorised · not charged. Your bank may reduce the available balance while the hold is active.":booking.depositHoldStatus==="requires_action"?"Your bank needs approval. Open this rental to complete the card authorisation.":booking.depositHoldStatus==="released"?"The uncaptured card hold has been released.":"The card hold is not active. Message the team if you need help."}</p></div>}
        </div>
        <div className={`${styles.panel} ${styles.support}`}><h2>Need a hand?</h2><p>Ask the team about your rental or verification.</p><Link href={chat} className={styles.link}>Message the team</Link></div>
      </aside>}
    </div>
  </section>;
  if(!wide)return content;
  return <ManagementShell role="renter" name={account.me?.name||"My rental"} title={journey.closed?"Your rental":journey.ready?"Your rental is ready":"Your kit is reserved"} subtitle={journey.closed?"View your rental details and conversation.":approved?"Your documents are approved. Check your pickup and card hold below.":"Complete verification to get ready for pickup."} active="rentals" nav={[{key:"rentals",label:"My rentals"},{key:"calendar",label:"Calendar",icon:"calendar"},{key:"chat",label:"Messages",icon:"messages"},{key:"invoices",label:"Invoices",icon:"documents"},{key:"plans",label:"Shoot lists",icon:"calendar"},{key:"membership",label:"Membership",icon:"people"},{key:"profile",label:"Account",icon:"settings"}]} onNavigate={key=>router.push(`/account${key==="chat"?`?rental=${encodeURIComponent(bookingId)}`:""}#${key}`)}>{content}</ManagementShell>;
}
