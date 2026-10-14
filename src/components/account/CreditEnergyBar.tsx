"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useCreditBalance} from "./useCreditBalance";
import {formatGbp} from "@/lib/pricing";
import styles from "./CreditEnergyBar.module.css";
export function CreditEnergyBar({token,accountId,compact=false}:{token:string;accountId:string;compact?:boolean}){
 const balance=useCreditBalance(token);
 const [pulse,setPulse]=useState<{id:number;added:number|null}|null>(null);
 useEffect(()=>{
  if(compact!==window.matchMedia("(max-width:767px)").matches)return;
  const issue=balance?.recentIssue;if(!issue||balance.accountId!==accountId)return;
  const key="dbc_credit_seen:"+accountId;
  try{const seen=localStorage.getItem(key);localStorage.setItem(key,String(issue.id));if(seen!==String(issue.id)&&Date.now()-issue.createdAt<7*86400000)setPulse({id:Date.now(),added:issue.amount});}catch{}
 },[balance?.recentIssue?.id,accountId,compact]);
 useEffect(()=>{const onSelected=(event:Event)=>{if((event as CustomEvent).detail?.accountId===accountId)setPulse({id:Date.now(),added:null});};window.addEventListener("dbc:credit:selected",onSelected);return()=>window.removeEventListener("dbc:credit:selected",onSelected)},[accountId]);
 useEffect(()=>{if(!pulse)return;const timer=setTimeout(()=>setPulse(null),2600);return()=>clearTimeout(timer)},[pulse?.id]);
 if(!balance||balance.accountId!==accountId||balance.available<=0&&pulse?.added==null)return null;
 return <Link href="/account#credits" onClick={()=>window.dispatchEvent(new Event("dbc:open-account-credit"))} aria-label={`${formatGbp(balance.available)} account credit available`} title={`${formatGbp(balance.available)} available account credit`} className={`${styles.bar} ${compact?styles.compact:""}`} data-testid="account-credit-energy" data-pulse={!!pulse}>
  <span className={styles.value}>{formatGbp(balance.available)}{!compact&&<small>credit</small>}</span><span className={styles.track}><span key={pulse?.id??"balance"} className={styles.fill}/></span>{pulse?.added!=null&&!compact&&<span className={styles.added} role="status">+{formatGbp(pulse.added)}</span>}
 </Link>;
}
