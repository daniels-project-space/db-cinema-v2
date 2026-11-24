const assert = require('node:assert/strict');
const {load} = require('./lib/rentalTestHarness.cjs');
const notify = load('convex/notify.ts'), invoice = load('convex/invoice.ts'), settings = load('convex/settings.ts');
const {SECURITY_POLICY_VERSION} = load('shared/rentalSecurity.ts');
const booking = {guestEmail:'fixture@example.invalid',status:'confirmed',paidConfirmedAt:Date.now(),total:100,subtotal:100,depositAmount:0,depositHoldAmount:0,securityPolicyVersion:SECURITY_POLICY_VERSION,savedCardLimit:250,verificationProvider:'didit',idVerifyStatus:'verified',idVerificationSource:'didit',idVerifiedAt:Date.now(),verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},lineItems:[{title:'Cinema camera',start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),lineTotal:100}]};
const ctx = {runQuery:async()=>booking};
delete process.env.INVOICE_SECRET;
(async()=>{
 const pickupCtx={db:{query:()=>({first:async()=>null})}};
 const defaultPickup=await settings.pickupAddress.handler(pickupCtx,{});
 assert.match(defaultPickup.businessAddress,/The Grand Building[\s\S]*WC2N 5EJ[\s\S]*outside the Waterstones bookstore at Trafalgar Square/);
 pickupCtx.db.query=()=>({first:async()=>({businessAddress:"  "})});
 assert.deepEqual(await settings.pickupAddress.handler(pickupCtx,{}),defaultPickup,'blank stored settings keep the reliable pickup address');
 for (const action of [notify.bookingAlert,invoice.invoiceEmail]) {
  const payload=await action.handler(ctx,{bookingId:'owned-fixture',prepareOnly:true});
  assert.equal(payload.to,booking.guestEmail);
  if(action===notify.bookingAlert){assert.match(payload.html,/Ask Gaffer about your rental/);assert.match(payload.html,/account\?rental=owned-fixture#chat/);}
  assert.match(payload.html,/Saved-card collection permission/);
  assert.match(payload.html,/£250\.00/);
  assert.match(payload.html,/No security money was taken or blocked/);
  assert(!/Refundable deposit|card authorisation/.test(payload.html),'A new-policy receipt cannot imply that security funds were paid or held');
  assert.match(payload.html,/£100\.00/,'The permission must not inflate the payment total');
 }
 booking.securityPolicyVersion=undefined;booking.depositAmount=25;booking.depositHoldAmount=100;
 for (const action of [notify.bookingAlert,invoice.invoiceEmail]) {
  const payload=await action.handler(ctx,{bookingId:'owned-fixture',prepareOnly:true});
  assert.match(payload.html,/Refundable deposit paid/);
  assert.match(payload.html,/£25\.00/);
  assert.match(payload.html,/card authorisation is separate/);
  assert(!payload.html.includes('Saved-card collection permission'),'Historical accepted security terms remain intact');
 }
let address='The Grand Building\nMeet outside <Waterstones> & wait';
const verifiedAt=Date.UTC(2030,0,1,12);
const verificationCtx={runQuery:async ref=>ref==='settings.pickupAddress'?{businessAddress:address}:{...booking,fulfilment:'pickup',paidConfirmedAt:Date.now(),verificationProvider:'didit',idVerificationSource:'didit',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},idVerifiedAt:verifiedAt,idVerifyStatus:'verified'},
  runAction:async()=>({attachments:[{filename:'receipt.pdf',content:'fixture'}]})};
 const verification=await notify.verificationEmail.handler(verificationCtx,{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
if(process.env.DBC_EMAIL_PREVIEW)require('node:fs').writeFileSync(process.env.DBC_EMAIL_PREVIEW,verification.html);
assert.equal(verification.subject,"Your rental is confirmed");
assert.match(verification.html,/Questions about your booking or its equipment\? Ask Gaffer in your rental conversation/);
assert.match(verification.html,/href="https:\/\/dbcinemarentals\.com\/account\?rental=owned-fixture#chat"/,'confirmation opens the exact rental chat without embedding access credentials');
assert.match(verification.html,/Ask Gaffer about your rental/);
assert.match(verification.html,/Payment and verification passed\./);
assert.match(verification.html,/Your verification approval is valid for 90 days from approval, until 1 April 2030\. Eligible future rentals on this account can reuse it, so you will not need to verify again during that period\./,'the automated email states the exact 90-day reuse window, start point, no-reverification promise and expiry date');
assert.match(verification.html,/href="mailto:dbcinemarentals@gmail\.com"[^>]*>email DB Cinema<\/a>/,'every branded transaction email gives a clickable support email');
 assert.doesNotMatch(verification.html,/remaining document checks and approval before handover/);
 assert.match(verification.html,/The Grand Building<br>Meet outside &lt;Waterstones&gt; &amp; wait/,'pickup instructions retain line breaks and escape HTML');
 assert.match(verification.html,/href="tel:\+447933019849">\+44 7933 019849</,'the post-verification approval email includes Leo’s clickable support number');
 assert.doesNotMatch(verification.html,/Open Waterstones, Trafalgar Square in Google Maps/,'a partial pickup address does not publish a guessed map location');
 assert.match(verification.html,/rental invoice is attached as a PDF/,'verification emails describe the attached PDF as an invoice');
 assert.doesNotMatch(verification.html,/payment receipt is attached/);
 assert.match(verification.html,/dbcinemarentals@gmail\.com/,'verified renters receive the current support address');
 address='Updated location';
 const updated=await notify.verificationEmail.handler(verificationCtx,{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.match(updated.html,/Updated location/,'new verification emails read the current saved address');
 assert(!updated.html.includes('The Grand Building'));
 address='The Grand Building\nTrafalgar Square\nLondon WC2N 5EJ';
 const exactPickup=await notify.verificationEmail.handler(verificationCtx,{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.match(exactPickup.html,/Please meet us at the confirmed time outside the Waterstones bookstore at Trafalgar Square\./,'the approved pickup email includes the handover meeting instruction');
 assert.match(exactPickup.html,/Open pickup point in Google Maps/,'the exact approved pickup address adds the map link');
 const beforeVerification=await notify.verificationEmail.handler({runQuery:async()=>({...booking,status:'pending_verification',checkoutPaidAt:Date.now(),idVerifyStatus:'processing'}),runAction:async()=>({attachments:[]})},{bookingId:'owned-fixture',status:'processing',prepareOnly:true});
 assert.doesNotMatch(beforeVerification.html,/Ask Gaffer about your rental/,'pending verification keeps its verification action');
 assert.doesNotMatch(beforeVerification.html,/tel:\+447933019849|\+44 7933 019849/,'the Leo contact is hidden until verification and confirmation gates pass');
 const pending=await notify.verificationEmail.handler({runQuery:async()=>({...booking,idVerifyStatus:'requires_input'}),runAction:async()=>{throw Error('Invoice must not run');}},{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.equal(pending,null,'An outdated approval email cannot send while verification needs input');
 const expired=await notify.verificationEmail.handler({runQuery:async()=>({...booking,status:'confirmed',paidConfirmedAt:Date.now(),verificationProvider:'didit',idVerificationSource:'didit',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},idVerifyStatus:'verified',idVerifiedAt:Date.now()-91*86400000,verificationExpiresAt:Date.now()-1}),runAction:async()=>{throw Error('Invoice must not run');}},{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.equal(expired,null,'An outdated approval email cannot send after verification expires');
 console.log('PASS actual confirmation and receipt renderers: new saved-card permission outside paid total, no obsolete deposit/hold copy, historical deposit/hold preserved. No emails sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
