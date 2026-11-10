const assert = require('node:assert/strict');
const {load} = require('./lib/rentalTestHarness.cjs');
const notify = load('convex/notify.ts'), invoice = load('convex/invoice.ts'), settings = load('convex/settings.ts');
const {SECURITY_POLICY_VERSION} = load('shared/rentalSecurity.ts');
const booking = {guestEmail:'fixture@example.invalid',status:'confirmed',total:100,subtotal:100,depositAmount:0,depositHoldAmount:0,securityPolicyVersion:SECURITY_POLICY_VERSION,savedCardLimit:250,lineItems:[{title:'Cinema camera',start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),lineTotal:100}]};
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
 const verificationCtx={runQuery:async ref=>ref==='settings.pickupAddress'?{businessAddress:address}:{...booking,fulfilment:'pickup',paidConfirmedAt:Date.now(),verificationProvider:'didit',idVerificationSource:'didit',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},idVerifiedAt:Date.now(),idVerifyStatus:'verified'},
  runAction:async()=>({attachments:[{filename:'receipt.pdf',content:'fixture'}]})};
 const verification=await notify.verificationEmail.handler(verificationCtx,{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.match(verification.html,/Your identity and address verification is approved for this rental\./);
 assert.doesNotMatch(verification.html,/remaining document checks and approval before handover/);
 assert.match(verification.html,/The Grand Building<br>Meet outside &lt;Waterstones&gt; &amp; wait/,'pickup instructions retain line breaks and escape HTML');
 assert.match(verification.html,/rental invoice is attached as a PDF/,'verification emails describe the attached PDF as an invoice');
 assert.doesNotMatch(verification.html,/payment receipt is attached/);
 assert.match(verification.html,/dbcinemarentals@gmail\.com/,'verified renters receive the current support address');
 address='Updated location';
 const updated=await notify.verificationEmail.handler(verificationCtx,{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.match(updated.html,/Updated location/,'new verification emails read the current saved address');
 assert(!updated.html.includes('The Grand Building'));
 const pending=await notify.verificationEmail.handler({runQuery:async()=>({...booking,idVerifyStatus:'requires_input'}),runAction:async()=>{throw Error('Invoice must not run');}},{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.equal(pending,null,'An outdated approval email cannot send while verification needs input');
 const expired=await notify.verificationEmail.handler({runQuery:async()=>({...booking,status:'confirmed',paidConfirmedAt:Date.now(),verificationProvider:'didit',idVerificationSource:'didit',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},idVerifyStatus:'verified',idVerifiedAt:Date.now()-91*86400000,verificationExpiresAt:Date.now()-1}),runAction:async()=>{throw Error('Invoice must not run');}},{bookingId:'owned-fixture',status:'verified',prepareOnly:true});
 assert.equal(expired,null,'An outdated approval email cannot send after verification expires');
 console.log('PASS actual confirmation and receipt renderers: new saved-card permission outside paid total, no obsolete deposit/hold copy, historical deposit/hold preserved. No emails sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
