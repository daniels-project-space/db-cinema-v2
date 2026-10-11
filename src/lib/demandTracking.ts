import { getSessionId } from "./session";
import { isExcludedAnalyticsEvent } from "../../shared/analyticsTraffic";

type Track = (event: {type:string;sessionId?:string;listingId?:string;title?:string;path?:string;qty?:number}) => Promise<unknown>;
const pending = new Set<string>();
const seen = new Map<string, number>();
/** One verified unavailable request per equipment/window/quantity per browser day. */
export async function recordUnavailableDemand(track: Track, item: {listingId:string;title?:string;start:string;end:string;pickupTime?:string;returnTime?:string}, qty: number) {
  const sessionId = getSessionId();
  if (isExcludedAnalyticsEvent({sessionId})) return;
  const key = JSON.stringify([item.listingId,item.start,item.end,item.pickupTime,item.returnTime,qty]);
  const now = Date.now();
  try { for (const [k,at] of JSON.parse(sessionStorage.getItem("dbc_demand_seen_v1") ?? "[]")) if(typeof k==="string" && typeof at==="number" && at>now-86400000)seen.set(k,at); } catch { /* Storage unavailable or corrupt. */ }
  if (pending.has(key) || (seen.get(key) ?? 0) > now - 86400000) return;
  pending.add(key);
  try {
    await track({type:"unavailable_request",sessionId,listingId:item.listingId,title:item.title,path:"/cart",qty});
    seen.set(key,now);
    for (const [k,at] of seen) if(at<=now-86400000)seen.delete(k);
    while(seen.size>100)seen.delete(seen.keys().next().value!);
    try {sessionStorage.setItem("dbc_demand_seen_v1",JSON.stringify([...seen]));}catch { /* Keep memory deduplication. */ }
  } finally {pending.delete(key);}
}

export function recordReplacement(track: Track, source: {listingId:string;title:string}, replacements: {listingId:string}[]) {
  const sessionId=getSessionId();
  if(isExcludedAnalyticsEvent({sessionId}))return;
  const counts=new Map<string,number>();for(const r of replacements)counts.set(r.listingId,(counts.get(r.listingId)??0)+1);
  for(const [id,qty] of counts)void track({type:"replacement_selected",sessionId,listingId:source.listingId,title:source.title,path:id,qty}).catch(()=>{});
}
