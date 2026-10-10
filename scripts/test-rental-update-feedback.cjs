const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const {rentalUpdateFeedback:feedback}=h.load('shared/rentalUpdateFeedback.ts');
const scheduled=feedback({applied:true,kind:'swap',status:'scheduled'});assert.match(scheduled.title,/Replacement applied/);assert.match(scheduled.body,/scheduled for your agreed pickup/);assert(!scheduled.body.includes('waiting'));
const heldButUnapplied=feedback({applied:false,kind:'swap',status:'held'});assert.match(heldButUnapplied.title,/pending/,'A hold alone cannot claim equipment was updated');
assert.match(feedback({applied:true,kind:'addition',status:'scheduled'}).title,/Items added/);
assert.match(feedback({applied:true,kind:'draft',status:'draft_applied'}).body,/Continue verification/,'Paid draft is not a verified rental');
for(const status of ['failed','requires_payment_method','requires_confirmation']){const r=feedback({applied:true,kind:'swap',status});assert.match(r.title,/Replacement applied/);assert.match(r.body,/needs attention/);}
assert.match(feedback({applied:true,kind:'swap',status:'requires_action'}).body,/bank approval/);
assert.match(feedback({applied:false,kind:'swap',status:'requires_action'}).title,/pending/);
assert.match(feedback({applied:false,status:'refund_pending'}).body,/original payment method/);
for(const status of ['refunded','expired']){const r=feedback({applied:false,status});assert.match(r.title,/Equipment update closed/);assert(!r.body.includes('cancelled booking'));}
assert.match(feedback({applied:false,status:null}).body,/do not pay again/);
const combined=feedback({applied:false,kind:'swap',status:'swap_refund_pending'});assert.match(combined.title,/Deposit paid/);assert.match(combined.body,/original kit remains reserved/);assert(!combined.body.includes('withdrawn'));
for(const status of ['swap_refund_failed','swap_settlement_review']){const r=feedback({applied:false,kind:'swap',status});assert.match(r.title,/team review/);assert.match(r.body,/do not pay again/);}
console.log('PASS post-checkout feedback: equipment receipt independent of scheduled/failed/bank-action hold, draft verification, refund progress and closed update independent of rental cancellation.');
