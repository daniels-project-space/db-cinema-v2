const assert=require('node:assert/strict'),{load,db,put}=require('./lib/rentalTestHarness.cjs');
const bookings=load('convex/bookings.ts'),archives=load('convex/verificationArchive.ts');
const scheduled=[],ctx={db,storage:{delete:async()=>{}},scheduler:{runAfter:async(...args)=>scheduled.push(args)}};
const now=Date.now(),account=put('accounts',{email:'retention@example.invalid'});
const source=put('bookings',{accountId:account._id,guestEmail:account.email,status:'returned',returnedAt:now-100*86400000});
const reused=put('bookings',{accountId:account._id,guestEmail:account.email,status:'active',idVerifyStatus:'verified',verificationReusedFrom:source._id});
const pending=put('bookings',{accountId:account._id,guestEmail:account.email,status:'pending_verification',idVerifyStatus:'verified',verificationReusedFrom:source._id});
const archive=put('verification_archives',{bookingId:source._id,accountId:account._id,status:'complete',sessionId:'fixture',attempts:0,dueAt:0,createdAt:now-100*86400000});
const claim=put('rental_damage_cases',{bookingId:reused._id,status:'open',openedAt:now-101*86400000});
(async()=>{
 assert.equal((await archives.archiveRetention(ctx,archive)).status,'active-rental');
 await bookings.revokeVerificationReuse.handler(ctx,{sourceBookingId:source._id});assert.equal(reused.verificationReusedFrom,undefined);assert.equal(reused.idVerifyStatus,'requires_input');
 assert.equal(pending.idVerifyStatus,'requires_input','a pending rental must not confirm using a revoked reusable approval');
 assert.equal(pending.verificationReusedFrom,undefined);
 let confirmationAttempted=false;
 const checkout=load('convex/checkout.ts');
 await checkout.confirmAfterVerification.handler({
  runQuery:async ref=>{assert.equal(ref,'bookings.verificationAccess');return {...pending,verificationProvider:'didit',stripeCheckoutSessionId:'cs_synthetic'};},
  runMutation:async()=>{confirmationAttempted=true;},
  runAction:async()=>{confirmationAttempted=true;},
  scheduler:{runAfter:async()=>{confirmationAttempted=true;}},
 },{bookingId:pending._id});
 assert.equal(confirmationAttempted,false,'a queued confirmation stops after its reused approval is revoked');
 const pendingLink=(await db.query('verification_archive_links').collect()).find(link=>link.bookingId===pending._id);
 assert.ok(pendingLink,'revocation retains the pending rental’s archive link');
 await db.delete(pendingLink._id);await db.delete(pending._id);
 const links=await db.query('verification_archive_links').collect();assert.equal(links.length,1);assert.equal(links[0].sourceBookingId,source._id);assert.equal(links[0].bookingId,reused._id);
 assert.equal((await archives.archiveRetention(ctx,archive)).status,'active-rental','Revocation must not remove a rental retention hold');
 reused.status='returned';reused.returnedAt=now-100*86400000;
 assert.equal((await archives.archiveRetention(ctx,archive)).status,'insurance-case','An open later-rental case protects the original documents after revocation');
 claim.status='closed';claim.closedAt=now-86400000;assert.equal((await archives.archiveRetention(ctx,archive)).expiresAt,claim.closedAt+90*86400000);
 claim.openedAt=now-1000;assert.equal((await archives.archiveRetention(ctx,archive)).status,'unknown-closure','An impossible case chronology must not justify deleting documents');claim.openedAt=now-101*86400000;
 links[0].bookingId='bookings-missing';assert.equal((await archives.archiveRetention(ctx,archive)).status,'unknown-closure','A missing linked rental cannot justify deleting its verification evidence');links[0].bookingId=reused._id;
 claim.closedAt=now-100*86400000;assert.equal(await archives.purgeExpired.handler(ctx,{}),1);assert.equal(archive.status,'deleted');
 await archives.purgeArchiveLinks.handler(ctx,{sourceBookingId:source._id});assert.equal((await db.query('verification_archive_links').collect()).length,0,'Expired archival links are removed after all source archives are deleted');
 console.log('PASS verification retention across real reuse revocation: active rental and case hold survive; closed-case 90 days; expired links removed. Synthetic data only.');
})().catch(error=>{console.error(error);process.exitCode=1});
