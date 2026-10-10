const assert=require('node:assert/strict');
const h=require('./lib/rentalTestHarness.cjs');
const {seedVerificationFiles}=require('./lib/verificationFiles.cjs');
process.env.ADMIN_TOKEN='reuse-readiness-admin';
const archive=h.load('convex/verificationArchive.ts'),bookings=h.load('convex/bookings.ts'),accounts=h.load('convex/accounts.ts'),analytics=h.load('convex/analytics.ts'),feed=h.load('convex/rmv2_sync.ts');
const pending=h.load('shared/dashboardPreviews.ts').dashboardVerificationPending;
const now=Date.UTC(2030,0,1),day=86400000;Date.now=()=>now;
const account=h.put('accounts',{email:'current-owner@example.invalid',name:'Permanent owner'});
const foreign=h.put('accounts',{email:'historic-owner@example.invalid',name:'Recycled email owner'});
h.put('sessions',{token:'rightful-renter',accountId:account._id,expiresAt:now+day});
h.put('sessions',{token:'foreign-renter',accountId:foreign._id,expiresAt:now+day});
const listing=h.put('listings',{title:'Sony FX3',itemType:'camera',r2Images:['https://fixture.invalid/fx3.jpg']});
const source=h.put('bookings',{accountId:account._id,guestEmail:foreign.email,status:'returned',actualReturnedAt:now-day,diditSessionId:'private-original-session',idVerificationSource:'didit',idVerifyStatus:'verified',idVerifiedAt:now-day,verificationExpiresAt:now+89*day,lineItems:[]});
const baseline={...source};
const saved=h.put('verification_archives',{bookingId:source._id,accountId:account._id,sessionId:source.diditSessionId,source:'didit',status:'complete'});
const files=seedVerificationFiles(h.put,saved);
const rental=h.put('bookings',{accountId:account._id,guestEmail:foreign.email,status:'confirmed',stripeCheckoutSessionId:'isolated-paid-checkout-bearer',verificationReusedFrom:source._id,idVerificationSource:'reused_didit',idVerifyStatus:'verified',idVerifiedAt:source.idVerifiedAt,verificationExpiresAt:source.verificationExpiresAt,verificationProvider:'didit',depositHoldAmount:0,lineItems:[{listingId:listing._id,title:listing.title,qty:1,start:now+day,end:now+2*day}]});
const ctx={db:h.db,scheduler:{runAfter:async()=>{}}};
const progress=()=>bookings.verificationProgress.handler(ctx,{bookingId:rental._id,token:'rightful-renter'});
const dashboard=()=>analytics.adminSummary.handler(ctx,{token:process.env.ADMIN_TOKEN,now});
const manager=()=>feed.forRmv2SyncOne.handler(ctx,{bookingId:rental._id});
async function closed(label){
 await assert.rejects(()=>archive.assertVerificationArchive(ctx,rental),/Reused verification|fully archived/,label);
 assert.equal((await progress()).verificationArchiveReady,false,label+' in renter progress');
 assert.equal((await accounts.myBookings.handler(ctx,{token:'rightful-renter'})).find(b=>b._id===rental._id).verificationArchiveReady,false,label+' in account cards');
 const row=(await dashboard()).awaitingCollection.find(r=>r._id===rental._id);
 assert.equal(row.verificationReady,false,label+' in dashboard');assert.equal(pending(row),true);assert.equal(row.kit[0].heroImage,'https://fixture.invalid/fx3.jpg');
 assert.equal((await manager()).verification.documentsApproved,false,label+' in manager bridge');
 await assert.rejects(()=>bookings.adminSetStatus.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:rental._id,status:'active'}),/Reused verification|fully archived/,label+' at handover');
 assert.equal(rental.status,'confirmed','Denied handover leaves rental status untouched');
}
(async()=>{
 await archive.assertVerificationArchive(ctx,rental);
 assert.equal(await bookings.verificationProgress.handler(ctx,{bookingId:rental._id,token:'foreign-renter'}),null);
 assert.equal(await bookings.verificationProgress.handler(ctx,{bookingId:rental._id,checkoutSessionId:'wrong-bearer'}),null);
 assert.equal((await progress()).verificationArchiveReady,true);assert.equal((await manager()).verification.documentsApproved,true);
 assert.equal((await dashboard()).awaitingCollection[0].verificationReady,true,'Valid source follows its permanent account despite recycled guest email');
 await h.db.patch(source._id,{_creationTime:rental._creationTime+1,verificationExpiresAt:now});
 let cards=await accounts.myBookings.handler(ctx,{token:'rightful-renter'});
 assert.equal(cards.find(b=>b._id===source._id).verificationArchiveReady,true,'Private original copies stay available for insurance despite expired reuse approval');
 assert.equal(cards.find(b=>b._id===rental._id).verificationArchiveReady,false,'Direct source cache cannot approve expired reused verification');
 await h.db.patch(source._id,{_creationTime:baseline._creationTime});
 cards=await accounts.myBookings.handler(ctx,{token:'rightful-renter'});
 assert.equal(cards.find(b=>b._id===source._id).verificationArchiveReady,true,'Failed reused eligibility cannot hide the original retained archive when reuse is read first');
 await h.db.patch(source._id,baseline);
 await h.db.delete(source._id);await closed('Deleted source cannot inherit the manual archive exemption');h.put('bookings',{...baseline});
 for(const patch of [{accountId:foreign._id},{idVerifyStatus:'requires_input'},{diditSessionId:undefined},{idVerificationSource:'manual'},{verificationExpiresAt:now},{documentExpiresAt:now}]){
  await h.db.patch(source._id,patch);await closed(JSON.stringify(patch));
  await h.db.patch(source._id,{...baseline,documentExpiresAt:undefined});
 }
 await h.db.delete(files[0].storageId);await closed('Missing original identity bytes');
 h.put('_storage',{_id:files[0].storageId,sha256:files[0].sha256,size:files[0].size,contentType:files[0].contentType});
 // Legacy email-only source is still supported only when it resolves to this owner.
 await h.db.patch(source._id,{accountId:undefined,guestEmail:account.email});await archive.assertVerificationArchive(ctx,rental);
 await h.db.patch(source._id,{guestEmail:foreign.email});await closed('Recycled legacy source mailbox cannot transfer verification');
 await h.db.patch(source._id,baseline);
 assert.equal((await progress()).verificationArchiveReady,true);assert.equal((await manager()).verification.documentsApproved,true);
 await h.db.delete(account._id);
 await assert.rejects(()=>archive.assertVerificationArchive(ctx,rental),/Reused verification/,'Missing permanent owner cannot fall back to a recycled guest email');
 assert.equal(await progress(),null,'Deleted account session does not retain private progress access');
 assert.equal((await bookings.verificationProgress.handler(ctx,{bookingId:rental._id,checkoutSessionId:rental.stripeCheckoutSessionId})).verificationArchiveReady,false,'Exact paid bearer cannot revive a missing account-bound approval');
 h.put('accounts',{...account});
 const output=JSON.stringify(await progress());assert(!output.includes(source.diditSessionId));assert(!output.includes(files[0].storageId));
 const manual=h.put('bookings',{accountId:account._id,status:'confirmed',idVerifyStatus:'verified',idVerificationSource:'manual'});
 await archive.assertVerificationArchive(ctx,manual);
 console.log('PASS real reused verification: deleted/reassigned/revoked/source-session/expiry/bytes guards across archive, renter progress, dashboard, manager and transactional handover; permanent/recycled email binding, valid recovery and direct manual exemption. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
