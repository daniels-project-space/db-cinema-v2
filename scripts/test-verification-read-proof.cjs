const assert=require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const {convexToJson,jsonToConvex}=require('convex/values');
const {verificationReadSnapshot}=load('convex/lib/verificationReadProof.ts');
const archive=load('convex/verificationArchive.ts'),worker=load('convex/verificationArchiveWorker.ts');
const booking=put('bookings',{status:'confirmed',diditSessionId:'proof-session'});
const job=put('verification_archives',{bookingId:booking._id,sessionId:booking.diditSessionId,status:'complete',attempts:0,dueAt:0,createdAt:Date.now()});
const files=require('./lib/verificationFiles.cjs').seedVerificationFiles(put,job);
const tasks=[],stored=new Map([[files[0].storageId,new Blob([Buffer.from([255,216,255,217])],{type:'image/jpeg'})],[files[1].storageId,new Blob([Buffer.from('%PDF-1.7\nQA fixture\n%%EOF')],{type:'application/pdf'})]]);
const context={db,scheduler:{runAfter:async(_delay,ref,args)=>tasks.push({ref,args})}};
const workerContext={storage:{get:async id=>stored.get(id)??null},runQuery:async(ref,args)=>jsonToConvex(convexToJson(await archive[ref.split('.')[1]].handler(context,args))),runMutation:async(ref,args)=>archive[ref.split('.')[1]].handler(context,args)};
(async()=>{
 job.readVerifiedAt=Date.now()-25*3600000;job.readProofDueAt=0;
 await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/,'expired byte proof fails closed');
 await archive.scheduleReadProofs.handler(context,{});assert.equal(tasks.length,1);assert.equal(tasks[0].ref,'verificationArchiveWorker.checkReadability');
 const first=tasks[0].args;
 await worker.checkReadability.handler(workerContext,first);assert.ok(job.readVerifiedAt>Date.now()-1000);await archive.assertVerificationArchive(context,booking);
 assert.ok(job.readProofDueAt>Date.now()+3600000,'successful proof has bounded freshness and a scheduled refresh');
 job.supplementalStatus=undefined;job.supplementalCheckVersion=undefined;
 await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/,'legacy archives with no supplemental state are unknown, not confirmed empty');
 job.readProofVersion=undefined;job.supplementalStatus='attention';
 await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/,'fresh pre-upgrade proofs are not full-set proofs');
 await archive.scheduleReadProofs.handler(context,{});await worker.checkReadability.handler(workerContext,tasks.at(-1).args);
 assert.equal(job.readProofVersion,2,'unversioned future-due archives are bootstrapped promptly');
 assert.equal(job.supplementalStatus,'pending','legacy attention is queued for bounded provider reinspection');
 await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/,'legacy supplemental failure stays blocked until a new provider response');
 job.supplementalCheckVersion=2;
 const addedBytes=Buffer.from([255,216,255,217]),addedHash=require('node:crypto').createHash('sha256').update(addedBytes).digest('hex');
 for(const kind of ['selfie-0-reference_image','face-match-0-source_image','id-extra-0-portrait_image']){
  const file=put('_storage',{sha256:addedHash,size:addedBytes.length,contentType:'image/jpeg'});stored.set(file._id,new Blob([addedBytes],{type:'image/jpeg'}));
  job.supplementalStatus='pending';job.supplementalGeneration=(job.supplementalGeneration??0)+1;job.supplementalLeaseUntil=Date.now()+60000;
  const previousGeneration=job.readProofGeneration;
  assert.equal(await archive.save.handler({...context,storage:{delete:async()=>{}}},{archiveId:job._id,generation:job.supplementalGeneration,kind,storageId:file._id,sha256:addedHash,size:addedBytes.length,contentType:'image/jpeg',supplemental:true}),true);
  assert.equal(job.readVerifiedAt,undefined,'adding '+kind+' atomically invalidates the old proof');
  assert.equal(job.readProofGeneration,previousGeneration+1,'adding '+kind+' fences in-flight proof');
  await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/);
  await archive.scheduleReadProofs.handler(context,{});const proof=tasks.at(-1).args;
  const candidate=await archive.readProofCandidate.handler(context,proof);assert(candidate.documents.some(document=>document.storageId===file._id),kind+' enters the byte-proof snapshot');
  stored.delete(file._id);await worker.checkReadability.handler(workerContext,proof);await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/,kind+' missing bytes suppress readiness');
  stored.set(file._id,new Blob([Buffer.from([0,0,0,0])],{type:'image/jpeg'}));job.readProofDueAt=0;await archive.scheduleReadProofs.handler(context,{});await worker.checkReadability.handler(workerContext,tasks.at(-1).args);await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/,kind+' corrupt bytes suppress readiness');
  stored.set(file._id,new Blob([addedBytes],{type:'image/jpeg'}));job.readProofDueAt=0;await archive.scheduleReadProofs.handler(context,{});await worker.checkReadability.handler(workerContext,tasks.at(-1).args);await archive.assertVerificationArchive(context,booking);
 }
 job.readProofDueAt=0;await archive.scheduleReadProofs.handler(context,{});const second=tasks.at(-1).args;
 const candidate=await archive.readProofCandidate.handler(context,second);
 const transported=jsonToConvex(convexToJson(candidate));
 assert.notDeepEqual(Object.keys(transported.documents[0]),Object.keys(candidate.documents[0]),'real Convex serialization reorders object keys');
 assert.equal(verificationReadSnapshot(transported.documents),verificationReadSnapshot(candidate.documents),'snapshot ignores transport object-key order');
 for(const field of ['storageId','sha256','size','contentType']){
  const changed=transported.documents.map(document=>({...document}));changed[0][field]=field==='size'?changed[0][field]+1:changed[0][field]+'-changed';
  assert.equal(await archive.recordReadProof.handler(context,{archiveId:job._id,generation:candidate.generation,proofGeneration:second.proofGeneration,snapshot:verificationReadSnapshot(changed)}),false,`changed ${field} cannot renew proof`);
 }
 assert.equal(await archive.recordReadProof.handler(context,{archiveId:job._id,generation:candidate.generation,proofGeneration:second.proofGeneration,snapshot:verificationReadSnapshot([...transported.documents].reverse())}),false,'reordered document identities cannot renew proof');
 assert.equal(await archive.recordReadProof.handler(context,{archiveId:job._id,generation:candidate.generation,proofGeneration:first.proofGeneration,snapshot:verificationReadSnapshot(candidate.documents)}),false,'stale proof workers cannot renew readiness');
 const savedAddress=stored.get(files[1].storageId);stored.delete(files[1].storageId);await worker.checkReadability.handler(workerContext,second);
 assert.equal(job.status,'complete');assert.equal(job.readVerifiedAt,undefined,'an unreadable byte immediately invalidates proof while retrying');await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/);
 stored.set(files[1].storageId,savedAddress);job.readProofDueAt=0;await archive.scheduleReadProofs.handler(context,{});await worker.checkReadability.handler(workerContext,tasks.at(-1).args);
 await archive.assertVerificationArchive(context,booking);assert.equal(job.readProofFailures,0,'a transient outage recovers automatically');
 const extraBytes=Buffer.from([255,216,255,217]),extraHash=require('node:crypto').createHash('sha256').update(extraBytes).digest('hex');
 const extraStorage=put('_storage',{sha256:extraHash,size:extraBytes.length,contentType:'image/jpeg'});
 put('verification_documents',{archiveId:job._id,bookingId:booking._id,sessionId:booking.diditSessionId,kind:'identity-1-back_image',storageId:extraStorage._id,sha256:extraHash,size:extraBytes.length,contentType:'image/jpeg',savedAt:Date.now()});
 stored.set(extraStorage._id,new Blob([Buffer.from([0,0,0,0])],{type:'image/jpeg'}));
 for(let attempt=0;attempt<8;attempt++){job.readProofDueAt=0;await archive.scheduleReadProofs.handler(context,{});await worker.checkReadability.handler(workerContext,tasks.at(-1).args)}
 assert.equal(job.status,'attention','a corrupt additional required file escalates after bounded retries');await assert.rejects(()=>archive.assertVerificationArchive(context,booking),/fully archived/);
 assert((tables.get('admin_notifications')??[]).some(row=>row.bookingId===booking._id),'the owner is alerted without document contents');
 const overflowAccount=put('accounts',{email:'overflow@example.invalid'}),overflowBooking=put('bookings',{accountId:overflowAccount._id,status:'confirmed',diditSessionId:'overflow-session'});
 const overflow=put('verification_archives',{bookingId:overflowBooking._id,accountId:overflowAccount._id,sessionId:overflowBooking.diditSessionId,status:'complete',readProofVersion:2,readVerifiedAt:Date.now()});
 require('./lib/verificationFiles.cjs').seedVerificationFiles(put,overflow);
 for(let index=0;index<29;index++){const storage=put('_storage',{sha256:addedHash,size:addedBytes.length,contentType:'image/jpeg'});put('verification_documents',{archiveId:overflow._id,accountId:overflowAccount._id,bookingId:overflowBooking._id,sessionId:overflow.sessionId,kind:'id-extra-'+index,storageId:storage._id,sha256:addedHash,size:addedBytes.length,contentType:'image/jpeg',savedAt:Date.now()});}
 await assert.rejects(()=>archive.assertVerificationArchive(context,overflowBooking),/fully archived/,'more than 30 retained files fail closed');
 process.env.ADMIN_TOKEN='proof-admin';const admin=await archive.accountDocuments.handler(context,{token:'proof-admin',accountId:overflowAccount._id});assert.equal(admin[0].documents.length,31,'historical overflow remains fully visible to admins');assert.equal(admin[0].copiesReady,false);
 overflow.status='pending';overflow.generation=3;overflow.leaseUntil=Date.now()+60000;let deleted=false;
 assert.equal(await archive.save.handler({...context,storage:{delete:async()=>{deleted=true}}},{archiveId:overflow._id,generation:3,kind:'identity-new',storageId:put('_storage',{sha256:addedHash,size:addedBytes.length,contentType:'image/jpeg'})._id,sha256:addedHash,size:addedBytes.length,contentType:'image/jpeg'}),false,'new files cannot exceed the archive cap');assert.equal(deleted,true);
 const legacy=[],due=[];for(let index=0;index<21;index++){
  legacy.push(put('verification_archives',{bookingId:booking._id,sessionId:booking.diditSessionId,status:'complete',attempts:0,dueAt:0,createdAt:Date.now()}));
  due.push(put('verification_archives',{bookingId:booking._id,sessionId:booking.diditSessionId,status:'complete',attempts:0,dueAt:0,createdAt:Date.now(),readProofVersion:2,readProofDueAt:Date.now()-1000}));
 }
 const future=put('verification_archives',{bookingId:booking._id,sessionId:booking.diditSessionId,status:'complete',attempts:0,dueAt:0,createdAt:Date.now(),readProofVersion:2,readProofDueAt:Date.now()+3600000});
 const taskStart=tasks.length;await archive.scheduleReadProofs.handler(context,{});const batch=tasks.slice(taskStart);
 assert.equal(batch.length,20,'the scanner is bounded to 20');
 assert.equal(batch.filter(task=>legacy.some(row=>row._id===task.args.archiveId)).length,10,'legacy bootstrap cannot starve existing due checks');
 assert.equal(batch.filter(task=>due.some(row=>row._id===task.args.archiveId)).length,10,'due checks cannot starve legacy bootstrap');
 assert(!batch.some(task=>task.args.archiveId===future._id),'future archives are not read or scheduled');
 const account=put('accounts',{email:'proof-reuse@example.invalid',rentalVerification:{sourceBookingId:booking._id}});
 for(let index=0;index<25;index++)put('bookings',{accountId:account._id,status:'confirmed',accountAccessRequired:false,verificationProvider:'didit',idVerifyStatus:'required',...(index===0?{diditSessionId:'already-started'}:{})});
 await archive.resumeReuses.handler(context,{accountId:account._id,sourceBookingId:booking._id,cursor:null});
 assert.equal(tasks.filter(task=>task.ref==='didit.reuseVerification').length,19,'proof recovery resumes eligible rentals in a bounded page without replacing an open session');
 const continuation=tasks.find(task=>task.ref==='verificationArchive.resumeReuses');assert.ok(continuation);
 await archive.resumeReuses.handler(context,continuation.args);assert.equal(tasks.filter(task=>task.ref==='didit.reuseVerification').length,24,'all eligible rentals eventually resume');
 console.log('PASS verification byte proof: freshness, bounded scheduled refresh, stale-worker fence and unreadable-byte invalidation.');
})().catch(error=>{console.error(error);process.exitCode=1});
