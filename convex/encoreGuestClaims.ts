import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { bump } from "./rateLimit";
import { encoreGuestClaimEligible } from "./lib/encoreGuestClaim";
import { queueRentalEmail } from "./lib/rentalEmailQueue";

export const request=mutation({args:{bookingId:v.id("bookings"),email:v.string()},handler:async(ctx,args)=>{
 if(process.env.ENCORE_EVIDENCE_READ_ENABLED!=="true")return {ok:true};
 const email=args.email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return {ok:true};
 if(!(await bump(ctx,`encore-claim:${args.bookingId}`,3,3600000)).allowed||!(await bump(ctx,"encore-claim:global",120,3600000)).allowed)return {ok:true};
 const booking=await ctx.db.get(args.bookingId),account=booking?.accountId?await ctx.db.get(booking.accountId):null;
 if(account?.email.trim().toLowerCase()===email&&await encoreGuestClaimEligible(ctx,booking,account))await queueRentalEmail(ctx,booking!._id,"encore_guest_claim",{encoreAccountId:account._id},{repeatGuestClaim:true});
 return {ok:true};
}});
