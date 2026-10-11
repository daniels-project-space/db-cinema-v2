import {query,mutation} from "./_generated/server";
import {v,ConvexError} from "convex/values";
import {assertAdmin,checkAdminToken} from "./adminAuth";
import {availableCreditRows} from "./lib/checkoutCredit";
import {creditDebit} from "./lib/creditLedger";
import {CANCELLATION_CREDIT_DAYS} from "../src/lib/cancellationPolicy";
const manual=(row:any)=>row.reason?.startsWith("admin_adjustment:") && !row.membershipGrantId && !row.membershipInvoiceId && row.kind!=="refund" && row.currency==="GBP";
const total=(rows:any[])=>rows.reduce((n,c)=>n+c.availablePence,0);
const reject=(code:string,message:string):never=>{throw new ConvexError({code,message});};
export const state=query({args:{token:v.string(),accountId:v.id("accounts"),refreshKey:v.optional(v.number())},handler:async(ctx,args)=>{
 if(!checkAdminToken(args.token))throw Error("unauthorized");
 const account=await ctx.db.get(args.accountId);if(!account)return null;
 const [rows,history]=await Promise.all([availableCreditRows(ctx,args.accountId),ctx.db.query("account_credit_adjustments").withIndex("by_account",q=>q.eq("accountId",args.accountId)).order("desc").take(20)]);
 return {balancePence:total(rows),removablePence:total(rows.filter(manual)),history:history.map(r=>({id:r._id,requestId:r.requestId,deltaPence:r.deltaPence,balanceAfterPence:r.balanceAfterPence,reason:r.reason,at:r.at}))};
}});
/** Manual promotional credit only. No card refund, subscription grant or provider call. */
export const adjust=mutation({args:{token:v.string(),accountId:v.id("accounts"),requestId:v.string(),deltaPence:v.number(),expectedBalancePence:v.number(),reason:v.string()},handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"accountCredit.adjust");
 const reason=args.reason.trim();
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(args.requestId)||!Number.isSafeInteger(args.deltaPence)||args.deltaPence===0||Math.abs(args.deltaPence)>1000000||!Number.isSafeInteger(args.expectedBalancePence)||args.expectedBalancePence<0||reason.length<5||reason.length>500)
   reject("invalid_adjustment","Enter a non-zero amount up to £10,000 and a reason of 5–500 characters.");
 const prior=await ctx.db.query("account_credit_adjustments").withIndex("by_request",q=>q.eq("requestId",args.requestId)).unique();
 if(prior){if(prior.accountId!==args.accountId||prior.deltaPence!==args.deltaPence||prior.reason!==reason||prior.expectedBalancePence!==args.expectedBalancePence)reject("request_conflict","This adjustment reference already belongs to another change.");return {id:prior._id,balanceAfterPence:prior.balanceAfterPence};}
 if(!await ctx.db.get(args.accountId))reject("account_missing","Account no longer exists.");
 const rows=await availableCreditRows(ctx,args.accountId),balance=total(rows);
 if(balance!==args.expectedBalancePence)reject("balance_changed","The available balance changed. Review it before applying an adjustment.");
 const changes:{creditId:any;amountPence:number}[]=[];
 if(args.deltaPence>0){const id=await ctx.db.insert("credits",{accountId:args.accountId,amount:args.deltaPence/100,remaining:args.deltaPence/100,currency:"GBP",kind:"earned",reason:`admin_adjustment:${args.requestId}`,createdAt:Date.now(),expiresAt:Date.now()+CANCELLATION_CREDIT_DAYS*86400000,status:"active"});changes.push({creditId:id,amountPence:args.deltaPence});}
 else {
   const eligible=rows.filter(manual);let need=-args.deltaPence;
   if(total(eligible)<need)reject("insufficient_manual_credit","Only unreserved admin-issued credit can be removed. Refund and subscription credit retain their own settlement rules.");
   for(const row of eligible){const take=Math.min(need,row.availablePence);if(!take)continue;await ctx.db.patch(row._id,creditDebit(row,take/100).patch);changes.push({creditId:row._id,amountPence:-take});need-=take;if(!need)break;}
 }
 const balanceAfterPence=balance+args.deltaPence;
 const id=await ctx.db.insert("account_credit_adjustments",{accountId:args.accountId,requestId:args.requestId,deltaPence:args.deltaPence,expectedBalancePence:args.expectedBalancePence,balanceAfterPence,reason,at:Date.now(),changes});
 return {id,balanceAfterPence};
}});
