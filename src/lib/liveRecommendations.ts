import { alreadySupplied } from "../../shared/recommendationPolicy";
import { rentalDateLabel } from "../../shared/rentalDateLabel";

export function stockLines(items:any[]){return items.map(i=>({listingId:i.listingId,start:Date.parse(rentalDateLabel(i.start)+"T00:00:00Z"),end:Date.parse(rentalDateLabel(i.end)+"T00:00:00Z"),pickupTime:i.pickupTime||undefined,returnTime:i.returnTime||undefined,qty:1}));}
export function liveWindow(item:any,basket:any[]=[]){
  const first=basket[0];
  const same=first&&basket.every(i=>i.start===first.start&&i.end===first.end&&i.pickupTime===first.pickupTime&&i.returnTime===first.returnTime);
  const source=item.followBasketWindow&&same?first:item;
  // An AI placeholder is not a chosen hire period, even if clocks were given.
  const start=Date.parse((source?.estimated?undefined:rentalDateLabel(source?.start))+"T00:00:00Z"),end=Date.parse((source?.estimated?undefined:rentalDateLabel(source?.end))+"T00:00:00Z");
  return {start:Number.isFinite(start)?start:undefined,end:Number.isFinite(end)?end:undefined,pickupTime:source?.pickupTime||undefined,returnTime:source?.returnTime||undefined};
}

function completeDateOnlyWindow(item:any) {
  if (item?.estimated || typeof item?.start !== "string" || typeof item?.end !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.start) || !/^\d{4}-\d{2}-\d{2}$/.test(item.end)) return false;
  const start = Date.parse(`${item.start}T00:00:00.000Z`), end = Date.parse(`${item.end}T00:00:00.000Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start &&
    new Date(start).toISOString().slice(0, 10) === item.start && new Date(end).toISOString().slice(0, 10) === item.end;
}

/** Refresh a past suggestion without silently changing what the shopper adds.
 * Alternatives are separate cards and each requires its own click. */
export function liveChatChoices(card:any,group:any,snapshot:any){
  const original=card.kind==="swap"?card.added:card.item;
  if(!original)return [];
  if(!group)return [{...card,refreshing:true,item:{...original,available:false},added:card.kind==="swap"?{...original,available:false}:undefined}];
  const preferred=group.preferred;
  const eligible=preferred?.automaticEligible===true;
  const requestCompatible=preferred?.requestCompatible===true;
  const actuallyAvailable=preferred?.available===true;
  const canAddWithCheckoutTimeCheck=card.kind!=="swap"&&!group.ready&&preferred?.available===null&&eligible&&requestCompatible&&
    !original.pickupTime&&!original.returnTime&&!preferred?.pickupTime&&!preferred?.returnTime&&completeDateOnlyWindow(preferred);
  const current={...original,...preferred,estimated:group.ready?false:original.estimated,memberTotal:undefined,memberPct:undefined,available:actuallyAvailable&&eligible,requestable:group.ready&&requestCompatible&&!actuallyAvailable,needsTimes:!group.ready&&!canAddWithCheckoutTimeCheck,checkoutTimeCheckPending:canAddWithCheckoutTimeCheck};
  const already=preferred&&alreadySupplied(preferred,snapshot.basket??[]);
  const reason=already?"Already supplied by your basket.":canAddWithCheckoutTimeCheck?"Add this dated option now. Exact times and the live stock check happen at checkout.":!group.ready?"Choose rental dates first. Exact pickup and return times are selected at checkout.":!requestCompatible?"Your basket changed. Check this combination or choose a matching alternative below.":!actuallyAvailable?"Unavailable for this rental window. Add it as a request or choose an available alternative.":!eligible?"This choice needs another stock or fit check.":"Stock, price and supplied kit contents rechecked.";
  const first=card.kind==="swap"?{...card,added:current,reason}:{...card,item:current,reason};
  if(already)return [{...first,alreadyIncluded:true}];
  const used:any[]=preferred?.available===true&&preferred?.automaticEligible?[preferred]:[];
  const alternatives=(group.options??[]).filter((option:any)=>{
    if(option._id===original.listingId||option.available!==true||!option.automaticEligible)return false;
    // Eligibility against the complete kit was computed from authoritative
    // records on the server; this second check only deduplicates alternatives.
    if(alreadySupplied(option,used))return false;used.push(option);return true;
  }).slice(0,2).map((option:any)=>({kind:"add",item:{...option,followBasketWindow:original.followBasketWindow},reason:"Available alternative for your current kit and rental times."}));
  return [first,...alternatives];
}
