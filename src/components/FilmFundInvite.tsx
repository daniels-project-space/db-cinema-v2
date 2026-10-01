"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { FilmFundHeart } from "./FilmFundHeart";
export function FilmFundInvite({compact=false}:{compact?:boolean}) {
 const schedule=useQuery(api.filmFund.schedule,{}),open=schedule?.rounds.find(r=>r.state==="open"&&r.opensAt<=Date.now()&&r.deadline>Date.now());
 const Heading=compact?"h1":"h2";
 const notify=useMutation(api.filmFund.notify);const[email,setEmail]=useState(""),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState("");
 return <section className={`fund-invite ${compact?"fund-invite-page":"section-window px-5 py-20 sm:px-8"}`} aria-labelledby="film-fund-title">
  <div className="fund-shell mx-auto max-w-7xl">
   <div className="fund-hero-grid">
    <div className="fund-hero-copy">
     <p className="fund-eyebrow"><span className="fund-status-dot"/> DB Cinema Film Fund <span className="fund-status">{open?"Applications open":"Coming soon"}</span></p>
     <Heading id="film-fund-title" className="fund-title">For the love<br/>of <em>making films.</em><FilmFundHeart className="fund-title-heart"/></Heading>
     <p className="fund-intro">That story you can’t stop thinking about?<br className="hidden sm:block"/> We want to help you put it on screen.</p>
     <p className="fund-body">We’re giving back to the people who make cinema happen. Twice a year, we’ll put our gear behind two passion projects. You bring the heart. We’ll bring the kit.</p>
     <ul className="fund-quick-perks">
      <li><span>01</span><strong>7 days of gear</strong><small>For the selected project</small></li>
      <li><span>02</span><strong>2 days of gear</strong><small>For the runner-up</small></li>
      <li><span>♡</span><strong>Your vision stays yours</strong><small>A shared producer credit. A community behind you.</small></li>
     </ul>
     <div className="fund-hero-actions"><Link href={compact?"#application":open?"/film-fund#application":"/film-fund"} className="fund-button">{compact?"Prepare your pitch":open?"Start your application":"Meet the Film Fund"}<span aria-hidden>↗</span></Link><span className="fund-small-note">Made for passion.<br/>Backed by DB Cinema.</span></div>
    </div>
    <figure className="fund-crew-frame">
     <div className="fund-photo-wrap"><Image src="/images/film-fund/crew-on-set.webp" alt="A young adult film crew standing proudly together on a small set with a cinema camera, lighting and sound equipment" fill sizes="(max-width: 767px) 90vw, 55vw" priority={compact} className="fund-crew-image"/><div className="fund-photo-shade"/></div>
     <span className="fund-photo-tape" aria-hidden/>
     <div className="fund-photo-note"><FilmFundHeart className="fund-note-heart"/><span>Big dreams.<br/><em>Small sets. All heart.</em></span></div>
     <figcaption>A vision of the sets we want to support.</figcaption>
     <span className="fund-frame-corner" aria-hidden>REC <i/></span>
    </figure>
   </div>
   <div className="fund-signup-strip">
    <div className="fund-signup-heading"><FilmFundHeart className="fund-signup-heart"/><div><h3>Be here for the first take.</h3><p>{open?"Get updates for this and future rounds.":"Get the opening announcement. No entries or payments are open yet."}</p></div></div>
    <form className="fund-signup-form" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setResult("");try{await notify({email,consent});setResult(open?"You’re on the list. Explore the application below.":"You’re on the list. We’ll email when the fund opens.");setEmail("");}catch(e:any){setResult(e.message??"Please try again.");}finally{setBusy(false);}}}>
     <label htmlFor={compact?"fund-email-page":"fund-email-home"} className="sr-only">Email address</label><div className="fund-email-row"><input id={compact?"fund-email-page":"fund-email-home"} type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="Your email address" className="input min-w-0 flex-1"/><button disabled={busy||!consent} className="fund-button fund-notify-button disabled:opacity-40">{busy?"Saving…":"Keep me in the loop"}<span aria-hidden>♡</span></button></div>
     <label className="fund-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Email me about the DB Cinema Film Fund. I can unsubscribe at any time.</span></label><p role="status" className="fund-form-result">{result}</p>
    </form>
   </div>
  </div>
 </section>;
}
