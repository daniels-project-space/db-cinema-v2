import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken } from "./lib/rentalChat";
import { safeRepeatRental,repeatRentalFingerprint } from "./lib/repeatRental";
import { reviewContext } from "./lib/reviewContext";
export const candidate=internalQuery({args:{token:v.string(),kit:v.array(v.object({listingId:v.id("listings"),qty:v.number()}))},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token);if(!account)return null;
 const rentals=await ctx.db.query("bookings").withIndex("by_guestEmail",q=>q.eq("guestEmail",account.email)).collect();
 const matching=rentals.filter(b=>safeRepeatRental(b,account,a.kit)).sort((a,b)=>(b.actualReturnedAt??0)-(a.actualReturnedAt??0));
 const b=matching[0];if(!b)return null;
 const context=await reviewContext(ctx,b);return{booking:context,fingerprint:repeatRentalFingerprint(context)};
}});
