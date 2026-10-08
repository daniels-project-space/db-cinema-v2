/** Rental dates are UTC-midnight labels, clocks are Europe/London civil time.
 * Reject nonexistent or ambiguous clocks rather than guessing a DST offset. */
export const STOCK_DAY = 86400000;
export const RENTAL_TIME_SLOTS = Array.from({length:14},(_,i)=>`${String(i+9).padStart(2,"0")}:00`);
const london = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function parts(at:number) {
 const p=Object.fromEntries(london.formatToParts(new Date(at)).map(x=>[x.type,Number(x.value)]));
 return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
}
export function dateLabel(at:number):number {
 if(!Number.isSafeInteger(at))throw Error("Invalid rental date");
 const d=new Date(at), label=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
 if(!Number.isFinite(label))throw Error("Invalid rental date");
 return label;
}
export function londonRentalInstant(day:number,time:string):number {
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("Invalid rental time");
 const label=dateLabel(day), [h,m]=time.split(":").map(Number),wall=label+(h*60+m)*60000;
 const offsets=new Set([-STOCK_DAY,0,STOCK_DAY].map(delta=>parts(wall+delta)-(wall+delta)));
 const matches=[...offsets].map(offset=>wall-offset).filter(at=>parts(at)===wall);
 if(matches.length!==1)throw Error("This London time is ambiguous or does not exist. Choose another time.");
 return matches[0];
}
export type RentalWindowInput={start:number;end:number;pickupTime?:string|null;returnTime?:string|null};
export function rentalWindow(input:RentalWindowInput, precise=true):{start:number;end:number;endExclusive:true} {
 const first=dateLabel(input.start),last=dateLabel(input.end);
 if(last<first||last-first>365*STOCK_DAY)throw Error("Invalid rental date range");
 // Validate supplied clocks even when the source has not qualified precision.
 if(input.pickupTime!=null&&input.pickupTime!=="")londonRentalInstant(first,input.pickupTime);
 if(input.returnTime!=null&&input.returnTime!=="")londonRentalInstant(last,input.returnTime);
 if(input.pickupTime&&input.returnTime&&londonRentalInstant(last,input.returnTime)<=londonRentalInstant(first,input.pickupTime))throw Error("Return must be after pickup");
 const start=londonRentalInstant(first,precise&&input.pickupTime?input.pickupTime:"00:00");
 const end=precise&&input.returnTime?londonRentalInstant(last,input.returnTime):londonRentalInstant(last+STOCK_DAY,"00:00");
 if(end<=start)throw Error("Return must be after pickup");
 return {start,end,endExclusive:true};
}
export function bookingStockLines<T extends RentalWindowInput>(booking:{lineItems:T[];pickupTime?:string|null;returnTime?:string|null}):T[] {
 return booking.lineItems.map(line=>({...line,pickupTime:line.pickupTime===undefined?booking.pickupTime:line.pickupTime,returnTime:line.returnTime===undefined?booking.returnTime:line.returnTime}));
}
