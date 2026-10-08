import { stockRequest, stockRequestFields } from "./lib/stockRequest";
import { stockTimePrecision, stockWindow, capacityBands, intersectCapacity, windowCapacity, rentalSlots, type CapacityBand } from "./lib/stockWindows";
import { rentalWindow, RENTAL_TIME_SLOTS } from "../shared/rentalWindow";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { rentalUnavailable } from "./lib/marketingInventory";
import { reservationOccupancy } from "./lib/reservationOccupancy";
import { inventoryCapacity } from "./lib/inventoryCapacity";

const DAY = 86400000;

function dayRange(startMs: number, endMs: number): string[] {
  const out: string[] = [];
  const d = new Date(startMs);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setUTCHours(0, 0, 0, 0);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function blockedSet(raw: string[]): Set<string> {
  const set = new Set<string>();
  for (const entry of raw) {
    if (/^\d{4}-\d{2}-\d{2}/.test(entry)) {
      set.add(entry.slice(0, 10));
      continue;
    }
    try {
      const o = JSON.parse(entry);
      const from = o.from ?? o.start ?? o.date;
      const to = o.to ?? o.end ?? from;
      if (from) for (const day of dayRange(Date.parse(from), Date.parse(to))) set.add(day);
    } catch {
      /* ignore */
    }
  }
  return set;
}

export type Iv = { start: number; end: number; qty: number; endExclusive?: boolean };
/** Clip exact upstream windows and inclusive local rental days to the same
 * half-open requested period. A midnight release does not consume the next day. */
export function overlappingIntervals(intervals:Iv[],start:number,end:number,endExclusive=false):Iv[] {
  const until=endExclusive?end:end+DAY;
  return intervals.map(i=>({...i,end:i.endExclusive?i.end:i.end+DAY,endExclusive:true}))
    .filter(i=>i.start<until&&i.end>start)
    .map(i=>({...i,start:Math.max(i.start,start),end:Math.min(i.end,until)}));
}
/** Max concurrent quantity; local ends are inclusive days unless explicitly half-open. */
export function peak(intervals: Iv[]): number {
  const ev: [number, number][] = [];
  for (const i of intervals) {
    ev.push([i.start, i.qty]);
    ev.push([i.endExclusive ? i.end : i.end + DAY, -i.qty]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0,
    mx = 0;
  for (const [, delta] of ev) {
    cur += delta;
    if (cur > mx) mx = cur;
  }
  return mx;
}

async function unitReservations(ctx: any, unitId: any, lo: number, hi: number): Promise<Iv[]> {
  const res = await ctx.db
    .query("reservations")
    .withIndex("by_unit", (q: any) => q.eq("inventoryUnitId", unitId))
    .collect();
  const intervals = await Promise.all(res.map((row: any) => reservationOccupancy(ctx, row)));
  return overlappingIntervals(intervals.filter((row): row is Iv => !!row),lo,hi,true);
}

/** Quantity-aware availability for one listing over [start,end]. */
export const forListing = query({
  args: stockRequestFields,
  handler: async (ctx, request) => {
    const {listingId,start,end}=request;
    const window=stockWindow(request,await stockTimePrecision(ctx));
    const l = await ctx.db.get(listingId);
    if (!l || rentalUnavailable(l)) return { available: 0, owned: 0 };
    if (!l.components.length || l.components.some(c => !Number.isSafeInteger(c.qty) || c.qty < 1)) return { available: 0, owned: 0 };
    const requested = dayRange(start, end);
    if (requested.some((d) => blockedSet(l.unavailableDates ?? []).has(d)))
      return { available: 0, owned: 0, blocked: true };

    let minAvail = Infinity;
    let owned = Infinity;
    const requirements=new Map<string,number>();
    for(const c of l.components)requirements.set(String(c.inventoryUnitId),(requirements.get(String(c.inventoryUnitId))??0)+c.qty);
    for (const [unitId,qty] of requirements) {
      const unit: any = await ctx.db.get(unitId as any);
      const ownedQ = inventoryCapacity(unit) ?? 0;
      owned = Math.min(owned, Math.floor(ownedQ / qty));
      const ivs = await unitReservations(ctx, unitId, window.start, window.end);
      const free = Math.max(0, ownedQ - peak(ivs));
      minAvail = Math.min(minAvail, Math.floor(free / qty));
    }
    return { available: minAvail === Infinity ? 0 : minAvail, owned: owned === Infinity ? 0 : owned };
  },
});

/**
 * Cart-level, UNIT-aware check: aggregates demand per physical unit across ALL
 * cart lines (respecting each bundle's BOM qty) plus site + Hygglo + subscription
 * reservations, then flags every listing that pushes any shared unit over stock.
 */
export const forCart = query({
  args: {
    items: v.array(stockRequest),
  },
  handler: async (ctx, { items }) => {
    if (items.length === 0) return {};
    if(items.length>100)throw Error("Basket is too large");
    const precision=await stockTimePrecision(ctx);
    const invalid = new Set<string>();
    const windows=items.map(i=>{try{return stockWindow(i,precision);}catch(error){if(!(error instanceof Error)||error.message!=="Return must be after pickup")throw error;invalid.add(String(i.listingId));return stockWindow({start:i.start,end:i.end},false);}});
    const lo = Math.min(...windows.map(i=>i.start));
    const hi = Math.max(...windows.map(i=>i.end));

    // resolve each cart line's components
    const lines: { listingId: string; start: number; end: number; qty:number; comps: any[] }[] = [];
    for (const [index,it] of items.entries()) {
      if(!Number.isSafeInteger(it.qty??1)||(it.qty??1)<1||(it.qty??1)>100)throw Error("Invalid rental quantity");
      const l = await ctx.db.get(it.listingId);
      if (!l || rentalUnavailable(l) || !l.components.length || l.components.some(c => !Number.isSafeInteger(c.qty) || c.qty < 1) ||
          dayRange(it.start, it.end).some(d => blockedSet(l.unavailableDates ?? []).has(d))) {
        invalid.add(it.listingId);
      } else {
        const components=new Map<string,number>();
        for(const c of l.components)components.set(String(c.inventoryUnitId),(components.get(String(c.inventoryUnitId))??0)+c.qty);
        lines.push({ listingId: it.listingId, ...windows[index], qty:it.qty??1, comps:[...components].map(([inventoryUnitId,qty])=>({inventoryUnitId,qty})) });
      }
    }

    // per-unit: owned, reservation intervals, standalone free
    const unitIds = new Set<string>();
    for (const ln of lines) for (const c of ln.comps) unitIds.add(c.inventoryUnitId);
    const owned: Record<string, number> = {};
    const resIvs: Record<string, Iv[]> = {};
    for (const uid of unitIds) {
      const unit: any = await ctx.db.get(uid as any);
      owned[uid] = inventoryCapacity(unit) ?? 0;
      resIvs[uid] = await unitReservations(ctx, uid, lo, hi);
    }

    // Build shared basket demand once, but evaluate it within each requested
    // period. A shortage for another hire must not mark an unrelated date as
    // unavailable, even when both listings use the same physical pool.
    const cartIvs: Record<string, Iv[]> = {};
    for (const uid of unitIds) {
      cartIvs[uid] = [];
      for (const ln of lines)
        for (const c of ln.comps)
          if (c.inventoryUnitId === uid) cartIvs[uid].push({ start: ln.start, end: ln.end, qty: c.qty*ln.qty,endExclusive:true });
    }

    // per-listing result
    const groups = new Map<string, typeof lines>();
    for (const ln of lines) {
      const g = groups.get(ln.listingId);
      if (g) g.push(ln);
      else groups.set(ln.listingId, [ln]);
    }
    const result: Record<string, { available: number; demanded: number; ok: boolean }> = {};
    for (const id of invalid) result[id] = { available: 0, demanded: items.filter(i => i.listingId === id).length, ok: false };
    for (const [listingId, g] of groups) {
      if (invalid.has(listingId)) continue;
      const ok = g.every(ln => ln.comps.every(c =>
        peak(overlappingIntervals([...resIvs[c.inventoryUnitId], ...cartIvs[c.inventoryUnitId]], ln.start, ln.end,true)) <= owned[c.inventoryUnitId]));
      const available = Math.min(...g.flatMap(ln => ln.comps.map(c =>
        Math.floor(Math.max(0, owned[c.inventoryUnitId] - peak(overlappingIntervals(resIvs[c.inventoryUnitId], ln.start, ln.end,true))) / c.qty))));
      result[listingId] = { available, demanded: g.length, ok };
    }
    return result;
  },
});

/** One visible month, loading each shared physical pool once. Capacity is
 * evaluated with the existing basket plus ONE prospective listing per day. */
export const forCalendar = query({
  args: { listingId: v.id("listings"), monthStart: v.number(), rangeStart:v.optional(v.number()), items: v.array(stockRequest), pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()) },
  handler: async (ctx, {listingId, monthStart, rangeStart, items,pickupTime,returnTime}) => {
    const date=new Date(monthStart);
    if(!Number.isSafeInteger(monthStart)||date.getUTCDate()!==1||date.getUTCHours()!==0||date.getUTCMinutes()!==0||date.getUTCSeconds()!==0||date.getUTCMilliseconds()!==0||(rangeStart!==undefined&&(!Number.isSafeInteger(rangeStart)||rangeStart%DAY!==0||Math.abs(monthStart-rangeStart)>365*DAY))||items.length>100||items.some(i=>!Number.isSafeInteger(i.start)||!Number.isSafeInteger(i.end)||i.end<i.start||i.end-i.start>365*DAY||i.start%DAY!==0||i.end%DAY!==0||!Number.isSafeInteger(i.qty??1)||(i.qty??1)<1||(i.qty??1)>100))throw Error("Invalid calendar stock request");
    const precision=await stockTimePrecision(ctx);
    const days=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    const records=new Map<string,any>();
    for(const id of new Set([String(listingId),...items.map(i=>String(i.listingId))]))records.set(id,await ctx.db.get(id as any));
    const listing=records.get(String(listingId));
    const valid=(l:any)=>l&&!rentalUnavailable(l)&&l.components?.length&&l.components.every((c:any)=>Number.isSafeInteger(c.qty)&&c.qty>0);
    const unitIds=new Set<string>(valid(listing)?listing.components.map((c:any)=>String(c.inventoryUnitId)):[]);
    const owned:Record<string,number>={},occupied:Record<string,Iv[]>={},cart:Record<string,Iv[]>={};
    for(const uid of unitIds){
      owned[uid]=inventoryCapacity(await ctx.db.get(uid as any) as any)??0;
      const rows=await ctx.db.query("reservations").withIndex("by_unit",q=>q.eq("inventoryUnitId",uid as any)).collect();
      occupied[uid]=(await Promise.all(rows.map(row=>reservationOccupancy(ctx,row)))).filter((row):row is NonNullable<typeof row>=>!!row);
      cart[uid]=items.flatMap(i=>{
        const l=records.get(String(i.listingId));
        if(!valid(l))return [];
        return l.components.filter((c:any)=>String(c.inventoryUnitId)===uid).map((c:any)=>({...stockWindow(i,precision),qty:c.qty*(i.qty??1)}));
      });
    }
    const requirements=new Map<string,number>();
    if(valid(listing))for(const c of listing.components)requirements.set(String(c.inventoryUnitId),(requirements.get(String(c.inventoryUnitId))??0)+c.qty);
    const blocks=blockedSet(listing?.unavailableDates??[]),result:Record<string,{ok:boolean;available:number;partial?:boolean;pickupSlots?:string[];returnSlots?:string[];precision?:boolean}>={};
    if(precision){
      const from=rentalWindow({start:Math.min(monthStart,rangeStart??monthStart),end:monthStart+(days-1)*DAY}).start;
      const until=rentalWindow({start:monthStart,end:monthStart+(days-1)*DAY}).end;
      let bands:CapacityBand[]|null=null;
      for(const [uid,qty] of requirements){const next=capacityBands([...occupied[uid],...cart[uid]],owned[uid],qty,from,until);bands=bands===null?next:intersectCapacity(bands,next);}
      for(let n=0;n<days;n++){
        const end=monthStart+n*DAY,key=new Date(end).toISOString().slice(0,10),start=rangeStart!==undefined&&rangeStart<=end?rangeStart:end;
        const slots=valid(listing)&&!dayRange(start,end).some(day=>blocks.has(day))?rentalSlots(bands??[],{start,end,pickupTime,returnTime}):{pickup:[],return:[],available:0};
        result[key]={ok:slots.available>=1,available:slots.available,partial:slots.pickup.length>0&&(slots.pickup.length<(start===end?13:14)||slots.return.length<(start===end?13:14)),pickupSlots:slots.pickup,returnSlots:slots.return,precision:true};
      }
      return result;
    }
    for(let n=0;n<days;n++){
      const start=monthStart+n*DAY,key=new Date(start).toISOString().slice(0,10);
      let available=0,ok=false;
      const from=rangeStart!==undefined&&rangeStart<=start?rangeStart:start;
      if(valid(listing)&&!dayRange(from,start).some(day=>blocks.has(day))){
        const window=stockWindow({start:from,end:start},false);
        available=Math.min(...[...requirements].map(([uid,qty])=>Math.floor(Math.max(0,owned[uid]-peak(overlappingIntervals([...occupied[uid],...cart[uid]],window.start,window.end,true)))/qty)));
        ok=available>=1;
      }
      result[key]={available,ok};
    }
    return result;
  },
});

/** Exact paired times for one prospective line, after allocating the remaining
 * basket across the same physical pools. No provider calls or per-slot reads. */
export const forTimeSlots=query({
  args:{...stockRequestFields,items:v.array(stockRequest)},
  handler:async(ctx,{listingId,start,end,pickupTime,returnTime,qty=1,items})=>{
    if(items.length>100||!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error("Invalid time availability request");
    const precision=await stockTimePrecision(ctx),window=stockWindow({start,end},false);
    const listing=await ctx.db.get(listingId);
    const empty={precision,pickupSlots:[] as string[],returnSlots:[] as string[],available:0};
    if(!listing||rentalUnavailable(listing)||!listing.components.length||dayRange(start,end).some(d=>blockedSet(listing.unavailableDates??[]).has(d)))return empty;
    const requirements=new Map<string,number>();
    for(const c of listing.components){if(!Number.isSafeInteger(c.qty)||c.qty<1)return empty;requirements.set(String(c.inventoryUnitId),(requirements.get(String(c.inventoryUnitId))??0)+c.qty*qty);}
    const records=new Map<string,any>();
    for(const i of items)if(!records.has(String(i.listingId)))records.set(String(i.listingId),await ctx.db.get(i.listingId));
    let bands:CapacityBand[]|null=null;
    for(const [uid,required]of requirements){
      const owned=inventoryCapacity(await ctx.db.get(uid as any) as any)??0;
      const reservations=await unitReservations(ctx,uid,window.start,window.end);
      const cart=items.flatMap(i=>{
        const l=records.get(String(i.listingId));
        if(!Number.isSafeInteger(i.qty??1)||(i.qty??1)<1||(i.qty??1)>100)throw Error("Invalid cart quantity");
        if(!l||rentalUnavailable(l))return [];
        return l.components.filter((c:any)=>String(c.inventoryUnitId)===uid).map((c:any)=>({...stockWindow(i,precision),qty:c.qty*(i.qty??1)}));
      });
      const capacity=capacityBands([...reservations,...cart],owned,required,window.start,window.end);
      bands=bands?intersectCapacity(bands,capacity):capacity;
    }
    if(!precision){
      const available=windowCapacity(bands??[],window.start,window.end);
      return {precision,pickupSlots:available?RENTAL_TIME_SLOTS:[],returnSlots:available?RENTAL_TIME_SLOTS:[],available};
    }
    const slots=rentalSlots(bands??[],{start,end,pickupTime,returnTime});
    return {precision,pickupSlots:slots.pickup,returnSlots:slots.return,available:slots.available};
  },
});

/** Default collection clocks must fit the complete basket simultaneously. */
export const forCheckoutTimeSlots=query({
 args:{items:v.array(stockRequest),pickupTime:v.optional(v.string()),returnTime:v.optional(v.string())},
 handler:async(ctx,{items,pickupTime,returnTime})=>{
  const empty={pickupSlots:[] as string[],returnSlots:[] as string[]};
  if(!items.length)return empty;
  if(items.length>100)throw Error("Invalid basket time request");
  const precision=await stockTimePrecision(ctx),records=new Map<string,any>(),requirements=new Map<string,number>();
  const full=items.map(i=>stockWindow(i,false)),lo=Math.min(...full.map(w=>w.start)),hi=Math.max(...full.map(w=>w.end));
  for(const i of items){
   if(!Number.isSafeInteger(i.qty??1)||(i.qty??1)<1||(i.qty??1)>100)throw Error("Invalid cart quantity");
   const l=records.get(String(i.listingId))??await ctx.db.get(i.listingId);records.set(String(i.listingId),l);
   if(!l||rentalUnavailable(l)||!l.components.length||dayRange(i.start,i.end).some(d=>blockedSet(l.unavailableDates??[]).has(d)))return empty;
   for(const c of l.components){if(!Number.isSafeInteger(c.qty)||c.qty<1)return empty;requirements.set(String(c.inventoryUnitId),0);}
  }
  const pools=new Map<string,{owned:number;occupied:Iv[]}>();
  for(const uid of requirements.keys())pools.set(uid,{owned:inventoryCapacity(await ctx.db.get(uid as any) as any)??0,occupied:await unitReservations(ctx,uid,lo,hi)});
  const pickups=new Set<string>(),returns=new Set<string>(),allPickup=new Set<string>(),allReturn=new Set<string>();
  const windows=new Map<string,ReturnType<typeof stockWindow>>();
  for(const first of RENTAL_TIME_SLOTS)for(const last of RENTAL_TIME_SLOTS){
   const demand=new Map<string,Iv[]>();let valid=true;
   try{for(const i of items){const request={...i,pickupTime:i.pickupTime||first,returnTime:i.returnTime||last},key=JSON.stringify([i.start,i.end,request.pickupTime,request.returnTime]);const window=windows.get(key)??stockWindow(request,precision);windows.set(key,window);for(const c of records.get(String(i.listingId)).components){const uid=String(c.inventoryUnitId);demand.set(uid,[...(demand.get(uid)??[]),{...window,qty:c.qty*(i.qty??1)}]);}}}catch{valid=false;}
   if(!valid)continue;
   for(const [uid,lines]of demand){const pool=pools.get(uid)!;if(lines.some(line=>peak(overlappingIntervals([...pool.occupied,...lines],line.start,line.end,true))>pool.owned)){valid=false;break;}}
   if(!valid)continue;
   allPickup.add(first);allReturn.add(last);
   if(!returnTime||returnTime===last)pickups.add(first);
   if(!pickupTime||pickupTime===first)returns.add(last);
  }
  return {pickupSlots:[...(pickups.size?pickups:allPickup)],returnSlots:[...(returns.size?returns:allReturn)]};
 },
});
