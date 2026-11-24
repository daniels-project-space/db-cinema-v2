const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const archive=h.load('convex/verificationArchive.ts'),now=Date.now(),queued=[],deleted=[];
const ctx={db:h.db,storage:{delete:async id=>deleted.push(id)},scheduler:{runAfter:async(_delay,ref,args)=>{assert.equal(ref,'verificationArchive.purgeExpired');queued.push(args)}}};
const records=[];
for(let index=0;index<67;index++){
 const booking=h.put('bookings',{status:index===30?'active':'returned',returnedAt:now-(index===40?89:91)*86400000});
 const row=h.put('verification_archives',{bookingId:booking._id,sessionId:'fixture-'+index,email:'fixture@example.invalid',status:'complete',createdAt:now-100*86400000,attempts:0,dueAt:0,...(index===50?{retentionHoldReason:'Open insurance review'}:{})});
 if(index===50)h.put('rental_damage_cases',{bookingId:booking._id,status:'open',openedAt:now-10*86400000});
 h.put('verification_documents',{archiveId:row._id,bookingId:booking._id,sessionId:row.sessionId,kind:'identity',storageId:'file-'+index,sha256:'a'.repeat(64),size:5,contentType:'image/jpeg',savedAt:now});records.push(row);
}
(async()=>{
 const first=await archive.purgeExpired.handler(ctx,{});assert(first>0&&first<=25);assert.equal(queued.length,1);const stale=queued[0];
 assert.equal(await archive.purgeExpired.handler(ctx,{}),0,'A second cron cannot overlap an active sweep');
 const continuation=queued.shift();await archive.purgeExpired.handler(ctx,continuation);const afterPage=deleted.length;
 assert.equal(await archive.purgeExpired.handler(ctx,stale),0,'A replayed page generation is ignored');assert.equal(deleted.length,afterPage);
 while(queued.length)await archive.purgeExpired.handler(ctx,queued.shift());
 assert.equal(records.filter(row=>row.status==='deleted').length,64);assert.equal(deleted.length,64);
 for(const index of [30,40,50])assert.equal(records[index].status,'complete','Active rentals, unexpired archives and case holds remain');
 const state=await h.db.query('verification_archive_sweeps').first();assert.equal(state.active,false);assert.equal(state.cursor,undefined);
 await archive.purgeExpired.handler(ctx,{});while(queued.length)await archive.purgeExpired.handler(ctx,queued.shift());assert.equal(deleted.length,64,'A later full sweep cannot delete the same document twice');
 const nextBooking=h.put('bookings',{status:'returned',returnedAt:now-91*86400000});const nextArchive=h.put('verification_archives',{bookingId:nextBooking._id,sessionId:'recovery',email:'fixture@example.invalid',status:'complete',createdAt:now,attempts:0,dueAt:0});h.put('verification_documents',{archiveId:nextArchive._id,bookingId:nextBooking._id,sessionId:'recovery',kind:'identity',storageId:'recovery-file',sha256:'a'.repeat(64),size:5,contentType:'image/jpeg',savedAt:now});
 await archive.purgeExpired.handler(ctx,{});const oldGeneration=queued.shift();state.updatedAt=Date.now()-3600001;await archive.purgeExpired.handler(ctx,{});assert.equal(await archive.purgeExpired.handler(ctx,oldGeneration),0,'A late worker cannot resume an abandoned generation');while(queued.length)await archive.purgeExpired.handler(ctx,queued.shift());assert.equal(nextArchive.status,'deleted','A stalled sweep resumes from its saved cursor');assert.equal(deleted.length,65);
 console.log('PASS retention sweep: bounded pages, continuation, replay fencing, active rental and case holds, 90-day boundary, and repeated cycles; synthetic data only.');
})().catch(error=>{console.error(error);process.exitCode=1});
