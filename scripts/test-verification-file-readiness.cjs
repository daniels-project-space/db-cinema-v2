const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {seedVerificationFiles}=require('./lib/verificationFiles.cjs');
const archive=load('convex/verificationArchive.ts');
process.env.ADMIN_TOKEN='file-readiness-test';
const account=put('accounts',{email:'files@example.invalid'});
const booking=put('bookings',{accountId:account._id,status:'confirmed',diditSessionId:'file-readiness'});
const job=put('verification_archives',{bookingId:booking._id,accountId:account._id,sessionId:booking.diditSessionId,status:'complete',attempts:1,generation:4});
const files=seedVerificationFiles(put,job),scheduled=[];
const ctx={db,scheduler:{runAfter:async(delay,ref,args)=>scheduled.push({ref,args})}};
const check=()=>archive.assertVerificationArchive(ctx,booking);
const list=()=>archive.accountDocuments.handler(ctx,{token:process.env.ADMIN_TOKEN,accountId:account._id});
(async()=>{
 await check();
 const first=await db.system.get(files[0].storageId);await db.patch(first._id,{sha256:Buffer.from(files[0].sha256,'hex').toString('base64')});await check();await db.patch(first._id,{sha256:files[0].sha256});
 const metadata=await db.system.get(files[0].storageId);
 await db.delete(files[0].storageId);
 await assert.rejects(check,/fully archived/,'A complete label cannot authorize handover without the actual identity copy');
 let result=(await list())[0];assert.equal(result.copiesReady,false);assert.equal(result.documents.find(d=>d.id===files[0]._id).available,false);assert.equal(result.documents.find(d=>d.id===files[1]._id).available,true,'Healthy sibling stays viewable');
 assert(!JSON.stringify(result).includes(files[0].storageId),'No storage identifier is exposed');
 await assert.rejects(()=>archive.downloadAccess.handler(ctx,{token:process.env.ADMIN_TOKEN,documentId:files[0]._id}),/missing or invalid/);
 await archive.retry.handler(ctx,{token:process.env.ADMIN_TOKEN,archiveId:job._id});assert.equal(job.status,'pending');assert.equal(job.generation,5);assert.equal(scheduled.length,1);assert.equal(scheduled[0].ref,'verificationArchiveWorker.capture');
 put('_storage',metadata);job.status='complete';await check();
 await archive.retry.handler(ctx,{token:process.env.ADMIN_TOKEN,archiveId:job._id});assert.equal(scheduled.length,1,'A healthy complete archive does not re-download');
 for(const patch of [{sha256:'0'.repeat(64)},{size:metadata.size+1},{contentType:'text/plain'}]){
  await db.patch(metadata._id,patch);await assert.rejects(check,/fully archived/,'Mismatched storage metadata blocks release');await db.patch(metadata._id,metadata);
 }
 for(const patch of [{accountId:'foreign-account'},{bookingId:'foreign-booking'},{sessionId:'foreign-session'}]){
  const original={accountId:files[0].accountId,bookingId:files[0].bookingId,sessionId:files[0].sessionId};await db.patch(files[0]._id,patch);await assert.rejects(check,/fully archived/);await assert.rejects(()=>archive.downloadAccess.handler(ctx,{token:process.env.ADMIN_TOKEN,documentId:files[0]._id}),/missing or invalid/);await db.patch(files[0]._id,original);
 }
 await db.delete(files[1]._id);await assert.rejects(check,/fully archived/,'Identity alone cannot replace required proof of address');put('verification_documents',files[1]);await check();
 booking.status='returned';booking.returnedAt=Date.now()-31*86400000;await assert.rejects(()=>archive.retry.handler(ctx,{token:process.env.ADMIN_TOKEN,archiveId:job._id}),/retention period/,'Expired healthy archives cannot be retried');
 await assert.rejects(()=>archive.retry.handler(ctx,{token:'wrong',archiveId:job._id}),/unauthorized/);
 console.log('PASS actual file readiness: missing storage, digest/size/MIME and owner/session binding, required address, private listing/download, complete archive repair, healthy no-op and expired/unauthorized denial. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
