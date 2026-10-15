"use client";
import {useEffect,useState} from "react";
import {useConvex,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
/** A distinct refresh key bypasses an already subscribed cached result.
 * Financial checks use the server clock; refreshAt is never an expiry input. This also refreshes a visible wallet
 * at its next expiry, because a reactive query alone is not a ticking clock. */
export function useCreditBalance(token:string|null){
 const client=useConvex(),live=useQuery(api.accountCredits.balance,token?{token}:"skip");
 const key=JSON.stringify([token,live]);
 const [read,setRead]=useState<{key:string;value:typeof live}|null>(null);
 const balance=read?.key===key?read.value:live;
 useEffect(()=>{
  if(!token||!balance?.nextExpiry)return;
  let alive=true;
  const expiry=balance.nextExpiry;
  const refresh=async()=>{if(Date.now()<expiry)return;try{const value=await client.query(api.accountCredits.balance,{token,refreshAt:Date.now()});if(alive)setRead({key,value});}catch{if(alive)setRead({key,value:undefined});}};
  let timer:ReturnType<typeof setTimeout>;
  const schedule=()=>{timer=setTimeout(()=>{if(Date.now()<expiry)schedule();else void refresh()},Math.min(2147483647,Math.max(1,expiry-Date.now()+1)))};schedule();
  const visible=()=>{if(document.visibilityState==="visible")void refresh()};document.addEventListener("visibilitychange",visible);
  return()=>{alive=false;clearTimeout(timer);document.removeEventListener("visibilitychange",visible)};
 },[token,key,balance?.nextExpiry,client]);
 return balance;
}
