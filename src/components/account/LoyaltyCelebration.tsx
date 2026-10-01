"use client";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import s from "./LoyaltyCelebration.module.css";

/** Original lens/film crest, drawn in the browser rather than a stock badge. */
export function EncoreCrest({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 200 200" fill="none" aria-hidden="true">
    <g className={s.draw} stroke="currentColor" strokeWidth="1.3">
      <circle cx="100" cy="100" r="87"/><circle cx="100" cy="100" r="76" strokeDasharray="1 8"/>
      <path d="M47 151C19 123 24 75 52 52M153 151c28-28 23-76-5-99"/>
      {[0,1,2,3,4].map(n=><g key={n} transform={`rotate(${n*14} 100 100)`}><path d="M37 120q-14-8-12-19 14 1 17 12M163 120q14-8 12-19-14 1-17 12"/></g>)}
      <path d="M74 28h52M82 172h36M100 9v9M9 100h9M182 100h9M100 182v9"/>
    </g>
    <g className={s.iris} stroke="currentColor" strokeWidth="1.4">
      <circle cx="100" cy="100" r="51"/>
      {[0,1,2,3,4,5].map(n=><path key={n} transform={`rotate(${n*60} 100 100)`} d="M100 49l32 54-17 29"/>)}
      <circle cx="100" cy="100" r="24" fill="#111820"/>
      <path d="M91 88v24m9-24v24m9-24v24" strokeWidth="2.5"/>
    </g>
    <path d="M100 19l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="currentColor"/>
    <path d="M100 162l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="currentColor"/>
  </svg>;
}

export function LoyaltyCelebration({ subscriptionActive, onAcknowledge }: {
  subscriptionActive: boolean; onAcknowledge: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const [mounted,setMounted]=useState(false);
  useEffect(()=>setMounted(true),[]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{
    if(!mounted)return;
    const before=document.activeElement as HTMLElement|null, scroll=document.body.style.overflow;
    document.body.style.overflow="hidden";dialog.current?.focus();
    const keys=(e:KeyboardEvent)=>{if(e.key==="Tab"){e.preventDefault();button.current?.focus();}if(e.key==="Escape")button.current?.click();};
    document.addEventListener("keydown",keys);
    return()=>{document.body.style.overflow=scroll;document.removeEventListener("keydown",keys);before?.focus();};
  },[mounted]);
  async function acknowledge(){setBusy(true);setError(false);try{await onAcknowledge();}catch{setError(true);setBusy(false);}}
  if(!mounted)return null;
  return createPortal(<div className={s.veil} data-testid="encore-unlock">
    <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="encore-title" ref={dialog} tabIndex={-1}>
      {Array.from({length:18},(_,i)=><span key={i} className={s.spark} style={{"--angle":`${i*20}deg`} as CSSProperties}/>)}
      <EncoreCrest className={s.crest}/>
      <p className={s.label}>Three shoots. A lasting connection.</p>
      <h2 id="encore-title" className={`${s.title} font-display`}>Encore.</h2>
      <div className={s.rule}/>
      <p className={s.copy}>You came back. You made something.<br/>Now every next story gets a little more room.</p>
      <p className={`${s.saving} mt-6`}>10% <span className="text-lg font-normal">off rentals</span></p>
      <p className={`${s.copy} mt-3`}>{subscriptionActive ? "Your Encore tier is unlocked. Subscription perks take priority; your 10% rental saving is ready whenever you rent without a subscription." : "Your Encore tier is unlocked. Your rental saving applies automatically on future orders. No subscription needed."}</p>
      <p className={`${s.copy} mt-2 text-xs`}>Rental charges only · delivery and security excluded.<br/>Does not stack with subscription benefits.</p>
      {error&&<p role="alert" className="mt-3 text-xs text-red-200">Couldn’t save your acknowledgement. Please try again.</p>}
      <button ref={button} className={s.button} disabled={busy} onClick={acknowledge}>{busy?"Saving…":"Here’s to your next film →"}</button>
    </div>
  </div>,document.body);
}
