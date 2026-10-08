"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useAction,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {dayMs} from "@/lib/dates";
import type {CartItem} from "./CartProvider";

type Availability=Record<string,{available:number;demanded:number;ok:boolean}>;
type Receipt={checkedAt:number;availability:Availability};
type State={key:string;phase:"checking"|"ready"|"error";receipt:Receipt|null};
export function useCartStockCheck(items:Pick<CartItem,"listingId"|"start"|"end">[]) {
  const key=JSON.stringify(items.map(i=>({listingId:i.listingId,start:dayMs(i.start),end:dayMs(i.end)})));
  const refresh=useAction(api.sync.refreshCartStock);
  const live=useQuery(api.availability.forCart,items.length?{items:JSON.parse(key)}:"skip");
  const [state,setState]=useState<State|null>(null);
  const scope=useRef({key,request:0});
  const flight=useRef<{key:string;request:number;promise:Promise<Receipt|null>}|null>(null);
  if(scope.current.key!==key){scope.current={key,request:scope.current.request+1};flight.current=null;}
  const recheck=useCallback(async():Promise<Receipt|null>=>{
    if(key==="[]")return null;
    if(flight.current?.key===key&&flight.current.request===scope.current.request)return flight.current.promise;
    const request=++scope.current.request;
    const current=()=>scope.current.key===key&&scope.current.request===request;
    setState(previous=>({key,phase:"checking",receipt:previous?.key===key?previous.receipt:null}));
    const promise=(async()=>{
      try {
        const receipt=await refresh({items:JSON.parse(key)});
        if(!Number.isSafeInteger(receipt?.checkedAt)||receipt.checkedAt<1||!receipt.availability||typeof receipt.availability!=="object"||Array.isArray(receipt.availability))throw Error("Invalid availability receipt");
        if(!current())return null;
        setState({key,phase:"ready",receipt});return receipt;
      } catch {
        if(current())setState({key,phase:"error",receipt:null});return null;
      } finally {if(current())flight.current=null;}
    })();
    flight.current={key,request,promise};return promise;
  },[key,refresh]);
  useEffect(()=>{
    if(key==="[]")return;
    const check=()=>{if(!document.hidden)void recheck();};
    check();const timer=setInterval(check,60000);
    window.addEventListener("focus",check);document.addEventListener("visibilitychange",check);
    return()=>{clearInterval(timer);window.removeEventListener("focus",check);document.removeEventListener("visibilitychange",check);scope.current.request++;flight.current=null;};
  },[key,recheck]);
  const current=state?.key===key?state:null;
  const availability:Availability|undefined=current?.receipt&&live?Object.fromEntries(Object.entries(current.receipt.availability).map(([id,value])=>[id,{...value,available:Math.min(value.available,live[id]?.available??0),ok:value.ok&&live[id]?.ok===true}])):undefined;
  return {availability,recheck,ready:!items.length||(current?.phase==="ready"&&!!availability),checking:!!items.length&&(!current||current.phase==="checking"),error:current?.phase==="error"};
}
