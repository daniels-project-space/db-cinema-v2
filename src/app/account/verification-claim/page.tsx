"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";

export default function VerificationClaimPage() {
  const account=useAccount(),redeem=useAction(api.verificationReuseClaims.redeem),started=useRef(false);
  const [message,setMessage]=useState("Checking your confirmation…");
  useEffect(()=>{
    if(account.loading||started.current)return;
    if(!account.token){setMessage("Sign in to the same account, then open the link in your email again.");return;}
    const secret=window.location.hash.slice(1);
    if(!secret){setMessage("This confirmation link is missing. Request a new one from your rental.");return;}
    started.current=true;window.history.replaceState(null,"","/account/verification-claim");
    void redeem({token:account.token,secret}).then(()=>setMessage("Your approved verification is linked to your account for eligible rentals."))
      .catch(()=>setMessage("This confirmation could not be completed. Request a new link or contact the team."));
  },[account.loading,account.token,redeem]);
  return <main className="mx-auto max-w-xl px-6 py-24"><h1 className="font-display text-3xl">Verification confirmation</h1><p role="status" className="mt-5 text-sm text-white/60">{message}</p><Link href="/account" className="mt-5 inline-block text-accent-300">Go to my account →</Link></main>;
}
