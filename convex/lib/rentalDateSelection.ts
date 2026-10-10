import type { Infer } from "convex/values";
import { dateRequestSelection } from "./rentalDateSelectionFields";
import { bookingStockLines, RENTAL_TIME_SLOTS, rentalWindow } from "../../shared/rentalWindow";
import { rescheduledLines } from "../../shared/rentalReschedule";
import { londonStartOfDay } from "../../src/lib/cancellationPolicy";
export type DateSelection=Infer<typeof dateRequestSelection>;
export function dateSource(booking:any){return bookingStockLines(booking).map((line:any)=>({listingId:line.listingId,qty:line.qty,start:line.start,end:line.end,pickupTime:line.pickupTime??null,returnTime:line.returnTime??null}));}
function sourceKey(source:DateSelection["source"]){return JSON.stringify(source.map(line=>[line.listingId,line.qty,line.start,line.end,line.pickupTime,line.returnTime]));}
export function sameDateInput(saved:DateSelection|undefined,input:DateSelection|undefined){return !saved&&!input||!!saved&&!!input&&saved.start===input.start&&saved.end===input.end&&saved.pickupTime===input.pickupTime&&saved.returnTime===input.returnTime&&saved.note===input.note.trim()&&saved.source.length===input.source.length&&sourceKey(saved.source)===sourceKey(input.source);}
export function assertDateSelection(selection:DateSelection|undefined,booking:any,start:number,end?:number,pickupTime?:string,returnTime?:string){
 if(!selection)return;
 if(selection.start!==start||selection.end!==end||selection.pickupTime!==pickupTime||selection.returnTime!==returnTime)throw Error("The dates and London times do not match the approved request.");
 if(selection.source.length!==booking.lineItems.length||sourceKey(selection.source)!==sourceKey(dateSource(booking)))throw Error("The rental changed since this date request. Review it with the customer and approve a new request.");
}
export function resolveDateRequest(booking:any,input:DateSelection){
 if(!Number.isSafeInteger(input.start)||!Number.isSafeInteger(input.end)||input.start%86400000||input.end%86400000||input.start<londonStartOfDay(Date.now()))throw Error("Choose valid future collection and return dates.");
 if(!RENTAL_TIME_SLOTS.includes(input.pickupTime)||!RENTAL_TIME_SLOTS.includes(input.returnTime))throw Error("Choose collection and return times between 09:00 and 22:00.");
 rentalWindow(input);assertDateSelection(input,booking,input.start,input.end,input.pickupTime,input.returnTime);
 rescheduledLines(booking,input.start,input.end,input.pickupTime,input.returnTime);
 const note=input.note.trim();if(note.length<5||note.length>600)throw Error("Add a note for the team in 5–600 characters.");
 const detail=`Requested collection: ${new Date(input.start).toISOString().slice(0,10)} at ${input.pickupTime}. Requested return: ${new Date(input.end).toISOString().slice(0,10)} at ${input.returnTime}. All times London.\n${note}`;
 if(detail.length>1000)throw Error("Shorten your date request to 1000 characters.");
 return {detail,snapshot:{...input,note,source:dateSource(booking)}};
}
