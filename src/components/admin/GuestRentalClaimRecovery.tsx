"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function GuestRentalClaimRecovery({token,accountId}:{token:string;accountId:string}) {
  const status=useQuery((api as any).guestRentalClaims.reviewStatus,{token,accountId});
  const retry=useMutation((api as any).guestRentalClaims.retryReview);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  if (!status?.needsReview) return null;
  return <section aria-label="Rental account linking" className="rounded-xl border border-amber-200/30 bg-amber-100/[.06] p-3 text-xs text-amber-100">
    <strong>Rental link needs review</strong>
    <p className="mt-1 text-amber-100/70">Check the account and rental records before retrying.</p>
    <button type="button" disabled={busy} className="mt-2 rounded-lg border border-amber-200/30 px-3 py-2 disabled:opacity-50" onClick={async()=>{setBusy(true);setError("");try{await retry({token,accountId});}catch{setError("Could not retry. Check account access and try again.");}finally{setBusy(false);}}}>{busy?"Retrying…":"Retry safely"}</button>
    {error && <p role="alert" className="mt-2">{error}</p>}
  </section>;
}
