"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { IdVerify } from "@/components/IdVerify";
import { formatGbp } from "@/lib/pricing";
import { securityReady } from "../../../shared/verificationProgress";
import { DroneLicenceUpload } from "./DroneLicence";

export function VerificationBar({ booking }: { booking: { status: string; idVerifyStatus?: string; depositHoldAmount?: number; depositHoldStatus?: string | null; requiresDroneLicence?: boolean; droneLicenceStatus?: string } }) {
  const paid = ["confirmed", "active", "returned"].includes(booking.status);
  const ready = securityReady(booking) || booking.status === "returned";
  const verified = booking.idVerifyStatus === "verified";
  const droneApproved = !booking.requiresDroneLicence || booking.droneLicenceStatus === "approved";
  const stages = [{ label: "Payment", done: paid }, { label: "Security", done: ready }, { label: "Documents", done: verified }, ...(booking.requiresDroneLicence ? [{ label: "Drone licence", done: droneApproved }] : []), { label: "Approved", done: paid && ready && verified && droneApproved }];
  const current = stages.findIndex(step => !step.done);
  return <ol aria-label="Verification progress" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }} className="grid gap-2 border-b border-white/10 pb-4">
    {stages.map((step, i) => <li key={step.label} aria-current={i === current ? "step" : undefined} className={`min-w-0 text-center text-[10px] sm:text-xs ${step.done ? "text-accent-300" : i === current ? "text-white" : "text-white/35"}`}>
      <span aria-hidden className={`mb-2 block h-1 rounded-full ${step.done ? "bg-accent-400" : i === current ? "bg-accent-400/35" : "bg-white/10"}`} />
      {step.label}{step.done && <span className="sr-only"> complete</span>}
    </li>)}
  </ol>;
}
export function VerificationLink({ booking }: { booking: { _id: string; status: string; idVerifyStatus?: string; depositHoldAmount?: number; depositHoldStatus?: string | null } }) {
  const label = booking.idVerifyStatus === "verified" ? "View approved verification" : booking.idVerifyStatus === "requires_input" ? "Replace documents · view progress" : "View verification progress";
  return <section className="mb-4 rounded-2xl border border-accent-400/20 bg-accent-400/[.04] p-4">
    <VerificationBar booking={booking} />
    <Link href={`/account/verification/${booking._id}`} className="mt-3 inline-block text-sm font-medium text-accent-300 hover:underline">{label} ↗</Link>
  </section>;
}
const checkLabels: Record<string, string> = { waiting: "Waiting for upload", processing: "Processing", approved: "Check passed", requires_input: "Upload needed", review: "Team review", rejected: "Needs attention" };
const statusLabels: Record<string, string> = { required: "Verify your rental", processing: "Checking your documents", manual_review: "Your verification is under review", requires_input: "Replace the requested documents", rejected: "Verification needs attention", verified: "Verification approved" };
export function VerificationProgress({ bookingId, checkoutSessionId, autoStart = false }: { bookingId: string; checkoutSessionId?: string | null; autoStart?: boolean }) {
  const account = useAccount();
  const booking = useQuery(api.bookings.verificationProgress, account.token || checkoutSessionId ? { bookingId: bookingId as any, token: account.token ?? undefined, checkoutSessionId: checkoutSessionId ?? undefined } : "skip");
  if (account.loading || ((account.token || checkoutSessionId) && booking === undefined)) return <p role="status" className="py-6 text-sm text-white/50">Loading verification progress…</p>;
  if (!booking) return <div className="rounded-2xl border border-white/10 p-6"><h2 className="font-display text-xl text-white">Sign in to view this rental</h2><p className="mt-2 text-sm text-white/50">Use the account linked to your booking to see its verification and upload documents.</p><Link href={`/account?rental=${encodeURIComponent(bookingId)}`} className="btn-primary mt-4 px-5 py-2">Go to my account</Link></div>;
  const ready = securityReady(booking);
  const closed = ["cancelled", "returned"].includes(booking.status);
  const approved = booking.idVerifyStatus === "verified";
  return <section aria-label="Rental verification" className="rounded-3xl border border-accent-400/20 bg-[#131713] p-5 text-left sm:p-7">
    <VerificationBar booking={booking} />
    <div className="hud-label mt-5 !text-accent-300">Your rental · verification</div>
    <h2 className="mt-2 font-display text-2xl font-semibold text-white">{closed ? "Rental closed" : !ready ? "Complete payment and security" : statusLabels[booking.idVerifyStatus] ?? "Verify your rental"}</h2>
    <p role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-white/60">{closed ? "This rental no longer accepts document uploads." : !ready ? "Finish the rental payment, refundable security payment and any required bank approval for the card hold. Verification opens immediately afterwards." : approved ? booking.verificationReused ? "Your recent Didit check was checked again and reused. You do not need to upload those documents again." : "Your identity and address have been approved for this rental." : "Your payment is confirmed. Complete your ID, selfie and proof of address below before equipment handover. This page updates as results arrive."}</p>
    {ready && !closed && <div className="mt-5 grid gap-2 sm:grid-cols-3">{([['identity', 'Photo ID'], ['selfie', 'Selfie & face match'], ['address', 'Proof of address']] as const).map(([key, label]) => {
      const check = booking.verificationChecks?.[key] ?? (approved ? "approved" : "waiting");
      return <div key={key} className="rounded-xl border border-white/10 p-3"><p className="text-xs text-white/65">{label}</p><p className={`mt-2 text-sm ${check === "approved" ? "text-accent-300" : ["rejected", "requires_input"].includes(check) ? "text-amber-200" : "text-white/80"}`}>{checkLabels[check] ?? "Pending"}</p>{["waiting", "requires_input"].includes(check) && !approved && <a href="#verification-upload" className="mt-2 inline-block text-xs text-accent-300 hover:underline">{check === "requires_input" ? "Replace document" : "Open upload form"} ↓</a>}</div>;
    })}</div>}
    {booking.verificationUpdatedAt && <p className="mt-3 text-[11px] text-white/40">Last update: {new Date(booking.verificationUpdatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} London time</p>}
    <div className="mt-5 rounded-2xl border border-white/10 p-4">
      <p className="text-sm font-medium text-white/80">Equipment limit per person · £15,000</p>
      {booking.exposure ? <><dl className="mt-3 space-y-2 text-xs text-white/60"><div className="flex justify-between gap-3"><dt>Allocated now</dt><dd className="font-mono text-white">{formatGbp(booking.exposure.currentPence / 100)}</dd></div><div className="flex justify-between gap-3"><dt>Maximum across overlapping rentals</dt><dd className="font-mono text-white">{formatGbp(booking.exposure.peakPence / 100)} / £15,000</dd></div></dl><div role="meter" aria-label="Peak equipment allocation" aria-valuemin={0} aria-valuemax={15000} aria-valuenow={Math.min(15000, booking.exposure.peakPence / 100)} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full ${booking.exposure.peakPence > booking.exposure.capPence ? "bg-amber-400" : "bg-accent-400"}`} style={{width:`${Math.min(100, booking.exposure.peakPence / booking.exposure.capPence * 100)}%`}} /></div></> : <p className="mt-2 text-xs text-amber-200">Your equipment allocation needs a team check. The limit is still enforced before new bookings and handover.</p>}
      <p className="mt-3 text-[11px] leading-5 text-white/40">Equipment replacement value across overlapping rentals, including pending checkouts. Collected kit stays counted until its return is recorded.</p>
    </div>
    {ready && !closed && <div id="verification-upload" className="mt-5 scroll-mt-24"><IdVerify bookingId={bookingId} status={booking.idVerifyStatus} note={booking.verificationNote} checkoutSessionId={checkoutSessionId} autoStart={autoStart && !approved} /></div>}
    {ready && !closed && booking.requiresDroneLicence && <div className="mt-5"><DroneLicenceUpload bookingId={bookingId} token={account.token ?? undefined} checkoutSessionId={checkoutSessionId ?? undefined} status={booking.droneLicenceStatus} note={booking.droneLicenceNote} /></div>}
    <Link href={`/account?rental=${encodeURIComponent(bookingId)}#chat`} className="mt-5 inline-block text-xs text-accent-300 hover:underline">Open this rental in my account ↗</Link>
  </section>;
}
