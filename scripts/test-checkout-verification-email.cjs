const assert = require('node:assert/strict');
const {load} = require('./lib/rentalTestHarness.cjs');
const notify = load('convex/notify.ts'), invoice = load('convex/invoice.ts');
const {SECURITY_POLICY_VERSION} = load('shared/rentalSecurity.ts');
const booking = {guestEmail:'fixture@example.invalid',status:'confirmed',total:100,subtotal:100,depositAmount:0,depositHoldAmount:0,securityPolicyVersion:SECURITY_POLICY_VERSION,savedCardLimit:250,lineItems:[{title:'Cinema camera',start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),lineTotal:100}]};
const ctx = {runQuery:async()=>booking};
delete process.env.INVOICE_SECRET;
(async()=>{
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
 console.log('PASS actual confirmation and receipt renderers: new saved-card permission outside paid total, no obsolete deposit/hold copy, historical deposit/hold preserved. No emails sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
