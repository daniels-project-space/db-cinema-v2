"use client";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@cvx/_generated/api";
import { VerificationBar } from "./VerificationProgress";
import { useVerificationRefresh } from "./useVerificationRefresh";
import { rentalStageLabel } from "../../../shared/rentalReadiness";
import { verificationBookingOpen } from "../../../shared/verificationProgress";

const checks = {identity:"Photo ID",selfie:"Selfie & face match",address:"Proof of address"};
const labels: Record<string,string> = {waiting:"Waiting for documents",processing:"Checking",approved:"Passed",review:"Under review",requires_input:"Upload needed",rejected:"Needs attention",unknown:"Not recorded"};
export function RentalVerificationSummary({bookingId,token,admin=false}:{bookingId:string;token:string;admin?:boolean}) {
  const owner = useQuery(api.rentalOperations.details, admin ? {token,bookingId:bookingId as any} : "skip");
  const renter = useQuery(api.bookings.verificationProgress, admin ? "skip" : {token,bookingId:bookingId as any});
  const b = admin ? owner : renter;
  const refresh = useAction(api.didit.refreshProgress);
  const [checking,setChecking] = useState(false);
  const [refreshMessage,setRefreshMessage] = useState("");
  const refreshError = useVerificationRefresh(bookingId,token,undefined,admin,!!b && verificationBookingOpen(b.status) && b.idVerifyStatus !== "verified");
  if (!b || !verificationBookingOpen(b.status)) return null;
  return <section aria-label="Rental verification progress" className="mt-4 rounded-2xl border border-accent-400/20 bg-[#151515] p-4">
    <p className="mb-3 text-sm font-medium text-accent-300">{rentalStageLabel(b)}</p>
    <VerificationBar booking={b}/>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(checks).map(([key,label])=>{
      const state = b.verificationChecks?.[key as "identity"|"selfie"|"address"] ?? (b.idVerifyStatus === "required" ? "waiting" : "unknown");
      return <div key={key} className="rounded-xl border border-white/10 p-3"><p className="text-xs text-white/55">{label}</p><p className={`mt-1 text-xs ${state === "approved" ? "text-accent-300" : "text-white/85"}`}>{labels[state] ?? "Checking"}</p></div>;
    })}</div>
    <p className="mt-3 text-xs leading-5 text-white/55">Payment reserves the kit, but approval requires all three checks before handover.</p>
    {admin && owner?.accountId && <p className="mt-2 text-xs text-white/45">Linked to the customer's account · documents remain with this rental.</p>}
    {admin && owner?.verificationProvider === "didit" && owner.idVerifyStatus === "manual_review" && <div className="mt-3 overflow-hidden rounded-xl border border-[#d4a86b]/30 bg-gradient-to-br from-[#3a2b1c]/60 to-[#1c1a18] text-xs leading-5 shadow-[0_10px_28px_#0003]"><div className="flex items-start gap-3 border-b border-white/10 p-3"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e4b77d]/25 bg-[#e4b77d]/10 text-[#e8bb84]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><path d="M12 3 4.5 6v5.5c0 4.4 2.8 7.7 7.5 9.5 4.7-1.8 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="M12 8v4m0 3h.01"/></svg></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#ddb178]">Provider decision</p><p className="mt-1 text-sm font-semibold text-[#f7ebdc]">Verification needs review</p><p className="mt-1 text-[#d7c5ae]">Check the provider decision.</p></div></div><div className="space-y-3 p-3 text-[#decdb9]">{owner.verificationNote && <p className="break-words rounded-lg border border-white/10 bg-black/15 p-3" role="status">{owner.verificationNote}</p>}<div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#bfa588]">Search in Didit by session</p><p className="mt-1 break-all font-mono text-[#f0e2d1]">{owner.diditSessionId || "Session unavailable"}</p></div><p className="text-[#c6b5a1]">Resolve in Didit, then refresh here. Do not approve until Didit confirms it.</p><div className="flex flex-wrap gap-2"><a href="https://business.didit.me" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-[#d5a474]/35 px-3 font-semibold text-[#edc89f]">Open Didit Business Console ↗</a><button type="button" disabled={checking} className="min-h-11 rounded-lg bg-[#c89b6d] px-3 font-semibold text-[#21170e] disabled:opacity-50" onClick={async()=>{setChecking(true);setRefreshMessage("");try{const result=await refresh({bookingId:bookingId as any,accountToken:token,admin:true});setRefreshMessage(result.status === "updated" ? "The latest Didit decision was recorded. Check the updated rental status." : result.status === "unchanged" ? "No update recorded. If a check is already in progress, try again shortly." : "This verification is no longer available for refresh. Check the rental status.");}catch{setRefreshMessage("The refresh could not be confirmed. Check the latest rental status and Didit before retrying.");}finally{setChecking(false);}}}>{checking?"Checking Didit…":"Refresh Didit decision"}</button></div>{refreshMessage&&<p role="status">{refreshMessage}</p>}</div></div>}
    {b.verificationUpdatedAt && <p className="mt-2 text-[11px] text-white/40">Last verification update: {new Date(b.verificationUpdatedAt).toLocaleString("en-GB",{timeZone:"Europe/London"})} London time</p>}
    {refreshError && <p role="status" className="mt-2 text-xs text-amber-200">Didit progress could not be refreshed. The last confirmed result is shown; retrying automatically.</p>}
    {!admin && <Link href={`/account/verification/${bookingId}`} className="mt-3 inline-block text-xs text-accent-300 hover:underline">Open verification and uploads ↗</Link>}
  </section>;
}
