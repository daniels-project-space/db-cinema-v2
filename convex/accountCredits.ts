import {mutation,query} from "./_generated/server";
import {v} from "convex/values";
import {paginationOptsValidator} from "convex/server";
import {assertAdmin,checkAdminToken} from "./adminAuth";
import {accountForToken} from "./lib/rentalChat";
import {availableCreditRows} from "./lib/checkoutCredit";
const YEAR=365*86400000;
function creditDescription(reason:string){
 if(reason.startsWith("admin_grant:"))return reason.slice("admin_grant:".length);
 const type=reason.split(":",1)[0];
 return ({late_cancellation:"Rental cancellation credit",restored_credit:"Previously used credit restored",consented_full_credit:"Rental payment converted to account credit",operator_cancellation_credit:"Cancelled rental · account credit",operator_cancellation_bonus:"Cancelled rental · 30% extra credit"} as Record<string,string>)[type]??reason;
}
const amountPence=(amount:number)=>{const p=Math.round(amount*100);if(!Number.isFinite(amount)||!Number.isSafeInteger(p)||p<=0||p/100!==amount)throw Error("Enter a positive credit amount in pounds and pence.");return p;};
export const grantAdmin=mutation({args:{token:v.string(),accountId:v.id("accounts"),amount:v.number(),requestId:v.string(),reason:v.optional(v.string()),confirmed:v.boolean()},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,"accountCredits.grantAdmin");
 if(!a.confirmed)throw Error("Review and confirm this account credit grant.");
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))throw Error("Invalid credit request identity.");
 const pence=amountPence(a.amount),reason=a.reason?.trim()||"Administrator account credit";if(reason.length>500)throw Error("Credit note is too long.");
 const prior=await ctx.db.query("credit_issues").withIndex("by_request",q=>q.eq("requestId",a.requestId)).unique();
 if(prior){if(prior.accountId!==a.accountId||prior.amountPence!==pence||prior.reason!==reason)throw Error("This credit request was already used for different particulars.");return {creditId:prior.creditId,amount:prior.amountPence/100,expiresAt:prior.expiresAt,replayed:true};}
 const account=await ctx.db.get(a.accountId);if(!account)throw Error("Account no longer exists.");
 const now=Date.now(),expiresAt=now+YEAR;
 const creditId=await ctx.db.insert("credits",{accountId:account._id,kind:"earned",currency:"GBP",amount:pence/100,remaining:pence/100,reason:"admin_grant:"+reason,createdAt:now,expiresAt,status:"active"});
 await ctx.db.insert("credit_issues",{requestId:a.requestId,accountId:account._id,creditId,amountPence:pence,reason,createdAt:now,expiresAt});
 await ctx.db.insert("account_admin_changes",{accountId:account._id,kind:"credit_grant",before:"",after:"GBP "+(pence/100).toFixed(2),reason,at:now});
 return {creditId,amount:pence/100,expiresAt,replayed:false};
}});
export const adminHistory=query({args:{token:v.string(),accountId:v.id("accounts")},handler:async(ctx,a)=>{
 if(!checkAdminToken(a.token))throw Error("Unauthorized");
 const issues=await ctx.db.query("credit_issues").withIndex("by_account_created",q=>q.eq("accountId",a.accountId)).order("desc").take(50);
 return issues.map(row=>({id:row._id,amount:row.amountPence/100,reason:row.reason,createdAt:row.createdAt,expiresAt:row.expiresAt}));
}});
export const balance=query({args:{token:v.string(),refreshAt:v.optional(v.number())},handler:async(ctx,{token})=>{
 const account=await accountForToken(ctx,token);if(!account)throw Error("Sign in to use account credit.");
 const rows=await availableCreditRows(ctx,account._id),pence=rows.reduce((sum:number,row:any)=>sum+row.availablePence,0);
 const recentCredit=(await ctx.db.query("credits").withIndex("by_account",q=>q.eq("accountId",account._id)).order("desc").take(1))[0];
 const recentEvent=(await ctx.db.query("credit_issues").withIndex("by_account_created",q=>q.eq("accountId",account._id)).order("desc").take(1))[0];
 const recent=recentEvent&&(!recentCredit||recentEvent.createdAt>=recentCredit.createdAt)?{_id:recentEvent._id,amount:recentEvent.amountPence/100,createdAt:recentEvent.createdAt}:recentCredit;
 return {accountId:account._id,available:pence/100,refundAvailable:rows.filter((r:any)=>r.kind==="refund").reduce((n:number,r:any)=>n+r.availablePence,0)/100,earnedAvailable:rows.filter((r:any)=>r.kind==="earned").reduce((n:number,r:any)=>n+r.availablePence,0)/100,nextExpiry:rows.find((r:any)=>r.availablePence>0)?.expiresAt??null,recentIssue:recent?{id:recent._id,amount:recent.amount,createdAt:recent.createdAt}:null};
}});

export const history=query({args:{token:v.string(),accountId:v.optional(v.id("accounts")),paginationOpts:paginationOptsValidator},handler:async(ctx,a)=>{
 const owner=checkAdminToken(a.token);
 const account=owner&&a.accountId?await ctx.db.get(a.accountId):await accountForToken(ctx,a.token);
 if(!account||a.accountId&&a.accountId!==account._id)throw Error("Unauthorized");
 const page=await ctx.db.query("credits").withIndex("by_account",q=>q.eq("accountId",account._id)).order("desc").paginate(a.paginationOpts);
 return {...page,page:page.page.map(row=>({id:row._id,amount:row.amount,remaining:row.remaining,reason:creditDescription(row.reason),createdAt:row.createdAt,expiresAt:row.expiresAt,status:row.status}))};
}});
export const statement=query({args:{token:v.string(),creditId:v.id("credits")},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.creditId);if(!row)throw Error("Credit receipt not found.");
 const account=await ctx.db.get(row.accountId);if(!account)throw Error("Credit account not found.");
 if(!checkAdminToken(a.token)){const viewer=await accountForToken(ctx,a.token);if(!viewer||viewer._id!==row.accountId)throw Error("Unauthorized");}
 return {number:"DBC-C-"+String(row._id).slice(-10).toUpperCase(),name:account.name??account.email,email:account.email,amount:row.amount,currency:row.currency,issuedAt:row.createdAt,expiresAt:row.expiresAt,reason:creditDescription(row.reason),bookingId:row.bookingId??null};
}});
