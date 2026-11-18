const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const notify=h.load('convex/notify.ts'),{DIDIT_ID_PHOTO_MISSING,DIDIT_ADDRESS_UNSUPPORTED,DIDIT_ADDRESS_DATE_UNREADABLE,DIDIT_FAILURE_SUPPORT,diditFailureReason}=h.load('shared/diditFailureReason.ts');
(async()=>{
 const b={status:'pending_verification',checkoutPaidAt:100,idVerifyStatus:'rejected',guestEmail:'test@example.invalid',verificationNote:DIDIT_ID_PHOTO_MISSING};
 const ctx={runQuery:async()=>b};
 const email=await notify.verificationEmail.handler(ctx,{bookingId:'fixture-booking',status:'rejected',prepareOnly:true});
 assert(email.html.includes('could not find a photo'));assert(email.html.includes('/account/verification/fixture-booking'));
 const decision=risk=>({id_verifications:[{status:'Approved',warnings:[{risk:'DOCUMENT_EXPIRED',log_type:'information'}]}],poa_verifications:[{status:'Declined',warnings:[{risk,log_type:'error'}]}]});
 assert.equal(diditFailureReason(decision('INVALID_DOCUMENT_TYPE')),DIDIT_ADDRESS_UNSUPPORTED,'an old informational ID warning must not obscure the failed address check');
 assert.equal(diditFailureReason(decision('UNABLE_TO_VALIDATE_DOCUMENT_AGE')),DIDIT_ADDRESS_DATE_UNREADABLE);
 assert.equal(diditFailureReason({...decision('INVALID_DOCUMENT_TYPE'),id_verifications:[{status:'Declined',warnings:[{risk:'SUSPECTED_DOCUMENT_MANIPULATION',log_type:'error'}]}]}),DIDIT_FAILURE_SUPPORT);
 b.verificationNote=DIDIT_ADDRESS_DATE_UNREADABLE;
 const addressEmail=await notify.verificationEmail.handler(ctx,{bookingId:'fixture-booking',status:'rejected',prepareOnly:true});
 assert(addressEmail.html.includes('clearly readable issue date'),'the actual customer email includes the useful address-document reason');
 b.verificationNote='PRIVATE_PROVIDER_CODE';
 const safe=await notify.verificationEmail.handler(ctx,{bookingId:'fixture-booking',status:'rejected',prepareOnly:true});
 assert(!safe.html.includes('PRIVATE_PROVIDER_CODE'),'unreviewed provider details are never included in renter email');
 console.log('PASS failure email uses an actionable reason and verification link, without raw provider details.');
})().catch(e=>{console.error(e);process.exitCode=1});
