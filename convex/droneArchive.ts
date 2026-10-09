import { internalAction, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForRental } from "./lib/rentalAccount";
import { archiveRetention } from "./verificationArchive";
import { droneDocumentType } from "./lib/droneDocument";

/** Keep each submitted revision, with the same private account archive and
 * closure/insurance retention as the other rental documents. */
export async function saveDroneCopy(ctx:any,booking:any,account:any,file:{storageId:any;sha256:string;size:number;contentType:string}) {
  const sessionId=`drone:${booking._id}`;
  const archives=await ctx.db.query("verification_archives").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).collect();
  const archive=archives.find((a:any)=>a.sessionId===sessionId);
  if(!(await archiveRetention(ctx,archive??{bookingId:booking._id,source:"drone",status:"complete"})).viewable)throw Error("Document retention period ended.");
  if(archive && archive.accountId!==account._id)throw Error("Document account binding changed.");
  const now=Date.now();
  const archiveId=archive?archive._id:await ctx.db.insert("verification_archives",{bookingId:booking._id,accountId:account._id,sessionId,email:account.email,source:"drone",status:"complete",attempts:0,dueAt:now,createdAt:now,completedAt:now});
  const documents=await ctx.db.query("verification_documents").withIndex("by_archive",(q:any)=>q.eq("archiveId",archiveId)).collect();
  const existing=documents.find((d:any)=>d.storageId===file.storageId);
  if(existing)return existing._id;
  return ctx.db.insert("verification_documents",{archiveId,bookingId:booking._id,accountId:account._id,sessionId,kind:"drone-operator-licence",storageId:file.storageId,sha256:file.sha256,size:file.size,contentType:file.contentType,savedAt:now});
}
export const legacyContext=internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId}):Promise<any>=>{
  const booking=await ctx.db.get(bookingId);
  if(!booking?.droneLicenceStorageId || booking.droneLicenceDocumentId)return null;
  const account=await accountForRental(ctx,booking);
  if(!account || !(await archiveRetention(ctx,{bookingId,source:"drone",status:"complete"})).viewable)return null;
  return {storageId:booking.droneLicenceStorageId};
}});
export const saveLegacy=internalMutation({args:{bookingId:v.id("bookings"),storageId:v.id("_storage"),sha256:v.string(),size:v.number(),contentType:v.string()},handler:async(ctx,args):Promise<void>=>{
  const booking=await ctx.db.get(args.bookingId);
  if(!booking || booking.droneLicenceStorageId!==args.storageId || booking.droneLicenceDocumentId)return;
  const account=await accountForRental(ctx,booking);
  if(!account)return;
  const documentId=await saveDroneCopy(ctx,booking,account,{storageId:args.storageId,sha256:args.sha256,size:args.size,contentType:args.contentType});
  await ctx.db.patch(booking._id,{accountId:account._id,droneLicenceDocumentId:documentId});
}});
export const captureLegacy=internalAction({args:{bookingId:v.id("bookings")},handler:async(ctx,args):Promise<void>=>{
  const context=await ctx.runQuery(internal.droneArchive.legacyContext,args);
  if(!context)return;
  const blob=await ctx.storage.get(context.storageId);
  if(!blob)return;
  const bytes=new Uint8Array(await blob.arrayBuffer()),contentType=droneDocumentType(bytes,blob.type);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
  await ctx.runMutation(internal.droneArchive.saveLegacy,{...args,storageId:context.storageId,sha256,size:bytes.length,contentType});
}});
