import { qualifyingRentalCount } from "../../shared/loyalty";
import { loyaltyPercent } from "../../shared/rentalBenefits";
export async function loyaltyProgress(ctx:any,account:any){
 const stored=Math.max(account.loyaltyLevel??0,account.loyaltyUnlockedAt?3:0);
 const completed=stored>=3?3:Math.max(stored,qualifyingRentalCount(await ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).collect()));
 return {eligible:completed>0,completed,level:completed,percent:loyaltyPercent(completed)};
}
export async function unlockLoyalty(ctx:any,email:string){
 const account=await ctx.db.query("accounts").withIndex("by_email",(q:any)=>q.eq("email",email.trim().toLowerCase())).first();if(!account)return;
 const progress=await loyaltyProgress(ctx,account);
 if(progress.level>(account.loyaltyLevel??(account.loyaltyUnlockedAt?3:0)))await ctx.db.patch(account._id,{loyaltyLevel:progress.level,...(progress.level===3?{loyaltyUnlockedAt:account.loyaltyUnlockedAt??Date.now()}:{})});
}
