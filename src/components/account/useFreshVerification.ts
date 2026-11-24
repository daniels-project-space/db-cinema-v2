"use client";
import { useEffect, useState } from "react";

export function useFreshVerification(expiresAt:number|null|undefined){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{
      if(timer)clearTimeout(timer);
      timer=undefined;
      const current=Date.now();
      setNow(current);
      const remaining=(expiresAt??0)-current;
      if(remaining>0)timer=setTimeout(refresh,Math.max(1,Math.min(2147483647,remaining)));
    };
    const refreshWhenVisible=()=>{if(document.visibilityState==="visible")refresh();};
    refresh();
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refreshWhenVisible);
    return()=>{
      if(timer)clearTimeout(timer);
      window.removeEventListener("focus",refresh);
      document.removeEventListener("visibilitychange",refreshWhenVisible);
    };
  },[expiresAt]);
  return !!expiresAt&&expiresAt>now;
}
