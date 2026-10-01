"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
export function ReferralPanel({token}:{token:string}){
 const data=useQuery(api.referrals.mine,{token}),[copied,setCopied]=useState(false);
 if(!data)return null;
 async function copy(){if(!data?.code)return;try{await navigator.clipboard.writeText(data.code);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{setCopied(false);}}
 return <section className="mb-4 rounded-3xl border border-sky-200/15 bg-gradient-to-br from-sky-100/[.06] to-transparent p-5">
  <div className="flex items-center gap-3"><svg viewBox="0 0 48 48" className="h-10 w-10 text-sky-200/70" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="15" cy="15" r="5"/><circle cx="33" cy="15" r="5"/><path d="M4 36c0-14 22-14 22 0M22 36c0-14 22-14 22 0M20 13h8M19 39l5 4 5-4"/></svg><p className="font-mono text-[10px] uppercase tracking-[.22em] text-sky-100/60">Pass the camera on</p></div>
  <h3 className="mt-3 font-display text-2xl text-white">Their first film. Your next one.</h3>
  <p className="mt-2 text-xs leading-6 text-white/50">Give a friend £10 off their first rental. After they complete and return it, earn 40% off your next rental.</p>
  <button onClick={copy} disabled={!data.code} className="mt-4 flex w-full items-center justify-between rounded-xl border border-sky-200/20 bg-sky-100/[.04] p-3 text-xs"><span className="font-mono text-sky-100">{data.code??"Creating your code…"}</span><span className="text-white/50">{copied?"Copied ✓":"Copy"}</span></button>
  {data.reward?<p className="mt-3 text-xs text-amber-100">40% reward ready · expires {new Date(data.reward.expiresAt).toLocaleDateString("en-GB")}. Applied automatically when it is your best saving.</p>:<p className="mt-3 text-xs text-white/40">{data.rewardUsed?"Your one-time reward has been used.":data.rewardGranted?"Your reward has expired.":data.waiting?"Waiting for your friend’s rental to be completed and returned.":"One reward per account · one use · valid three months."}</p>}
  <p className="mt-3 text-[10px] leading-5 text-white/35">Rental charges only. One price benefit per checkout. Normal upfront security and card hold apply to referral offers. No self-referrals.</p>
  <a href="/legal/referrals" className="mt-2 inline-block text-[10px] text-sky-100/55 underline">Referral terms</a>
 </section>;
}
