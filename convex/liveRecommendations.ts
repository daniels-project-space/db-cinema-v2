import { query } from "./_generated/server";
import { v } from "convex/values";
import { stockRequest } from "./lib/stockRequest";
import { assertRentalInventory, type RentalInventoryCache } from "./lib/rentalInventory";
import { rentalUnavailable } from "./lib/marketingInventory";
import { listingImages } from "./lib/catalogImages";
import { quote } from "./lib/pricing";
import { verifiedKitEvidence } from "./lib/compatibilityEvidence";
import { effectiveLensSpecs } from "../shared/opticalFacts";
import { automaticRecommendation, rentableCandidate } from "../shared/recommendationPolicy";
import { RENTAL_TIME_SLOTS } from "../shared/rentalWindow";

const group = v.object({ key: v.string(), types: v.optional(v.array(v.string())), listingId: v.optional(v.id("listings")),
  start: v.optional(v.number()), end: v.optional(v.number()), pickupTime: v.optional(v.string()), returnTime: v.optional(v.string()),
  replaceListingId: v.optional(v.id("listings")) });
const MULTI = new Set(["lens", "light", "nd-filter", "battery", "wireless-mic"]);
const DAY = 86400000;
const describe = (l: any) => ({ _id:l._id, listingId:l._id, slug:l.slug, title:l.title, itemType:l.itemType??"accessory", category:l.category,
  specs:effectiveLensSpecs(l), mount:effectiveLensSpecs(l)?.mount??null, components:l.components??[], inventoryFacts:l.inventoryFacts??null,
  rentalContents:l.rentalContents?{included:l.rentalContents.included}:null, pricing:l.pricing, depositAmount:l.depositAmount,
  heroImage:listingImages(l)[0]??null, image:listingImages(l)[0]??null, imageSources:listingImages(l),
  role:l.itemType==="camera-body"?"camera":l.itemType==="lens"?"lens":"other", demandScore:l.demandScore??0,
  bookable:!rentalUnavailable(l)&&rentableCandidate(l), marketingOnly:!!l.marketingOnly, displayOnly:!!l.suppressed, quietDeal:l.quietDeal??null });

/** One reactive read for the visible choices. Indexed type/physical-pool reads
 * subscribe to listings, quantities, bookings and shared stock imports. The
 * current owned catalogue is 405 offers; at most 16 type groups/100 basket lines,
 * 36 cards per group, and one query-local inventory cache. No provider/model calls. */
export const options = query({
  args: { groups:v.array(group), basket:v.array(stockRequest), selectedIds:v.optional(v.array(v.id("listings"))), refresh:v.optional(v.number()) },
  handler:async(ctx,{groups,basket,selectedIds=[]})=>{
    if(groups.length>16||basket.length+selectedIds.length>100||new Set(groups.map(g=>g.key)).size!==groups.length)throw Error("Too many recommendation choices");
    const records=new Map<string,any>();
    for(const id of new Set([...basket.map(i=>String(i.listingId)),...selectedIds.map(String),...groups.flatMap(g=>g.listingId?[String(g.listingId)]:[])]))records.set(id,await ctx.db.get(id as any));
    const typeCache=new Map<string,any[]>();
    const evidence=await verifiedKitEvidence(ctx);
    const cache:RentalInventoryCache={records:new Map(records),reservations:new Map<string,any[]>()};
    const basketRecords=basket.map(line=>records.get(String(line.listingId))).filter(Boolean);
    const selection=selectedIds.map(id=>records.get(String(id))).filter(Boolean);
    const validWindow=(g:typeof groups[number])=>Number.isSafeInteger(g.start)&&Number.isSafeInteger(g.end)&&g.start!%DAY===0&&g.end!%DAY===0&&g.end!>=g.start!&&g.end!-g.start!<=365*DAY&&
      RENTAL_TIME_SLOTS.includes(g.pickupTime as any)&&RENTAL_TIME_SLOTS.includes(g.returnTime as any)&&(g.start!==g.end||g.returnTime!>g.pickupTime!);
    const result:Record<string,any>={};
    for(const g of groups){
      if([g.start,g.end].some(value=>value!==undefined&&(!Number.isSafeInteger(value)||value%DAY!==0||!Number.isFinite(new Date(value).getTime()))))throw Error("Invalid recommendation dates");
      const preferred=g.listingId?records.get(String(g.listingId)):null;
      const types=[...new Set(g.types??(preferred?[preferred.itemType??"accessory"]:[]))];
      if(types.length>16||types.some(t=>!/^[a-z-]{1,40}$/.test(t)))throw Error("Invalid recommendation type");
      const candidates=new Map<string,any>();
      for(const type of types){
        if(!typeCache.has(type))typeCache.set(type,await ctx.db.query("listings").withIndex("by_active_itemType",q=>q.eq("active",true).eq("itemType",type as any)).collect());
        for(const l of typeCache.get(type)!)if(!rentalUnavailable(l)&&rentableCandidate(l))candidates.set(String(l._id),l);
      }
      if(preferred)candidates.set(String(preferred._id),preferred);
      for(const l of selection)if(types.includes(l.itemType??"accessory"))candidates.set(String(l._id),l);
      const ready=validWindow(g),days=Number.isSafeInteger(g.start)&&Number.isSafeInteger(g.end)&&g.end!>=g.start!?Math.round((g.end!-g.start!)/DAY)+1:1;
      const selectedFor=(candidate:any)=>selection.filter(l=>l._id!==candidate._id&&(MULTI.has(candidate.itemType)||l.itemType!==candidate.itemType));
      const retainedBasket=basket.filter(line=>line.listingId!==g.replaceListingId);
      const contextBasket=basketRecords.filter(l=>l._id!==g.replaceListingId);
      const options=[];
      for(const l of candidates.values()){
        cache.records.set(String(l._id),l);
        const chosen=selectedFor(l),context=[...contextBasket,...chosen];
        let available:boolean|null=null;
        if(rentalUnavailable(l)||!rentableCandidate(l))available=false;
        else if(ready){
          const units=new Set((l.components??[]).map((c:any)=>String(c.inventoryUnitId)));
          const retained=retainedBasket.filter(line=>records.get(String(line.listingId))?.components?.some((c:any)=>units.has(String(c.inventoryUnitId))));
          const other=chosen.filter(r=>(r.components??[]).some((c:any)=>units.has(String(c.inventoryUnitId)))).map(r=>({listingId:r._id,start:g.start!,end:g.end!,pickupTime:g.pickupTime,returnTime:g.returnTime,qty:1}));
          try{await assertRentalInventory(ctx,[...retained.map(line=>({...line,qty:line.qty??1})),...other,{listingId:l._id,start:g.start!,end:g.end!,pickupTime:g.pickupTime,returnTime:g.returnTime,qty:1}],undefined,cache);available=days>=(l.minimumRentalDays??1);}catch{available=false;}
        }
        const price=quote(l.pricing,days),total=l.quietDeal?Math.round(price.total*(1-l.quietDeal/100)):price.total;
        options.push({...describe(l),available,needsTimes:!ready,automaticEligible:!rentalUnavailable(l)&&automaticRecommendation(l,context,evidence),
          start:g.start===undefined?null:new Date(g.start).toISOString().slice(0,10),end:g.end===undefined?null:new Date(g.end).toISOString().slice(0,10),
          pickupTime:g.pickupTime??null,returnTime:g.returnTime??null,days,perDay:Math.round(total/days*100)/100,total,deposit:l.depositAmount??0});
      }
      options.sort((a,b)=>Number(b.available===true&&b.automaticEligible)-Number(a.available===true&&a.automaticEligible)||Number(b.automaticEligible)-Number(a.automaticEligible)||b.demandScore-a.demandScore||a.total-b.total||String(a._id).localeCompare(String(b._id)));
      result[g.key]={options:options.slice(0,36),selection:options.filter(o=>selectedIds.includes(o._id)),preferred:options.find(o=>o._id===g.listingId)??null,ready};
    }
    let selectionOk:boolean|null=selection.length===0?true:null;
    const window=groups.find(validWindow);
    if(window&&selection.length){try{await assertRentalInventory(ctx,[...basket.map(line=>({...line,qty:line.qty??1})),...selection.map(l=>({listingId:l._id,start:window.start!,end:window.end!,pickupTime:window.pickupTime,returnTime:window.returnTime,qty:1}))],undefined,cache);selectionOk=true;}catch{selectionOk=false;}}
    // Wall-clock expiry alone does not invalidate a reactive query. Tell the
    // visible client exactly when an expiring hold needs a fresh evaluation.
    let nextRefreshAt=Date.now()+5*60000;
    for(const rows of cache.reservations.values())for(const row of rows)if(row.status==="hold"&&row.holdExpiresAt>Date.now())nextRefreshAt=Math.min(nextRefreshAt,row.holdExpiresAt+50);
    const stockState=await ctx.db.query("rmv2_sync_state").withIndex("by_key",q=>q.eq("key","shared-stock-v1")).first();
    try{const checkedAt=JSON.parse(stockState?.cursor??"null")?.checkedAt,precise=cache.precision?await cache.precision:false;if(Number.isSafeInteger(checkedAt)&&(checkedAt+5*60000>Date.now()||precise))nextRefreshAt=Math.min(nextRefreshAt,checkedAt+5*60000+50);}catch{}
    return {groups:result,basket:basketRecords.map(describe),selected:selection.map(describe),compatibilityKits:evidence,selectionOk,nextRefreshAt};
  },
});
