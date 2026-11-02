"use client";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";

export function VerificationReuseClaim({bookingId}:{bookingId:string}) {
  const account=useAccount(),request=useAction(api.verificationReuseClaims.request);
  const available=useQuery(api.verificationReuseClaimState.available,account.token?{token:account.token,bookingId:bookingId as any}:"skip");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  if(!available)return null;
  if(available==="profile")return <section className="mt-4 rounded-xl border border-white/10 p-4" aria-label="Link verification to account"><h3 className="font-semibold">Link this approved verification</h3><p className="mt-2 text-sm text-white/60">To link this approval, update your account profile so your name and address match the rental verification. Contact the team if your details have changed.</p><a className="mt-3 inline-block text-accent-300" href="/account#profile">Update your profile →</a></section>;
  return <section className="mt-4 rounded-xl border border-white/10 p-4" aria-label="Link verification to account">
    <h3 className="font-semibold">Link this approved verification</h3>
    <p className="mt-2 text-sm text-white/60">Confirm your email to use this approval for eligible future rentals. Its original expiry and document checks still apply.</p>
    <button className="btn-primary mt-3 px-4 py-2" disabled={busy} onClick={async()=>{if(!account.token)return;setBusy(true);setMessage("");try{await request({token:account.token,bookingId:bookingId as any});setMessage("Check your email for a one-time confirmation link.");}catch{setMessage("Could not send the confirmation. Please try again or contact the team.");}finally{setBusy(false);}}}>Send confirmation link</button>
    {message&&<p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
