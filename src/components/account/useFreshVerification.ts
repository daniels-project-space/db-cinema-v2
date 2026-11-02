"use client";
import { useEffect, useState } from "react";

export function useFreshVerification(expiresAt:number|null|undefined){
  const [,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    setNow(Date.now());
    if(!expiresAt)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.max(1,Math.min(2147483647,expiresAt-Date.now())));
    return()=>clearTimeout(timer);
  },[expiresAt]);
  return !!expiresAt&&expiresAt>Date.now();
}
