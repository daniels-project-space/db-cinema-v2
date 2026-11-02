import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForRental } from "./lib/rentalAccount";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { linkVerificationCopies } from "./lib/verificationOwnership";
import { queueOwnerNotification } from "./lib/adminPush";
import { deletePrivateFile } from "./lib/privateStorage";
import { verificationReadSnapshot } from "./lib/verificationReadProof";
import { saveAccountDiditVerification } from "./lib/verificationReuse";

const DOCUMENT_RETENTION_MS = 90 * 86400000;
const CAPTURE_LEASE_MS = 5 * 60000;
const READ_PROOF_MAX_AGE_MS=24*3600000;
const READ_PROOF_INTERVAL_MS=12*3600000;
function hasFreshReadProof(archive:any){return archive.supplementalAssetsPending!==true&&(archive.supplementalStatus==="complete"||archive.supplementalCheckVersion===2)&&archive.readProofVersion===2&&Number.isFinite(archive.readVerifiedAt)&&archive.readVerifiedAt<=Date.now()&&archive.readVerifiedAt>Date.now()-READ_PROOF_MAX_AGE_MS;}
async function flagArchiveFailure(ctx:any,archive:any){
 const booking=await ctx.db.get(archive.bookingId),account=await accountForRental(ctx,booking);
 await queueOwnerNotification(ctx,{eventKey:`verification-archive-failed:${archive._id}:${archive.generation??0}`,kind:"verification_archive",...(account?{accountId:account._id}:{}),bookingId:archive.bookingId,
  title:"Verification documents need attention",body:"Document copying could not finish after repeated attempts. Open this rental and retry its account document archive. Handover remains blocked."});
}
async function flagSupplementalFailure(ctx:any,archive:any){
 const booking=await ctx.db.get(archive.bookingId),account=await accountForRental(ctx,booking);
 await queueOwnerNotification(ctx,{eventKey:`verification-images-failed:${archive._id}:${archive.supplementalGeneration??0}`,kind:"verification_archive",...(account?{accountId:account._id}:{}),bookingId:archive.bookingId,title:"Verification images need attention",body:"Some additional provider images could not be saved. Review this rental's documents."});
}
function rentalClosedAt(booking: any): number | undefined {
  return booking?.status === "returned" ? booking.returnedAt : booking?.status === "cancelled" ? booking.cancelledAt : undefined;
}

/** One retention decision shared by the admin screen and byte deletion. */
export async function archiveRetention(ctx: any, archive: any) {
  if (archive.status === "deleted") return { status: "deleted" as const, expiresAt: null, activeRentals: 0, openCases: 0, viewable: false };
  const booking = await ctx.db.get(archive.bookingId);
  const reused = archive.source === "drone" ? [] : await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", archive.bookingId)).collect();
  const rentals = [booking, ...reused].filter(Boolean);
  const activeRentals = rentals.filter((b: any) => !["returned", "cancelled"].includes(b.status)).length;
  let openCases = 0;
  for (const id of [archive.bookingId, ...reused.map((b: any) => b._id)]) {
    const cases = await ctx.db.query("rental_damage_cases").withIndex("by_booking", (q: any) => q.eq("bookingId", id)).collect();
    openCases += cases.filter((c: any) => c.status === "open").length;
  }
  const base = { expiresAt: null as number | null, activeRentals, openCases, viewable: true };
  if (activeRentals) return { ...base, status: "active-rental" as const };
  if (openCases) return { ...base, status: "insurance-case" as const };
  if (archive.retentionHoldReason) return { ...base, status: "manual-hold" as const };
  if (!booking || rentals.some((b: any) => !rentalClosedAt(b))) return { ...base, status: "unknown-closure" as const };
  const expiresAt = Math.max(...rentals.map((b: any) => rentalClosedAt(b)!)) + DOCUMENT_RETENTION_MS;
  return { ...base, status: "expires" as const, expiresAt, viewable: expiresAt > Date.now() };
}

export async function queueVerificationArchive(ctx: any, booking: any,refresh=false) {
  if (!booking.diditSessionId) return;
  const account = await accountForRental(ctx, booking);
  if (account) await linkVerificationCopies(ctx, booking._id, account._id);
  const existing = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const previous = existing.find((a: any) => a.sessionId === booking.diditSessionId);
  if (previous) {
    if (previous.status === "deleted" || !(await archiveRetention(ctx,previous)).viewable) return;
    if(!refresh)return;
    // A new provider event invalidates an older in-flight report. Its worker
    // must not save stale bytes or declare the newer revision complete.
    await ctx.db.patch(previous._id, { status: "pending", attempts: 0, dueAt: Date.now(),
      generation:(previous.generation??0)+1,leaseUntil:undefined,error:undefined });
    await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId: previous._id });
    return;
  }
  const archiveId = await ctx.db.insert("verification_archives", { bookingId: booking._id, accountId: account?._id, sessionId: booking.diditSessionId, source:"didit", email: booking.guestEmail ?? account?.email ?? "", status: "pending", attempts: 0, dueAt: Date.now(), createdAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId });
}
/** Private metadata checks subscribe to the real storage objects; no file URLs
 * or document bytes are exposed by these reactive readiness queries. */
async function archiveOwnerMatches(ctx: any, archive: any) {
  const booking = await ctx.db.get(archive.bookingId);
  // Preserve private insurance access for archives with an unknown closure.
  if (!booking) return true;
  const accountId = booking.accountId ?? (await accountForRental(ctx, booking))?._id;
  return archive.accountId === accountId;
}
export async function documentCopyAvailable(ctx: any, archive: any, document: any, ownerMatches?: boolean) {
  if (document.archiveId !== archive._id || document.bookingId !== archive.bookingId ||
      document.sessionId !== archive.sessionId || document.accountId !== archive.accountId ||
      !Number.isSafeInteger(document.size) || document.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(document.sha256) ||
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(document.contentType)) return false;
  if (!(ownerMatches ?? await archiveOwnerMatches(ctx, archive))) return false;
  // System metadata uses base64; legacy metadata APIs can return hexadecimal.
  const encodedHash = btoa(String.fromCharCode(...document.sha256.match(/../g).map((byte: string) => parseInt(byte, 16))));
  const metadata = await ctx.db.system.get(document.storageId);
  return !!metadata && metadata.size === document.size &&
    (metadata.sha256 === document.sha256 || metadata.sha256 === encodedHash) &&
    metadata.contentType === document.contentType;
}
async function archiveCopies(ctx: any, archive: any, adminView=false) {
  const query = ctx.db.query("verification_documents").withIndex("by_archive", (q: any) => q.eq("archiveId", archive._id));
  const documents = adminView ? await query.collect() : await query.take(31);
  if(!adminView && documents.length>30)return {copies:[],ready:false};
  const ownerMatches = await archiveOwnerMatches(ctx, archive);
  const copies = await Promise.all(documents.map(async (document: any) => ({ document, available: await documentCopyAvailable(ctx, archive, document, ownerMatches) })));
  const required = archive.source === "drone"
    ? documents.some((d: any) => d.kind === "drone-operator-licence")
    : documents.some((d: any) => d.kind.startsWith("identity-")) && documents.some((d: any) => d.kind.startsWith("address-"));
  return { copies, ready: documents.length<=30 && required && copies.every(copy => copy.available) };
}
function requiredReadDocuments(copies:any){
  const documents=copies.copies.map((copy:any)=>copy.document)
    .sort((left:any,right:any)=>left.kind.localeCompare(right.kind)||String(left._id).localeCompare(String(right._id)));
  if(documents.length>30||!documents.some((document:any)=>document.kind.startsWith("identity-"))||!documents.some((document:any)=>document.kind.startsWith("address-")))return null;
  return documents.map((document:any)=>({storageId:document.storageId,sha256:document.sha256,size:document.size,contentType:document.contentType}));
}
export async function assertVerificationArchive(ctx: any, booking: any) {
  const source = booking.verificationReusedFrom ? await ctx.db.get(booking.verificationReusedFrom) : booking;
  if (!source?.diditSessionId) return;
  const archives = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", source._id)).collect();
  // A completed copy can already be outside retention while the deletion job
  // is still pending. Do not reuse it and thereby revive expired documents.
  for (const archive of archives) {
    const retention=await archiveRetention(ctx,archive);
    if (archive.sessionId === source.diditSessionId && archive.status === "complete" && hasFreshReadProof(archive) &&
        retention.viewable && (await archiveCopies(ctx, archive)).ready) return Math.min(archive.readVerifiedAt!+READ_PROOF_MAX_AGE_MS,retention.expiresAt??Number.MAX_SAFE_INTEGER);
  }
  throw Error("Verification document copies must be fully archived and within their retention period before handover. Check account documents or complete a new verification.");
}
export const reuseReadCandidate=internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
  const booking=await ctx.db.get(bookingId);if(!booking?.diditSessionId)return null;
  const archives=await ctx.db.query("verification_archives").withIndex("by_booking",query=>query.eq("bookingId",bookingId)).collect();
  for(const archive of archives){
    if(archive.sessionId!==booking.diditSessionId||archive.status!=="complete"||!(await archiveRetention(ctx,archive)).viewable)continue;
    const copies=await archiveCopies(ctx,archive);if(!copies.ready)continue;
    const documents=requiredReadDocuments(copies);
    if(documents)return {archiveId:archive._id,generation:archive.generation??0,readVerifiedAt:archive.readVerifiedAt??null,documents};
  }
  return null;
}});
export const readProofCandidate=internalQuery({args:{archiveId:v.id("verification_archives"),proofGeneration:v.number()},handler:async(ctx,args)=>{
  const archive=await ctx.db.get(args.archiveId);
  if(!archive||archive.status!=="complete"||archive.readProofGeneration!==args.proofGeneration||(archive.readProofDueAt??0)<=Date.now()||!(await archiveRetention(ctx,archive)).viewable)return null;
  const copies=await archiveCopies(ctx,archive);if(!copies.ready)return null;
  const documents=requiredReadDocuments(copies);if(!documents)return null;
  return {archiveId:archive._id,generation:archive.generation??0,documents};
}});
async function failReadProof(ctx:any,archive:any){
  const failures=(archive.readProofFailures??0)+1,attention=failures>=8;
  await ctx.db.patch(archive._id,{status:attention?"attention":"complete",readVerifiedAt:undefined,readProofFailures:failures,readProofDueAt:Date.now()+Math.min(3600000,60000*2**Math.min(failures-1,6)),error:"Required verification copies could not be read or checked."});
  if(!attention)return;
  const booking=await ctx.db.get(archive.bookingId),account=await accountForRental(ctx,booking);
  await queueOwnerNotification(ctx,{eventKey:`verification-proof-failed:${archive._id}:${archive.generation??0}`,kind:"verification_archive",...(account?{accountId:account._id}:{}),bookingId:archive.bookingId,title:"Verification document check failed",body:"Required saved verification copies repeatedly failed a private read or integrity check. Review them before relying on verification."});
}
export const reuseReadFailure=internalMutation({args:{archiveId:v.id("verification_archives"),generation:v.number(),proofGeneration:v.optional(v.number()),expectedVerifiedAt:v.optional(v.union(v.number(),v.null()))},handler:async(ctx,args)=>{
  const archive=await ctx.db.get(args.archiveId);
  if(!archive||archive.status!=="complete"||(archive.generation??0)!==args.generation||args.proofGeneration!==undefined&&archive.readProofGeneration!==args.proofGeneration||args.expectedVerifiedAt!==undefined&&(archive.readVerifiedAt??null)!==args.expectedVerifiedAt)return;
  await failReadProof(ctx,archive);
}});
export const readProofUnavailable=internalMutation({args:{archiveId:v.id("verification_archives"),proofGeneration:v.number()},handler:async(ctx,args)=>{
  const archive=await ctx.db.get(args.archiveId);
  if(!archive||archive.status!=="complete"||archive.readProofGeneration!==args.proofGeneration||(archive.readProofDueAt??0)<=Date.now())return;
  await failReadProof(ctx,archive);
}});
export const context = internalQuery({ args: { archiveId: v.id("verification_archives") }, handler: async (ctx, { archiveId }) => {
  const archive = await ctx.db.get(archiveId);
  if (!archive) return null;
  return { ...archive, documents: await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archiveId)).collect() };
} });
export const scheduleReadProofs=internalMutation({args:{},handler:async ctx=>{
  const now=Date.now();
  const legacyQuery=()=>ctx.db.query("verification_archives").withIndex("by_status_read_version",query=>query.eq("status","complete").eq("readProofVersion",undefined));
  const dueQuery=()=>ctx.db.query("verification_archives").withIndex("by_status_read_proof",query=>query.eq("status","complete").gte("readProofDueAt",0).lte("readProofDueAt",now));
  const [legacy,due]=await Promise.all([legacyQuery().take(20),dueQuery().take(20)]);
  if(due[0]&&now-(due[0].readProofDueAt??now)>6*3600000)await queueOwnerNotification(ctx,{eventKey:`verification-proof-backlog:${Math.floor(now/86400000)}`,kind:"verification_archive",title:"Verification document checks are delayed",body:"Private document integrity checks are behind schedule. Some verification badges may be temporarily unavailable; review the archive worker capacity."});
  const rows:any[]=[],selected=new Set<string>();
  const add=(archive:any)=>{if(rows.length<20&&!selected.has(String(archive._id))){selected.add(String(archive._id));rows.push(archive);}};
  legacy.slice(0,10).forEach(add);due.forEach(add);legacy.forEach(add);
  for(const archive of rows){
    if(archive.readProofVersion!==undefined&&(archive.readProofDueAt??0)>now)continue;
    if(archive.source==="drone"||!(await archiveRetention(ctx,archive)).viewable){await ctx.db.patch(archive._id,{readProofVersion:1,readProofDueAt:now+READ_PROOF_MAX_AGE_MS});continue;}
    const proofGeneration=(archive.readProofGeneration??0)+1;
    const legacySupplemental=archive.supplementalCheckVersion===undefined&&archive.supplementalStatus!=="complete";
    await ctx.db.patch(archive._id,{readProofVersion:archive.readProofVersion??1,readProofGeneration:proofGeneration,readProofDueAt:now+CAPTURE_LEASE_MS,...(legacySupplemental?{supplementalCheckVersion:1,supplementalStatus:"pending",supplementalAttempts:0,supplementalDueAt:now,supplementalGeneration:(archive.supplementalGeneration??0)+1,supplementalLeaseUntil:undefined}: {})});
    await ctx.scheduler.runAfter(0,internal.verificationArchiveWorker.checkReadability,{archiveId:archive._id,proofGeneration});
  }
}});
export const recordReadProof=internalMutation({args:{archiveId:v.id("verification_archives"),generation:v.number(),proofGeneration:v.number(),snapshot:v.string()},handler:async(ctx,args)=>{
  const archive=await ctx.db.get(args.archiveId);
  if(!archive||archive.status!=="complete"||(archive.generation??0)!==args.generation||archive.readProofGeneration!==args.proofGeneration||(archive.readProofDueAt??0)<=Date.now()||!(await archiveRetention(ctx,archive)).viewable)return false;
  const copies=await archiveCopies(ctx,archive);if(!copies.ready)return false;
  const documents=requiredReadDocuments(copies);if(!documents)return false;
  const snapshot=verificationReadSnapshot(documents);
  if(snapshot!==args.snapshot)return false;
  const wasFresh=hasFreshReadProof(archive);
  await ctx.db.patch(archive._id,{readProofVersion:2,readVerifiedAt:Date.now(),readProofDueAt:Date.now()+READ_PROOF_INTERVAL_MS,readProofFailures:0,error:undefined});
  const booking=await ctx.db.get(archive.bookingId);
  if(process.env.VERIFICATION_ARCHIVE_REUSE_ENABLED==="true" && booking && booking.accountAccessRequired===false && booking.accountId===archive.accountId && booking.diditSessionId===archive.sessionId && booking.idVerifyStatus==="verified" && booking.idVerificationSource==="didit" && booking.idVerifiedAt)
    await saveAccountDiditVerification(ctx,booking,booking.idVerifiedAt,booking.documentExpiresAt,booking.verificationChecks,booking.renterPersonKey);
  if(!wasFresh&&archive.accountId)await ctx.scheduler.runAfter(0,internal.verificationArchive.resumeReuses,{accountId:archive.accountId,sourceBookingId:archive.bookingId,cursor:null});
  return true;
}});
export const resumeReuses=internalMutation({args:{accountId:v.id("accounts"),sourceBookingId:v.id("bookings"),cursor:v.union(v.string(),v.null())},handler:async(ctx,args)=>{
  const account=await ctx.db.get(args.accountId);
  if(!account||account.rentalVerification?.sourceBookingId!==args.sourceBookingId)return;
  const page=await ctx.db.query("bookings").withIndex("by_account_status",query=>query.eq("accountId",args.accountId).eq("status","confirmed")).paginate({numItems:20,cursor:args.cursor});
  let scheduled=0;
  for(const booking of page.page)if(booking.accountAccessRequired===false&&booking.verificationProvider==="didit"&&booking.idVerifyStatus==="required"&&!booking.diditSessionId){
    await ctx.scheduler.runAfter(scheduled++*250,internal.didit.reuseVerification,{bookingId:booking._id});
  }
  if(!page.isDone)await ctx.scheduler.runAfter(5000,internal.verificationArchive.resumeReuses,{...args,cursor:page.continueCursor});
}});
export const claim=internalMutation({args:{archiveId:v.id("verification_archives")},handler:async(ctx,{archiveId})=>{
 const archive=await ctx.db.get(archiveId),now=Date.now();
 if(!archive || archive.source==="drone" || archive.status!=="pending" || archive.dueAt>now || (archive.leaseUntil??0)>now || !(await archiveRetention(ctx,archive)).viewable)return null;
 if(archive.attempts>=12){await ctx.db.patch(archiveId,{status:"attention",leaseUntil:undefined,error:"Document copying could not finish. Retry the archive from account documents."});await flagArchiveFailure(ctx,archive);return null;}
 const patch={generation:(archive.generation??0)+1,leaseUntil:now+CAPTURE_LEASE_MS,dueAt:now+CAPTURE_LEASE_MS,attempts:archive.attempts+1};
 await ctx.db.patch(archiveId,patch);
 return {...archive,...patch,documents:await ctx.db.query("verification_documents").withIndex("by_archive",q=>q.eq("archiveId",archiveId)).collect()};
}});
export const claimSupplemental=internalMutation({args:{archiveId:v.id("verification_archives")},handler:async(ctx,{archiveId})=>{
 const archive=await ctx.db.get(archiveId),now=Date.now();
 if(!archive||archive.supplementalStatus!=="pending"||(archive.supplementalDueAt??0)>now||(archive.supplementalLeaseUntil??0)>now)return null;
 if(archive.source==="drone"||archive.status!=="complete"||!(await archiveRetention(ctx,archive)).viewable){await ctx.db.patch(archiveId,{supplementalStatus:"attention",supplementalError:"Image recovery paused; review the main archive and retention."});return null;}
 if((archive.supplementalAttempts??0)>=12){await ctx.db.patch(archiveId,{supplementalStatus:"attention",supplementalLeaseUntil:undefined,supplementalError:"Additional verification images could not be copied."});await flagSupplementalFailure(ctx,archive);return null;}
 const patch={supplementalGeneration:(archive.supplementalGeneration??0)+1,supplementalLeaseUntil:now+CAPTURE_LEASE_MS,supplementalDueAt:now+CAPTURE_LEASE_MS,supplementalAttempts:(archive.supplementalAttempts??0)+1};
 await ctx.db.patch(archiveId,patch);
 return {...archive,...patch,generation:patch.supplementalGeneration,documents:await ctx.db.query("verification_documents").withIndex("by_archive",q=>q.eq("archiveId",archiveId)).collect()};
}});
export const save = internalMutation({ args: { archiveId: v.id("verification_archives"), generation:v.number(),kind: v.string(), storageId: v.id("_storage"), sha256: v.string(), size: v.number(), contentType: v.string(), replaceStorageId: v.optional(v.id("_storage")),supplemental:v.optional(v.boolean()) }, handler: async (ctx, args) => {
  const archive = await ctx.db.get(args.archiveId);
  const validLease=archive && (args.supplemental ? archive.status==="complete" && archive.supplementalStatus==="pending" && archive.supplementalGeneration===args.generation && (archive.supplementalLeaseUntil??0)>Date.now() && /^(selfie-|face-match-|id-extra-)/.test(args.kind) : archive.status==="pending" && archive.generation===args.generation && (archive.leaseUntil??0)>Date.now());
  if (!archive || !validLease || !(await archiveRetention(ctx,archive)).viewable) { await deletePrivateFile(ctx,args.storageId); return false; }
  const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", args.archiveId)).take(31);
  const existing = documents.find(d => d.kind === args.kind && d.sha256 === args.sha256);
  if (existing) {
    if (args.replaceStorageId === existing.storageId) {
      const replacedStorageId = existing.storageId;
      await ctx.db.patch(existing._id, { storageId: args.storageId, size: args.size, contentType: args.contentType });
      if(args.supplemental)await ctx.db.patch(archive._id,{readVerifiedAt:undefined,readProofGeneration:(archive.readProofGeneration??0)+1,readProofDueAt:Date.now()});
      await deletePrivateFile(ctx,replacedStorageId);
    } else await deletePrivateFile(ctx,args.storageId);
    return true;
  }
  if(documents.length>=30){await deletePrivateFile(ctx,args.storageId);return false;}
  const { replaceStorageId: _replaceStorageId,generation:_generation,supplemental:_supplemental, ...document } = args;
  await ctx.db.insert("verification_documents", { ...document, bookingId: archive.bookingId, accountId: archive.accountId, sessionId: archive.sessionId, savedAt: Date.now() });
  if(args.supplemental)await ctx.db.patch(archive._id,{readVerifiedAt:undefined,readProofGeneration:(archive.readProofGeneration??0)+1,readProofDueAt:Date.now()});
  return true;
} });
export const markSupplementalExpected=internalMutation({args:{archiveId:v.id("verification_archives"),generation:v.number(),kinds:v.array(v.string())},handler:async(ctx,args)=>{
 const archive=await ctx.db.get(args.archiveId);
 if(!archive||archive.status!=="complete"||archive.supplementalStatus!=="pending"||archive.supplementalGeneration!==args.generation||(archive.supplementalLeaseUntil??0)<=Date.now()||args.kinds.length>30||!(await archiveRetention(ctx,archive)).viewable)return false;
 if(args.kinds.length)await ctx.db.patch(archive._id,{supplementalAssetsPending:true,readVerifiedAt:undefined,readProofGeneration:(archive.readProofGeneration??0)+1,readProofDueAt:Date.now()});
 return true;
}});
export const finishSupplemental=internalMutation({args:{archiveId:v.id("verification_archives"),generation:v.number(),complete:v.boolean(),observedKinds:v.optional(v.array(v.string())),observedSaved:v.optional(v.boolean()),observedResponse:v.optional(v.boolean())},handler:async(ctx,args)=>{
 const archive=await ctx.db.get(args.archiveId);
 if(!archive||archive.status!=="complete"||archive.supplementalStatus!=="pending"||archive.supplementalGeneration!==args.generation||(archive.supplementalLeaseUntil??0)<=Date.now()||!(await archiveRetention(ctx,archive)).viewable)return;
 const attempts=archive.supplementalAttempts??0,attention=!args.complete&&attempts>=12;
 const copies=await archiveCopies(ctx,archive);
 const supplied=args.observedKinds??[];
 const saved=args.observedSaved===true&&supplied.length>0&&supplied.length<=30&&supplied.every(kind=>copies.copies.some(copy=>copy.document.kind===kind&&copy.available));
 const confirmedOmission=args.observedResponse===true&&supplied.length===0&&archive.supplementalAssetsPending!==true;
 await ctx.db.patch(archive._id,{...(saved?{supplementalAssetsPending:false,supplementalCheckVersion:2}:confirmedOmission?{supplementalCheckVersion:2}:{}),supplementalLeaseUntil:undefined,supplementalStatus:args.complete?"complete":attention?"attention":"pending",supplementalDueAt:Date.now()+Math.min(3600000,30000*2**Math.min(attempts,7)),supplementalError:args.complete?undefined:"Additional verification images are unavailable or could not be copied."});
 if(attention)await flagSupplementalFailure(ctx,archive);
}});
async function queueSupplemental(ctx:any,archive:any){
 if(archive.status!=="complete"||archive.source==="drone"||["pending","complete"].includes(archive.supplementalStatus??"")||!(await archiveRetention(ctx,archive)).viewable)return;
 await ctx.db.patch(archive._id,{supplementalStatus:"pending",supplementalAttempts:0,supplementalDueAt:Date.now(),supplementalError:undefined,supplementalGeneration:(archive.supplementalGeneration??0)+1,supplementalLeaseUntil:undefined});
 await ctx.scheduler.runAfter(0,internal.verificationArchiveWorker.capture,{archiveId:archive._id,supplemental:true});
}
export const retrySupplemental=mutation({args:{token:v.string(),archiveId:v.id("verification_archives")},handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"verificationArchive.retrySupplemental");const archive=await ctx.db.get(args.archiveId);
 if(!archive||archive.status!=="complete"||archive.source==="drone"||!(await archiveRetention(ctx,archive)).viewable)throw Error("This archive is not available for image recovery.");
 await queueSupplemental(ctx,archive);
}});
export const finish = internalMutation({ args: { archiveId: v.id("verification_archives"),generation:v.number(), complete: v.boolean(),imagesPresent:v.optional(v.boolean()) }, handler: async (ctx, args) => {
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status!=="pending" || archive.generation!==args.generation || (archive.leaseUntil??0)<=Date.now() || !(await archiveRetention(ctx,archive)).viewable) return;
  if(args.complete && !(await archiveCopies(ctx,archive)).ready)args.complete=false;
  const attempts = archive.attempts;
  const proofGeneration=(archive.readProofGeneration??0)+1;
  await ctx.db.patch(archive._id, {leaseUntil:undefined,...(args.complete ? { status: "complete", completedAt: Date.now(), readVerifiedAt:undefined,readProofGeneration:proofGeneration,readProofDueAt:Date.now()+CAPTURE_LEASE_MS,readProofFailures:0,error: undefined } : { status: attempts >= 12 ? "attention" : "pending", attempts, dueAt: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)), error: "Document archive incomplete. Available copies are saved; remaining provider documents must be checked and retried." })});
  if(!args.complete && attempts>=12)await flagArchiveFailure(ctx,archive);
  if (args.complete) {
    await ctx.scheduler.runAfter(0,internal.verificationArchiveWorker.checkReadability,{archiveId:archive._id,proofGeneration});
    if(args.imagesPresent===true)await ctx.db.patch(archive._id,{supplementalStatus:"complete",supplementalError:undefined,supplementalLeaseUntil:undefined});
    else if(args.imagesPresent===false)await queueSupplemental(ctx,{...archive,status:"complete",supplementalStatus:undefined});
    const reused = await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", archive.bookingId)).collect();
    for (const bookingId of [archive.bookingId, ...reused.map((b: any) => b._id)]) {
      const booking = await ctx.db.get(bookingId as typeof archive.bookingId);
      if (booking && ["confirmed", "active"].includes(booking.status)) await queueRmv2Sync(ctx, bookingId);
    }
  }
} });
export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("verification_archives").withIndex("by_status_due", q => q.eq("status", "pending").lte("dueAt", Date.now())).take(10) });
export const supplementalDue=internalQuery({args:{},handler:async ctx=>ctx.db.query("verification_archives").withIndex("by_supplemental_due",q=>q.eq("supplementalStatus","pending").lte("supplementalDueAt",Date.now())).take(10)});
export const accountDocuments = query({ args: { token: v.string(), accountId: v.id("accounts") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const jobs = await ctx.db.query("verification_archives").withIndex("by_account", q => q.eq("accountId", args.accountId)).collect();
  return Promise.all(jobs.map(async archive => {
    const retention = await archiveRetention(ctx, archive);
    const { copies, ready } = await archiveCopies(ctx, archive, true);
    return { ...archive, email: undefined, retention, readProofExpiresAt: archive.source === "drone" || !Number.isFinite(archive.readVerifiedAt) ? null : archive.readVerifiedAt! + READ_PROOF_MAX_AGE_MS, copiesReady: archive.status==="complete" && retention.viewable && ready && (archive.source==="drone"||hasFreshReadProof(archive)),
      documents: copies.map(({ document: d, available }) => ({ id: d._id, kind: d.kind, size: d.size, sha256: d.sha256, savedAt: d.savedAt, contentType: d.contentType, available: retention.viewable && available })) };
  }));
} });
export const retry = mutation({ args: { token: v.string(), archiveId: v.id("verification_archives") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.retry");
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "deleted") throw Error("Document retention period ended. Expired archives cannot be reopened.");
  if(!(await archiveRetention(ctx,archive)).viewable)throw Error("Document retention period ended.");
  if (archive.source === "drone") throw Error("Ask the renter to upload a new drone licence copy through this rental.");
  if (["complete","attention"].includes(archive.status) && (await archiveCopies(ctx, archive)).ready) {
    if(archive.status==="attention"||!hasFreshReadProof(archive)){
      const proofGeneration=(archive.readProofGeneration??0)+1;
      await ctx.db.patch(archive._id,{status:"complete",readVerifiedAt:undefined,readProofGeneration:proofGeneration,readProofDueAt:Date.now()+CAPTURE_LEASE_MS,error:undefined});
      await ctx.scheduler.runAfter(0,internal.verificationArchiveWorker.checkReadability,{archiveId:archive._id,proofGeneration});
    }
    return;
  }
  await ctx.db.patch(archive._id, { status: "pending", attempts: 0, dueAt: Date.now(), error: undefined,generation:(archive.generation??0)+1,leaseUntil:undefined });
  await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId: archive._id });
} });
export const reportDisplayFailure=mutation({args:{token:v.string(),documentId:v.id("verification_documents"),generation:v.number()},handler:async(ctx,args)=>{
  await assertAdmin(ctx,args.token,"verificationArchive.reportDisplayFailure");
  const document=await ctx.db.get(args.documentId);
  const archive=document?await ctx.db.get(document.archiveId):null;
  if(!archive||archive.status!=="complete"||(archive.generation??0)!==args.generation||!(await archiveRetention(ctx,archive)).viewable)return false;
  await ctx.db.patch(archive._id,{status:"attention",generation:(archive.generation??0)+1,leaseUntil:undefined,readVerifiedAt:undefined,error:"An administrator could not open a saved document. Review document access and retry the archive."});
  const booking=await ctx.db.get(archive.bookingId),account=await accountForRental(ctx,booking);
  await queueOwnerNotification(ctx,{eventKey:`verification-display-failed:${archive._id}:${archive.generation??0}`,kind:"verification_archive",...(account?{accountId:account._id}:{}),bookingId:archive.bookingId,title:"Verification document could not open",body:"A saved document failed to open in the admin site. Review document access and retry the archive before relying on the verification."});
  return true;
}});
export const downloadAccess = internalMutation({ args: { token: v.string(), documentId: v.id("verification_documents") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.viewDocument");
  const document = await ctx.db.get(args.documentId);
  if (!document) throw Error("Document not found");
  const archive = await ctx.db.get(document.archiveId);
  if (!archive || !(await archiveRetention(ctx, archive)).viewable) throw Error("Document retention period ended");
  if (!(await documentCopyAvailable(ctx, archive, document))) throw Error("Saved document is missing or invalid. Retry the archive from account documents.");
  return { storageId: document.storageId, kind: document.kind, contentType: document.contentType };
} });

/** Walk both ownership indexes without truncating an account's rental history. */
async function backfillPage(ctx: any, accountId: any, legacy: boolean, cursor: string | null) {
  const account = await ctx.db.get(accountId);
  if (!account) return;
  const rentals = legacy
    ? ctx.db.query("bookings").withIndex("by_account_guestEmail", (q: any) => q.eq("accountId", undefined).eq("guestEmail", account.email))
    : ctx.db.query("bookings").withIndex("by_account", (q: any) => q.eq("accountId", accountId));
  const page = await rentals.order("desc").paginate({ numItems: 25, cursor });
  for (const booking of page.page) {
    if(booking.droneLicenceStorageId && !booking.droneLicenceDocumentId)await ctx.scheduler.runAfter(0,internal.droneArchive.captureLegacy,{bookingId:booking._id});
    if (!booking.diditSessionId) continue;
    const archives = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
    const existing = archives.find((a: any) => a.sessionId === booking.diditSessionId);
    // The same decision preserves active reuse and claims, without recopying
    // expired documents or resurrecting an archive whose bytes were deleted.
    const retention = await archiveRetention(ctx, existing ?? { bookingId: booking._id, status: "pending" });
    if (retention.viewable) {
      if(existing?.status==="complete")await queueSupplemental(ctx,existing);
      else await queueVerificationArchive(ctx, booking);
    }
  }
  if (!page.isDone || !legacy) {
    await ctx.scheduler.runAfter(0, internal.verificationArchive.backfillNext, {
      accountId, legacy: page.isDone ? true : legacy,
      cursor: page.isDone ? null : page.continueCursor,
    });
  }
}
export const backfillAccount = mutation({ args: { token: v.string(), accountId: v.id("accounts") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.backfillAccount");
  if (!await ctx.db.get(args.accountId)) throw Error("Account not found");
  await backfillPage(ctx, args.accountId, false, null);
} });
export const backfillNext = internalMutation({
  args: { accountId: v.id("accounts"), legacy: v.boolean(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => backfillPage(ctx, args.accountId, args.legacy, args.cursor),
});
export const retentionHold = mutation({ args: { token: v.string(), archiveId: v.id("verification_archives"), reason: v.string() }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.retentionHold");
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "deleted") throw Error("Archive unavailable");
  if (args.reason && args.reason.trim().length < 10) throw Error("Record the open case or insurance claim reason.");
  await ctx.db.patch(archive._id, { retentionHoldReason: args.reason.trim().slice(0, 500) || undefined });
} });
/** Retain during rental/claim; remove bytes 90 days after actual return or cancellation. */
export const purgeExpired = internalMutation({ args: {}, handler: async ctx => {
  const archives = await ctx.db.query("verification_archives").collect();
  let removed = 0;
  for (const archive of archives) {
    if (removed >= 25 || archive.status === "deleted" || archive.retentionHoldReason) continue;
    const retention = await archiveRetention(ctx, archive);
    if (retention.status !== "expires" || retention.expiresAt === null || retention.expiresAt > Date.now()) continue;
    const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).collect();
    for (const document of documents) await deletePrivateFile(ctx,document.storageId);
    await ctx.db.patch(archive._id, { status: "deleted", deletedAt: Date.now(), error: undefined,supplementalStatus:undefined,supplementalDueAt:undefined,supplementalLeaseUntil:undefined });
    removed++;
  }
  return removed;
} });
