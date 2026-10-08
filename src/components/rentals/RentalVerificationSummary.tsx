"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { VerificationBar } from "./VerificationProgress";
import { useVerificationRefresh } from "./useVerificationRefresh";
import { rentalStageLabel } from "../../../shared/rentalReadiness";

const checks = {identity:"Photo ID",selfie:"Selfie & face match",address:"Proof of address"};
const labels: Record<string,string> = {waiting:"Waiting for documents",processing:"Checking",approved:"Passed",review:"Under review",requires_input:"Upload needed",rejected:"Needs attention"};
export function RentalVerificationSummary({bookingId,token,admin=false}:{bookingId:string;token:string;admin?:boolean}) {
  const owner = useQuery(api.rentalOperations.details, admin ? {token,bookingId:bookingId as any} : "skip");
  const renter = useQuery(api.bookings.verificationProgress, admin ? "skip" : {token,bookingId:bookingId as any});
  const b = admin ? owner : renter;
  const refreshError = useVerificationRefresh(bookingId,token,undefined,admin,!!b && ["confirmed","active"].includes(b.status) && b.idVerifyStatus !== "verified");
  if (!b || !["confirmed","active"].includes(b.status)) return null;
  return <section aria-label="Rental verification progress" className="mt-4 rounded-2xl border border-accent-400/20 bg-[#151515] p-4">
    <p className="mb-3 text-sm font-medium text-accent-300">{rentalStageLabel(b)}</p>
    <VerificationBar booking={b}/>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(checks).map(([key,label])=>{
      const state = b.verificationChecks?.[key as "identity"|"selfie"|"address"] ?? (b.idVerifyStatus === "verified" ? "approved" : "waiting");
      return <div key={key} className="rounded-xl border border-white/10 p-3"><p className="text-xs text-white/55">{label}</p><p className={`mt-1 text-xs ${state === "approved" ? "text-accent-300" : "text-white/85"}`}>{labels[state] ?? "Checking"}</p></div>;
    })}</div>
    <p className="mt-3 text-xs leading-5 text-white/55">Payment reserves the kit. The required identity, face match and address checks must pass before approval and handover.</p>
    {admin && owner?.accountId && <p className="mt-2 text-xs text-white/45">Linked to the customer's account · documents remain with this rental.</p>}
    {b.verificationUpdatedAt && <p className="mt-2 text-[11px] text-white/40">Last verification update: {new Date(b.verificationUpdatedAt).toLocaleString("en-GB",{timeZone:"Europe/London"})} London time</p>}
    {refreshError && <p role="status" className="mt-2 text-xs text-amber-200">Didit progress could not be refreshed. The last confirmed result is shown; retrying automatically.</p>}
    {!admin && <Link href={`/account/verification/${bookingId}`} className="mt-3 inline-block text-xs text-accent-300 hover:underline">Open verification and uploads ↗</Link>}
  </section>;
}
