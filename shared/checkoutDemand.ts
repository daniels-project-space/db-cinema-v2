import { isExcludedAnalyticsEvent } from "./analyticsTraffic";
type Event = {type:string;at:number;sessionId?:string;listingId?:string;title?:string;path?:string;qty?:number};
/** Observed pre-payment drop-off, not an invented payment conversion rate. */
export function checkoutDemand(events: Event[], now: number) {
  const sessions = new Map<string, {at:number;stage:string;redirected:boolean}>();
  const episodes: {at:number;stage:string;redirected:boolean}[]=[];
  const unmet = new Map<string,{listingId:string|null;title:string;requests:number;units:number}>();
  const switches = new Map<string,{listingId:string|null;replacementId:string|null;title:string;count:number;units:number}>();
  const stages: Record<string,string> = {checkout_opened:"Checkout opened",checkout_form_ready:"Details & agreements complete",checkout_start:"Payment requested",checkout_failure:"Payment could not start",payment_redirect:"Handed to payment provider"};
  for (const e of events.filter(e=>e.at<=now&&!isExcludedAnalyticsEvent(e)).sort((a,b)=>a.at-b.at)) {
    if (e.type === "unavailable_request") { const id=e.listingId??e.title??"Unknown equipment", row=unmet.get(id)??{listingId:e.listingId??null,title:e.title??id,requests:0,units:0};row.requests++;row.units+=e.qty??1;unmet.set(id,row); }
    if (e.type === "replacement_selected") { const id=JSON.stringify([e.listingId,e.path]), row=switches.get(id)??{listingId:e.listingId??null,replacementId:e.path??null,title:e.title??"Requested equipment",count:0,units:0};row.count++;row.units+=e.qty??1;switches.set(id,row); }
    if (!e.sessionId) continue;
    const stage = stages[e.type];
    if (stage) {
      let current=sessions.get(e.sessionId);
      if(e.type==="checkout_start"&&!current)continue; // Legacy starts lack the new observed journey.
      if(!current || e.at-current.at>30*60000 || (e.type==="checkout_opened" && current.redirected)){current={at:e.at,stage,redirected:false};episodes.push(current);sessions.set(e.sessionId,current);}
      current.at=e.at;current.stage=stage;current.redirected ||= e.type==="payment_redirect";
    }
  }
  const exits = new Map<string,number>();
  for(const s of episodes)if(!s.redirected && s.at<=now-30*60000)exits.set(s.stage,(exits.get(s.stage)??0)+1);
  return {unavailable:[...unmet.values()].sort((a,b)=>b.requests-a.requests).slice(0,25),replacements:[...switches.values()].sort((a,b)=>b.count-a.count).slice(0,25),
    checkoutSessions:episodes.length,paymentHandoffs:episodes.filter(s=>s.redirected).length,inactiveBeforePayment:[...exits.values()].reduce((n,v)=>n+v,0),exitStages:[...exits]};
}
