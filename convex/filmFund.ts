import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken } from "./lib/rentalChat";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { bump } from "./rateLimit";
import { FUND_ROUNDS, FILM_FUND_TERMS_VERSION, fundProjectKey, fundSubmissionErrors } from "../shared/filmFund";
import { isProPlus,membershipActiveNow } from "../shared/membership";

export async function rounds(ctx:any){ const rows=await ctx.db.query("film_fund_rounds").collect(); return FUND_ROUNDS.map(f=>rows.find((r:any)=>r.slug===f.slug)??f); }
export const schedule=query({args:{},handler:async(ctx)=>({rounds:await rounds(ctx),entryPence:1500,termsVersion:FILM_FUND_TERMS_VERSION})});
export const notify=mutation({args:{email:v.string(),consent:v.boolean()},handler:async(ctx,a)=>{
 const email=a.email.trim().toLowerCase();if(!a.consent||email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw Error("Enter a valid email and consent to Film Fund launch updates.");
 if(!(await bump(ctx,`fund-signup:${email}`,3,3600000)).allowed)throw Error("Please try again later.");
 const existing=await ctx.db.query("film_fund_signups").withIndex("by_email",q=>q.eq("email",email)).unique();
 if(existing)await ctx.db.patch(existing._id,{active:true,consentAt:Date.now()});else await ctx.db.insert("film_fund_signups",{email,active:true,consentAt:Date.now(),createdAt:Date.now()});
 if(!existing?.active)await ctx.scheduler.runAfter(0,internal.filmFundNotifications.confirm,{email});
 return {saved:true};
}});
export const notificationActive=internalQuery({args:{email:v.string()},handler:async(ctx,a)=>!!(await ctx.db.query("film_fund_signups").withIndex("by_email",q=>q.eq("email",a.email)).unique())?.active});
export const unsubscribeNotification=internalMutation({args:{email:v.string()},handler:async(ctx,a)=>{const row=await ctx.db.query("film_fund_signups").withIndex("by_email",q=>q.eq("email",a.email)).unique();if(row)await ctx.db.patch(row._id,{active:false});return {unsubscribed:true};}});
export const mine=query({args:{token:v.string()},handler:async(ctx,{token})=>{const a=await accountForToken(ctx,token);if(!a)return [];return ctx.db.query("film_fund_projects").withIndex("by_account",q=>q.eq("accountId",a._id)).collect();}});
const crew=v.array(v.object({name:v.string(),role:v.string(),profile:v.string(),bio:v.string()}));
export const saveDraft=mutation({args:{token:v.string(),projectId:v.optional(v.id("film_fund_projects")),title:v.string(),synopsis:v.string(),tags:v.array(v.string()),letter:v.string(),crew},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token);if(!account)throw Error("Sign in to prepare your application.");
 if(a.title.trim().length<3||a.title.length>150||a.synopsis.length>10000||a.letter.length>10000||a.crew.length>30||a.tags.length>10||a.tags.some(t=>t.length>50)||a.crew.some(c=>c.name.length>150||c.role.length>150||c.profile.length>1000||c.bio.length>4000))throw Error("Check the project details and field lengths.");
 const key=fundProjectKey(a.title);let project=a.projectId?await ctx.db.get(a.projectId):await ctx.db.query("film_fund_projects").withIndex("by_project",q=>q.eq("accountId",account._id).eq("projectKey",key)).unique();
 if(project&&(project.accountId!==account._id||project.state!=="draft"))throw Error("This application is locked or belongs to another account.");
 const data={title:a.title.trim(),synopsis:a.synopsis.trim(),tags:a.tags.map(t=>t.trim()).filter(Boolean),letter:a.letter,crew:a.crew,updatedAt:Date.now()};
 if(project){if(project.projectKey!==key)throw Error("A saved project keeps its title to prevent duplicate entry purchases. Contact the team to correct it.");await ctx.db.patch(project._id,data);return project._id;}
 return ctx.db.insert("film_fund_projects",{...data,accountId:account._id,projectKey:key,state:"draft",documentIds:[],createdAt:Date.now()});
}});
export const uploadUrl=mutation({args:{token:v.string(),projectId:v.id("film_fund_projects")},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token),p=await ctx.db.get(a.projectId);if(!account||!p||p.accountId!==account._id||p.state!=="draft")throw Error("Application upload is not available.");
 if(!(await bump(ctx,`fund-upload:${account._id}`,30,3600000)).allowed)throw Error("Upload limit reached. Please try later.");
 return ctx.storage.generateUploadUrl();
}});
const kind=v.union(v.literal("script"),v.literal("moodboard"),v.literal("document"),v.literal("video"));
export const attachDocument=mutation({args:{token:v.string(),projectId:v.id("film_fund_projects"),storageId:v.id("_storage"),kind,name:v.string()},handler:async(ctx,a)=>{
 if(a.kind==="video")throw Error("Pitch videos require duration verification.");
 return attach(ctx,a);
}});
async function attach(ctx:any,a:any){
 const account=await accountForToken(ctx,a.token),p=await ctx.db.get(a.projectId);if(!account||!p||p.accountId!==account._id||p.state!=="draft")throw Error("Application upload is not available.");
 const existing=await ctx.db.query("film_fund_uploads").withIndex("by_storage",(q:any)=>q.eq("storageId",a.storageId)).unique();
 if(existing){if(existing.projectId!==p._id||existing.accountId!==account._id||existing.kind!==a.kind)throw Error("Upload belongs to another application.");return existing._id;}
 const meta=await ctx.db.system.get(a.storageId);if(!meta||!meta.size||meta.size>(a.kind==="video"?120:20)*1024*1024)throw Error("File is empty or too large.");
 const type=meta.contentType??"";if(a.kind!=="video"&&!(["application/pdf","image/jpeg","image/png","image/webp"].includes(type)))throw Error("Use PDF, JPG, PNG or WebP documents.");
 if(a.kind==="script"&&type!=="application/pdf")throw Error("Upload the script as PDF.");
 const id=await ctx.db.insert("film_fund_uploads",{accountId:account._id,projectId:p._id,kind:a.kind,storageId:a.storageId,name:a.name.slice(0,150),size:meta.size,contentType:type,sha256:meta.sha256,createdAt:Date.now(),...(a.durationSeconds?{durationSeconds:a.durationSeconds}:{})});
 const patch:any={updatedAt:Date.now()};if(a.kind==="document"){if(p.documentIds.length>=10)throw Error("Maximum 10 supporting documents.");patch.documentIds=[...p.documentIds,id];}else patch[a.kind==="script"?"scriptId":a.kind==="moodboard"?"moodboardId":"videoId"]=id;
 await ctx.db.patch(p._id,patch);return id;
}
export const videoContext=internalQuery({args:{token:v.string(),projectId:v.id("film_fund_projects"),storageId:v.id("_storage")},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token),p=await ctx.db.get(a.projectId);if(!account||!p||p.accountId!==account._id||p.state!=="draft")throw Error("Application upload is not available.");
 const meta=await ctx.db.system.get(a.storageId);if(!meta||meta.size>120*1024*1024||meta.contentType!=="video/mp4")throw Error("Use an MP4 pitch video under 120 MB.");
 return {url:await ctx.storage.getUrl(a.storageId)};
}});
export const attachVideo=internalMutation({args:{token:v.string(),projectId:v.id("film_fund_projects"),storageId:v.id("_storage"),name:v.string(),durationSeconds:v.number()},handler:async(ctx,a)=>{if(a.durationSeconds<55||a.durationSeconds>65)throw Error("Pitch video must be one minute (55–65 seconds).");return attach(ctx,{...a,kind:"video"});}});
export const submit=mutation({args:{token:v.string(),projectId:v.id("film_fund_projects"),roundSlug:v.string(),termsVersion:v.string()},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token),p=await ctx.db.get(a.projectId);if(!account||!p||p.accountId!==account._id)throw Error("Application not found.");
 if(p.state==="submitted")return {submitted:true};
 const round=(await rounds(ctx)).find((r:any)=>r.slug===a.roundSlug);if(!round||round.state!=="open"||Date.now()<round.opensAt||Date.now()>round.deadline)throw Error("Film Fund applications are coming soon. No entries are accepted yet.");
 if(a.termsVersion!==FILM_FUND_TERMS_VERSION)throw Error("Accept the current Film Fund terms.");
 const errors=fundSubmissionErrors(p);if(errors.length)throw Error(errors.join(" "));
 for(const id of [p.scriptId,p.moodboardId,p.videoId,...p.documentIds]){const upload=id?await ctx.db.get(id):null;if(!upload||upload.projectId!==p._id||upload.accountId!==account._id)throw Error("Re-upload missing application files.");if(upload.kind==="video"&&(!upload.durationSeconds||upload.durationSeconds<55||upload.durationSeconds>65))throw Error("Verify the one-minute pitch video.");}
 const included=isProPlus(account.membershipTier,membershipActiveNow(account));if(!included&&(!p.entryPaid||p.entryRoundSlug!==a.roundSlug))throw Error("A single £15 project entry payment is required for this round.");
 await ctx.db.patch(p._id,{state:"submitted",roundSlug:a.roundSlug,submittedAt:Date.now(),termsVersion:a.termsVersion,entryIncluded:included,reviewStatus:"new",updatedAt:Date.now()});return {submitted:true};
}});
export const adminOverview=query({args:{token:v.string()},handler:async(ctx,{token})=>{if(!checkAdminToken(token))return null;const signups=await ctx.db.query("film_fund_signups").collect();const projects=await ctx.db.query("film_fund_projects").collect();return{signupCount:signups.filter(s=>s.active).length,rounds:await rounds(ctx),projects:projects.filter(p=>p.state==="submitted")};}});
export const adminApplication=query({args:{token:v.string(),projectId:v.id("film_fund_projects")},handler:async(ctx,a)=>{
 if(!checkAdminToken(a.token))return null;
 const p=await ctx.db.get(a.projectId);if(!p||p.state!=="submitted")return null;
 const files=await Promise.all([p.scriptId,p.moodboardId,p.videoId,...p.documentIds].filter(Boolean).map(async id=>{const f=await ctx.db.get(id!);if(!f||f.projectId!==p._id||f.accountId!==p.accountId)return null;return {id:f._id,name:f.name,kind:f.kind,url:await ctx.storage.getUrl(f.storageId),durationSeconds:f.durationSeconds};}));
 const account=await ctx.db.get(p.accountId);
 return {project:p,applicantEmail:account?.email,files:files.filter(f=>f!==null)};
}});
export const reviewApplication=mutation({args:{token:v.string(),projectId:v.id("film_fund_projects"),status:v.union(v.literal("new"),v.literal("shortlisted"),v.literal("winner"),v.literal("runner_up"),v.literal("not_selected")),note:v.string()},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,"filmFund.reviewApplication");const p=await ctx.db.get(a.projectId);
 if(!p||p.state!=="submitted"||!p.roundSlug)throw Error("Only submitted applications can be reviewed.");
 if(a.note.length>4000)throw Error("Keep the review note under 4,000 characters.");
 if(["winner","runner_up"].includes(a.status)){
  const peers=await ctx.db.query("film_fund_projects").withIndex("by_round",q=>q.eq("roundSlug",p.roundSlug)).collect();
  if(peers.some(row=>row._id!==p._id&&row.reviewStatus===a.status))throw Error("This round already has that prize selected. Clear the previous selection first.");
 }
 await ctx.db.patch(p._id,{reviewStatus:a.status,reviewNote:a.note.trim(),updatedAt:Date.now()});return {saved:true};
}});
export const setRound=mutation({args:{token:v.string(),slug:v.string(),opensAt:v.number(),deadline:v.number(),announcementAt:v.number()},handler:async(ctx,a)=>{await assertAdmin(ctx,a.token,"filmFund.setRound");const base=FUND_ROUNDS.find(r=>r.slug===a.slug);if(!base||!Number.isSafeInteger(a.opensAt)||a.deadline<=a.opensAt||a.announcementAt<=a.deadline)throw Error("Use valid round dates in order.");const row=await ctx.db.query("film_fund_rounds").withIndex("by_slug",q=>q.eq("slug",a.slug)).unique();const data={slug:a.slug,name:base.name,state:"coming_soon" as const,opensAt:a.opensAt,deadline:a.deadline,announcementAt:a.announcementAt,updatedAt:Date.now()};if(row)await ctx.db.patch(row._id,data);else await ctx.db.insert("film_fund_rounds",data);return {saved:true};}});
