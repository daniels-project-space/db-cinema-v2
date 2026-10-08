"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useAction,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {dayMs} from "@/lib/dates";
import type {CartItem} from "../cart/CartProvider";
type Days=Record<string,{available:number;ok:boolean;partial?:boolean}>;
export function useCalendarStock(listingId:string,month:Date,items:Pick<CartItem,"listingId"|"start"|"end"|"pickupTime"|"returnTime">[],marketing:boolean,rangeStart:string|null){
  const key=JSON.stringify({listingId,monthStart:Date.UTC(month.getFullYear(),month.getMonth(),1),items:items.map(i=>({listingId:i.listingId,start:dayMs(i.start),end:dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime}))});
  const live=useQuery(api.availability.forCalendar,marketing?"skip":{...JSON.parse(key),...(rangeStart?{rangeStart:dayMs(rangeStart)}:{})});
  const refresh=useAction(api.sync.refreshCalendarStock);
  const [state,setState]=useState<{key:string;phase:"checking"|"ready"|"error";days?:Days}|null>(null);
  const scope=useRef({key,generation:0});
  const flight=useRef<{key:string;generation:number}|null>(null);
  if(scope.current.key!==key)scope.current={key,generation:scope.current.generation+1};
  const retry=useCallback(async()=>{
    if(marketing||flight.current?.key===key&&flight.current.generation===scope.current.generation)return;
    const generation=++scope.current.generation;
    flight.current={key,generation};
    setState({key,phase:"checking"});
    try{
      const receipt=await refresh(JSON.parse(key));
      if(scope.current.key===key&&scope.current.generation===generation)setState({key,phase:"ready",days:receipt.days});
    }catch{if(scope.current.key===key&&scope.current.generation===generation)setState({key,phase:"error"});}
    finally{if(flight.current?.key===key&&flight.current.generation===generation)flight.current=null;}
  },[key,marketing,refresh]);
  useEffect(()=>{if(marketing)return;void retry();const check=()=>{if(!document.hidden)void retry();};const timer=setInterval(check,60000);window.addEventListener("focus",check);document.addEventListener("visibilitychange",check);return()=>{clearInterval(timer);window.removeEventListener("focus",check);document.removeEventListener("visibilitychange",check);scope.current.generation++;};},[retry,marketing]);
  const current=state?.key===key?state:null;
  const ready=marketing||(current?.phase==="ready"&&!!live);
  const unavailable=new Set<string>();
  if(ready&&!marketing)for(const [day,result]of Object.entries(current?.days??{}))if(!result.ok||!live?.[day]?.ok)unavailable.add(day);
  const partial=new Set<string>();
  if(ready&&!marketing)for(const [day,result]of Object.entries(live??{}))if(result.ok&&result.partial)partial.add(day);
  return {partial,ready,error:!marketing&&current?.phase==="error",unavailable,retry};
}
