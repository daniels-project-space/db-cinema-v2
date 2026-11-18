const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const notify=h.load('convex/notify.ts'),{DIDIT_ID_PHOTO_MISSING}=h.load('shared/diditFailureReason.ts');
(async()=>{
 const b={status:'pending_verification',checkoutPaidAt:100,idVerifyStatus:'rejected',guestEmail:'test@example.invalid',verificationNote:DIDIT_ID_PHOTO_MISSING};
 const ctx={runQuery:async()=>b};
 const email=await notify.verificationEmail.handler(ctx,{bookingId:'fixture-booking',status:'rejected',prepareOnly:true});
 assert(email.html.includes('could not find a photo'));assert(email.html.includes('/account/verification/fixture-booking'));
 b.verificationNote='PRIVATE_PROVIDER_CODE';
 const safe=await notify.verificationEmail.handler(ctx,{bookingId:'fixture-booking',status:'rejected',prepareOnly:true});
 assert(!safe.html.includes('PRIVATE_PROVIDER_CODE'),'unreviewed provider details are never included in renter email');
 console.log('PASS failure email uses an actionable reason and verification link, without raw provider details.');
})().catch(e=>{console.error(e);process.exitCode=1});
