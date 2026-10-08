import { rentalWindow, dateLabel, STOCK_DAY, RENTAL_TIME_SLOTS, londonRentalInstant, type RentalWindowInput } from "../../shared/rentalWindow";
export type StockInterval={start:number;end:number;qty:number;endExclusive?:boolean;turnaroundBufferMinutes?:number};
export type CapacityBand={start:number;end:number;available:number};
export async function stockTimePrecision(ctx:any):Promise<boolean> {
 const state=await ctx.db.query("rmv2_sync_state").withIndex("by_key",(q:any)=>q.eq("key","shared-stock-v1")).first();
 try{const p=JSON.parse(state?.cursor??"null");return state?.status==="ok"&&p?.version===2&&p.turnaroundBufferMinutes===60&&Number.isSafeInteger(p.checkedAt)&&p.checkedAt<=Date.now()+60000&&Date.now()-p.checkedAt<=5*60000;}catch{return false;}
}
export function stockWindow(input:RentalWindowInput,precise:boolean) {
 if(input.start%STOCK_DAY!==0||input.end%STOCK_DAY!==0)throw Error("Rental dates must be UTC-midnight labels");
 const window=rentalWindow(input,precise);
 return {...window,end:window.end+3600000,turnaroundBufferMinutes:60};
}
/** Legacy UTC wall labels never support intraday release. */
export function legacyStockWindow(row:StockInterval) {
 const last=row.endExclusive&&row.end%STOCK_DAY===0?row.end-STOCK_DAY:row.end;
 return {start:londonRentalInstant(dateLabel(row.start),"00:00"),end:londonRentalInstant(dateLabel(last)+STOCK_DAY,"00:00")+3600000,endExclusive:true,qty:row.qty};
}
/** Sweep each physical pool once; available quantities already include all basket demand. */
export function capacityBands(rows:StockInterval[],owned:number,required:number,from:number,until:number):CapacityBand[] {
 if(!Number.isSafeInteger(owned)||owned<1||!Number.isSafeInteger(required)||required<1||until<=from)return [];
 const events=new Map<number,number>([[from,0],[until,0]]);
 for(const row of rows){if(!Number.isSafeInteger(row.qty)||row.qty<1)throw Error("Invalid physical stock allocation");const start=Math.max(from,row.start),end=Math.min(until,row.endExclusive?row.end:row.end+STOCK_DAY);if(end<=start)continue;events.set(start,(events.get(start)??0)+row.qty);events.set(end,(events.get(end)??0)-row.qty);}
 const times=[...events.keys()].sort((a,b)=>a-b),out:CapacityBand[]=[];let occupied=0;
 for(let i=0;i<times.length-1;i++){occupied+=events.get(times[i])!;const available=Math.floor(Math.max(0,owned-occupied)/required);if(available>0)out.push({start:times[i],end:times[i+1],available});}
 return out;
}
export function intersectCapacity(a:CapacityBand[],b:CapacityBand[]):CapacityBand[] {
 const out:CapacityBand[]=[];let i=0,j=0;
 while(i<a.length&&j<b.length){const start=Math.max(a[i].start,b[j].start),end=Math.min(a[i].end,b[j].end);if(end>start)out.push({start,end,available:Math.min(a[i].available,b[j].available)});if(a[i].end<=b[j].end)i++;else j++;}
 return out;
}
export function windowCapacity(bands:CapacityBand[],start:number,end:number):number {
 if(end<=start)return 0;let cursor=start,available=Infinity;
 for(const band of bands){if(band.end<=cursor)continue;if(band.start>cursor)return 0;available=Math.min(available,band.available);cursor=Math.min(end,band.end);if(cursor===end)return available;}
 return 0;
}
export function rentalSlots(bands:CapacityBand[],input:RentalWindowInput) {
 const starts=RENTAL_TIME_SLOTS.map(time=>({time,at:londonRentalInstant(input.start,time)})),ends=RENTAL_TIME_SLOTS.map(time=>({time,at:londonRentalInstant(input.end,time)}));
 const pickup=new Set<string>(),returns=new Set<string>(),allPickup=new Set<string>(),allReturns=new Set<string>();let available=0;const validPairs:Array<{pickupTime:string;returnTime:string}>=[];
 for(const first of starts)for(const last of ends){if(last.at<=first.at)continue;const count=windowCapacity(bands,first.at,last.at+3600000);if(!count)continue;validPairs.push({pickupTime:first.time,returnTime:last.time});allPickup.add(first.time);allReturns.add(last.time);if(!input.returnTime||input.returnTime===last.time)pickup.add(first.time);if(!input.pickupTime||input.pickupTime===first.time)returns.add(last.time);if((!input.pickupTime||input.pickupTime===first.time)&&(!input.returnTime||input.returnTime===last.time))available=Math.max(available,count);}
 // A menu candidate must fit the full period with the opposite selected clock.
 // Same-day clock ordering is a separate validation: probe a positive minimal
 // rental only when that candidate would put return before/equal to pickup.
 const pickupBoundary=new Set<string>(),returnBoundary=new Set<string>();
 const selectedReturn=ends.find(last=>last.time===input.returnTime);
 const selectedPickup=starts.find(first=>first.time===input.pickupTime);
 for(const first of starts){
  if(selectedReturn){
   const until=selectedReturn.at>first.at?selectedReturn.at:input.start===input.end?first.at+60_000:null;
   if(until!==null&&windowCapacity(bands,first.at,until+3600000))pickupBoundary.add(first.time);
  }else if(allPickup.has(first.time)||(input.start===input.end&&windowCapacity(bands,first.at,first.at+60_000+3600000)))pickupBoundary.add(first.time);
 }
 for(const last of ends){
  if(selectedPickup){
   const from=selectedPickup.at<last.at?selectedPickup.at:input.start===input.end?last.at-60_000:null;
   if(from!==null&&windowCapacity(bands,from,last.at+3600000))returnBoundary.add(last.time);
  }else if(allReturns.has(last.time)||(input.start===input.end&&windowCapacity(bands,last.at-60_000,last.at+3600000)))returnBoundary.add(last.time);
 }
 return {pickup:[...(pickup.size?pickup:allPickup)],return:[...(returns.size?returns:allReturns)],available,pickupBoundarySlots:RENTAL_TIME_SLOTS.filter(t=>pickupBoundary.has(t)),returnBoundarySlots:RENTAL_TIME_SLOTS.filter(t=>returnBoundary.has(t)),validPairs};
}
