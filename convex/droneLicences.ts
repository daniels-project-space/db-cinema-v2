import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { accountForRental } from "./lib/rentalAccount";
import { requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { verificationCanStart } from "../shared/verificationProgress";
import { queueOwnerNotification } from "./lib/adminPush";
import { saveDroneCopy } from "./droneArchive";
import { archiveRetention, documentCopyAvailable } from "./verificationArchive";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { DRONE_DOCUMENT_LIMIT } from "./lib/droneDocument";

const access = { bookingId: v.id("bookings"), token: v.optional(v.string()), checkoutSessionId: v.optional(v.string()) };
async function renterBooking(ctx: any, args: any) {
  const booking = await ctx.db.get(args.bookingId);
  if (!booking) throw Error("Rental not found.");
  const account = args.token ? await accountForToken(ctx, args.token, true) : null;
  if (args.token && !account) throw Error("Sign in again to upload your licence.");
  if (account) await ownedBooking(ctx, account, booking._id);
  else if (!args.checkoutSessionId || args.checkoutSessionId !== booking.stripeCheckoutSessionId) throw Error("Sign in to the account linked to this rental.");
  if (booking.status !== "confirmed" || !verificationCanStart(booking)) throw Error("Upload documents after payment, before collection.");
  if (!await requiresDroneLicence(ctx, booking)) throw Error("This rental does not require a drone licence.");
  if (await droneLicenceStatusForRental(ctx, booking) === "approved") throw Error("The licence is already approved. Ask the team to reopen review.");
  const owner = account ?? await accountForRental(ctx, booking);
  if (!owner || owner.blockedAt != null) throw Error("Sign in to the account linked to this rental.");
  return {booking,account:owner};
}

// Only the authenticated HTTP upload can bind fresh server-stored bytes.
// A public storage-ID submission would allow another account's file to be attached.
export const uploadAccess = internalQuery({args:access,handler:renterBooking});
export const saveUpload = internalMutation({args:{...access,storageId:v.id("_storage"),sha256:v.string(),contentType:v.string(),size:v.number()},handler:async(ctx,args)=>{
  const {booking,account}=await renterBooking(ctx,args);
  const metadata=await ctx.db.system.get(args.storageId);
  if(!metadata || metadata.size!==args.size || args.size>DRONE_DOCUMENT_LIMIT || !args.size || metadata.contentType!==args.contentType || !/^[a-f0-9]{64}$/.test(args.sha256))throw Error("Uploaded document could not be verified.");
  const now=Date.now();
  const documentId=await saveDroneCopy(ctx,booking,account,{storageId:args.storageId,sha256:args.sha256,size:args.size,contentType:args.contentType});
  await ctx.db.patch(booking._id,{accountId:account._id,droneLicenceStorageId:args.storageId,droneLicenceDocumentId:documentId,droneLicenceStatus:"review",droneLicenceUploadedAt:now,droneLicenceReviewedAt:undefined,droneLicenceNote:undefined});
  await postRentalMessage(ctx,{accountId:account._id,bookingId:booking._id,sender:"system",text:"Your drone operator document is saved. The team will review it before handover."});
  await queueOwnerNotification(ctx,{eventKey:`drone-document:${documentId}`,kind:"drone_document",accountId:account._id,bookingId:booking._id,title:"Drone licence ready for review",body:"A renter uploaded their operator evidence. Open the rental to review the private document."});
  return {documentId};
}});
export const adminDetails=query({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  if(!checkAdminToken(args.token))throw Error("unauthorized");
  const booking=await ctx.db.get(args.bookingId);
  if(!booking || !await requiresDroneLicence(ctx,booking))return null;
  const document=booking.droneLicenceDocumentId?await ctx.db.get(booking.droneLicenceDocumentId):null;
  const archive=document?await ctx.db.get(document.archiveId):null;
  const retention=archive?await archiveRetention(ctx,archive):null;
  const available=!!document && !!archive && !!retention?.viewable && await documentCopyAvailable(ctx,archive,document);
  return {status:await droneLicenceStatusForRental(ctx,booking),note:booking.droneLicenceNote,documentId:available?document!._id:null,expiresAt:retention?.expiresAt??null,legacy:!!booking.droneLicenceStorageId&&!booking.droneLicenceDocumentId,canReview:booking.status==="confirmed"&&verificationCanStart(booking)};
}});
export const archiveExisting=mutation({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  await assertAdmin(ctx,args.token,"droneLicences.archiveExisting");
  const booking=await ctx.db.get(args.bookingId);
  if(!booking?.droneLicenceStorageId)throw Error("No uploaded licence exists.");
  await ctx.scheduler.runAfter(0,internal.droneArchive.captureLegacy,{bookingId:booking._id});
}});
export const review=mutation({args:{token:v.string(),bookingId:v.id("bookings"),documentId:v.id("verification_documents"),decision:v.union(v.literal("approved"),v.literal("requires_input")),note:v.string()},handler:async(ctx,args)=>{
  await assertAdmin(ctx,args.token,"droneLicences.review");
  const booking=await ctx.db.get(args.bookingId);
  if(!booking || booking.status!=="confirmed" || !verificationCanStart(booking) || !await requiresDroneLicence(ctx,booking))throw Error("This rental cannot be reviewed.");
  if(booking.droneLicenceDocumentId!==args.documentId)throw Error("The uploaded licence changed. Open the latest document before reviewing it.");
  if(!booking.droneLicenceStorageId || !booking.droneLicenceDocumentId)throw Error("The renter must upload their licence first.");
  if(args.note.trim().length<10)throw Error("Record what was checked or why a replacement is required.");
  const account=await accountForRental(ctx,booking);
  if(!account)throw Error("This rental must be linked to its account.");
  const document=await ctx.db.get(booking.droneLicenceDocumentId),archive=document?await ctx.db.get(document.archiveId):null;
  if(!document || document.bookingId!==booking._id || document.accountId!==account._id || document.storageId!==booking.droneLicenceStorageId || !archive || !(await archiveRetention(ctx,archive)).viewable)throw Error("The operator document must be privately archived for this rental before review.");
  if(args.decision==="approved" && !await documentCopyAvailable(ctx,archive,document))throw Error("The saved licence copy is missing or invalid. Ask the renter to upload a new copy before approval.");
  const note=args.note.trim().slice(0,2000);
  if(booking.droneLicenceStatus===args.decision && booking.droneLicenceNote===note)return;
  await ctx.db.patch(booking._id,{droneLicenceStatus:args.decision,droneLicenceNote:note,droneLicenceReviewedAt:Date.now()});
  await queueRmv2Sync(ctx,booking._id);
  await postRentalMessage(ctx,{accountId:account._id,bookingId:booking._id,sender:"system",text:args.decision==="approved"?`Your drone operator evidence has been approved. Team review: ${note}`:`Please replace your drone operator document. Team review: ${note}`});
}});
