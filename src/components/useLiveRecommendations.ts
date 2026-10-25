"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

/** Database writes refresh immediately through Convex. An exact expiry wake
 * covers time-only hold changes; hidden tabs sleep and refresh on return. */
export function useLiveRecommendations(args:any|null){
  const [refresh,setRefresh]=useState(0),lastWake=useRef(0);
  const result:any=useQuery(api.liveRecommendations.options,args?{...args,refresh}:"skip");
  const enabled=!!args,nextRefreshAt=result?.nextRefreshAt;
  useEffect(()=>{
    if(!enabled)return;
    const wake=()=>{const now=Date.now();if(!document.hidden&&now-lastWake.current>1000){lastWake.current=now;setRefresh(now);}};
    const timer=setTimeout(wake,Math.max(1000,(nextRefreshAt??Date.now()+5*60000)-Date.now()));
    window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return()=>{clearTimeout(timer);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[enabled,nextRefreshAt]);
  return result;
}
