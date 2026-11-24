const assert = require('node:assert/strict');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
setMock('./lib/rmv2SyncQueue',{queueRmv2Sync:async()=>{}});
setMock('./lib/verificationArchiveLink',{retainVerificationArchiveLink:async()=>{}});
setMock('./lib/restrictedIdentityAlerts',{queueRestrictedIdentityCheck:async()=>{},notifyRestrictedIdentityMatch:async()=>false});
setMock('./lib/rentalEmailQueue',{queueRentalEmail:async()=>{}});
setMock('./lib/adminPush',{queueOwnerNotification:async()=>{}});
setMock('./rentalChat',{postRentalMessage:async()=>null});
const bookings=load('convex/bookings.ts');
const now=Date.now(),day=86400000;
const listing=put('listings',{title:'Camera',depositAmount:200});
const scheduled=[{listingId:listing._id,title:'Camera',qty:1,start:now+2*day,end:now+3*day,pickupTime:'10:00',lineTotal:100}];
function account(email){return put('accounts',{email,name:'Mulan Example',address:'25 Example Road SW1A 1AA',emailVerifiedAt:now-1000});}
function pendingRental(owner,fields={}){
 return put('bookings',{accountId:owner._id,accountAccessRequired:false,guestEmail:owner.email,agreementName:owner.name,billingAddress:owner.address,status:'pending_verification',verificationProvider:'didit',idVerifyStatus:'required',checkoutPaidAt:now,stripePaymentIntentId:`pi-${owner.email}-${Math.random()}`,stripeCheckoutSessionId:`cs-${owner.email}-${Math.random()}`,lineItems:scheduled,depositHoldAmount:0,...fields});
}
const scheduledJobs=[];
const ctx={db,scheduler:{runAfter:async(...args)=>scheduledJobs.push(args)}};
(async()=>{
 const renter=account('active-check@example.invalid');
 const first=pendingRental(renter,{reservationId:'reservation-first'});
 const second=pendingRental(renter,{reservationId:'reservation-second'});
 const firstClaim='source-session-claim';
 let mutationQueue=Promise.resolve();
 const serialClaim=args=>{const run=mutationQueue.then(()=>bookings.claimDiditSessionSlot.handler(ctx,args));mutationQueue=run.catch(()=>{});return run;};
 const [firstSlot,secondSlot]=await Promise.all([
   serialClaim({bookingId:first._id,claimId:firstClaim}),
   serialClaim({bookingId:second._id,claimId:'dependent-session-claim'}),
 ]);
 assert.deepEqual(firstSlot,{kind:'owner'},'only one concurrent booking receives the account-scoped session claim');
 assert.deepEqual(secondSlot,{kind:'waiting',sourceBookingId:first._id},'the other paid booking links to that exact source booking');
 assert.equal(second.verificationInProgressFrom,first._id);
 assert.equal(second.idVerifyStatus,'required','an in-progress source is never treated as approval');
 assert.equal(second.diditSessionId,undefined,'a Didit session is never rebound to a second booking');
 assert.equal(second.status,'pending_verification');
 const paymentBefore={payment:second.stripePaymentIntentId,checkout:second.stripeCheckoutSessionId,reservation:second.reservationId,lines:second.lineItems};
 assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:first._id,sessionId:'didit-source-session',claimId:firstClaim}),true);
 assert.equal(renter.activeDiditVerification.sessionId,'didit-source-session','the atomic claim is fixed to the newly saved provider session');
 const renewalArgs={bookingId:first._id,previousSessionId:'didit-source-session'};
 assert.deepEqual(await bookings.claimDiditSessionSlot.handler(ctx,{...renewalArgs,claimId:'renewal-one'}),{kind:'owner'});
 assert.deepEqual(await bookings.claimDiditSessionSlot.handler(ctx,{...renewalArgs,claimId:'renewal-two'}),{kind:'busy'},'a second renewal cannot replace a live claim while the old session remains attached');
 assert.deepEqual(await bookings.claimDiditSessionSlot.handler(ctx,{...renewalArgs,claimId:'renewal-one'}),{kind:'owner'},'retrying the same renewal claim remains idempotent');
 assert.equal(await bookings.setDiditSession.handler(ctx,{...renewalArgs,sessionId:'didit-renewed-session',claimId:'renewal-two'}),false,'an unowned renewal cannot replace the session');
 assert.equal(await bookings.releaseDiditSessionClaim.handler(ctx,{bookingId:first._id,claimId:'renewal-two'}),false,'a different request cannot release the active claim');
 assert.equal(await bookings.releaseDiditSessionClaim.handler(ctx,{bookingId:first._id,claimId:'renewal-one'}),true,'a failed renewal releases its claim');
 assert.equal(renter.activeDiditVerification.sessionId,'didit-source-session','a failed renewal restores the existing session for dependent rentals');
 assert.deepEqual(await bookings.claimDiditSessionSlot.handler(ctx,{...renewalArgs,claimId:'renewal-one'}),{kind:'owner'},'a failed renewal can be retried immediately');
 assert.equal(await bookings.setDiditSession.handler(ctx,{...renewalArgs,sessionId:'didit-renewed-session',claimId:'renewal-one'}),true,'the original renewal claim remains able to bind its session');
 assert.equal(renter.activeDiditVerification.sessionId,'didit-renewed-session');
 assert.equal(second.verificationInProgressFrom,first._id,'saving the source session preserves the dependent link');
 assert.equal(await bookings.claimDiditSessionSlot.handler(ctx,{bookingId:second._id,claimId:'dependent-replay'}).then(result=>result.kind), 'waiting','retries keep waiting on the same source rather than creating duplicate sessions');
 await db.patch(first._id,{idVerifyStatus:'manual_review'});
 const reviewReplay=await bookings.claimDiditSessionSlot.handler(ctx,{bookingId:second._id,claimId:'dependent-review-replay'});
 assert.deepEqual(reviewReplay,{kind:'waiting',sourceBookingId:first._id},'manual review keeps the source link open without approving the dependent');
 assert.equal(second.idVerifyStatus,'required');
 await db.patch(first._id,{idVerifyStatus:'rejected'});
 await bookings.releaseVerificationDependents.handler(ctx,{sourceBookingId:first._id,sessionId:'didit-renewed-session',cursor:null});
 assert.equal(second.verificationInProgressFrom,undefined,'a declined source releases the dependent to use its own verification');
 assert.equal(second.idVerifyStatus,'required','source decline never marks another booking verified');
 assert.equal(await bookings.claimDiditSessionSlot.handler(ctx,{bookingId:second._id,claimId:'dependent-own-session'}).then(result=>result.kind),'owner','a declined source allows a separate session bound to the second booking');
 assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:second._id,sessionId:'didit-dependent-session',claimId:'dependent-own-session'}),true);
 assert.equal(second.diditSessionId,'didit-dependent-session');
 assert.notEqual(second.diditSessionId,first.diditSessionId,'the provider sessions remain bound to distinct booking IDs');
 assert.deepEqual({payment:second.stripePaymentIntentId,checkout:second.stripeCheckoutSessionId,reservation:second.reservationId,lines:second.lineItems},paymentBefore,'verification linking never changes the independent payment or stock reservation');

 const approvedRenter=account('approved-check@example.invalid');
 const approvedSource=put('bookings',{accountId:approvedRenter._id,accountAccessRequired:false,guestEmail:approvedRenter.email,agreementName:approvedRenter.name,billingAddress:approvedRenter.address,status:'confirmed',verificationProvider:'didit',idVerificationSource:'didit',idVerifyStatus:'verified',diditSessionId:'approved-source-session',idVerifiedAt:now,verificationExpiresAt:now+90*day,verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},renterPersonKey:'verified-person',lineItems:scheduled});
 approvedRenter.rentalVerification={sourceBookingId:approvedSource._id,name:'mulan example',address:'25 example road sw1a 1aa',verifiedAt:now,expiresAt:now+90*day};
 const archive=put('verification_archives',{accountId:approvedRenter._id,bookingId:approvedSource._id,sessionId:approvedSource.diditSessionId,status:'pending',attempts:0,dueAt:now,createdAt:now});
 const dependent=pendingRental(approvedRenter,{verificationInProgressFrom:approvedSource._id,reservationId:'reservation-dependent'});
 assert.equal(await bookings.reuseVerificationCandidate.handler(ctx,{bookingId:dependent._id}),null,'a provider approval with incomplete archive bytes is not yet reusable');
 assert.equal(dependent.idVerifyStatus,'required','a linked booking stays pending while the approved source archive is unconfirmed');
 archive.status='complete';require('./lib/verificationFiles.cjs').seedVerificationFiles(put,archive);
 const candidate=await bookings.reuseVerificationCandidate.handler(ctx,{bookingId:dependent._id});
 assert.equal(candidate?.source?._id,approvedSource._id,'only the source booking with a complete, readable archive can be reused');
 assert.equal(await bookings.applyVerificationReuse.handler(ctx,{bookingId:dependent._id,sourceBookingId:approvedSource._id,personKey:approvedSource.renterPersonKey}),true);
 assert.equal(dependent.idVerifyStatus,'verified','a fully approved Didit source and integrity-checked archive complete the dependent verification');
 assert.equal(dependent.verificationReusedFrom,approvedSource._id);
 assert.equal(dependent.verificationInProgressFrom,undefined);
 assert.equal(dependent.verificationExpiresAt,now+90*day,'reuse preserves the original provider approval timestamp and exact 90-day expiry');
 assert.equal(dependent.stripePaymentIntentId.startsWith('pi-'),true,'approval reuse leaves the dependent booking’s own payment intact');
 assert.equal(dependent.reservationId,'reservation-dependent','approval reuse leaves the dependent booking’s own stock allocation intact');

 const freshRental=pendingRental(approvedRenter,{status:'confirmed',idVerifyStatus:'requires_input',verificationFreshRequired:true,reservationId:'admin-fresh-verification'});
 const freshClaim=await bookings.claimDiditSessionSlot.handler(ctx,{bookingId:freshRental._id,claimId:'admin-fresh-session'});
 assert.deepEqual(freshClaim,{kind:'owner'},'an explicit admin recheck receives a fresh provider session slot instead of linking to a different rental');
 assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:freshRental._id,sessionId:'admin-fresh-session-id',claimId:'admin-fresh-session'}),true,'the required full recheck bypasses otherwise-eligible 90-day reuse');
 assert.equal(freshRental.diditSessionId,'admin-fresh-session-id');
 assert.equal(freshRental.verificationFreshRequired,undefined,'the no-reuse marker ends only after the new session is bound');
 assert.equal(freshRental.idVerifyStatus,'processing');

 console.log('PASS active Didit source: serialized concurrent claims, source-bound session, waiting/replay, review and decline transitions, independent payments/stock, archive-gated reuse, and exact 90-day expiry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
