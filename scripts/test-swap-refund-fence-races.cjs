const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL='true';
let authorityAvailable=true;
setMock('./lib/rentalSwapAuthority',{swapAuthorityAvailable:()=>authorityAvailable,assertSwapAuthorityAvailable:()=>{}});
setMock('./swapStockOperations',{assertStockExecution:async()=>{}});
const messages=[],alerts=[];
setMock('./lib/rentalChat',{postRentalMessage:async(_ctx,args)=>messages.push(args)});
setMock('./lib/adminPush',{queueOwnerNotification:async(_ctx,args)=>alerts.push(args)});
const state=load('convex/rentalSwapState.ts'),ctx={db,scheduler:{runAfter:async()=>{}}};
function scenario(kind){const account=put('accounts',{email:`${kind}@example.invalid`}),other=put('accounts',{email:`other-${kind}@example.invalid`});const booking=put('bookings',{accountId:kind==='owner-changed'?other._id:account._id,status:'confirmed',idVerifyStatus:'verified',idVerifiedAt:Date.now()});const refund=put('rental_refunds',{bookingId:booking._id,status:'succeeded',amountPence:1000});const swap=put('rental_item_swaps',{bookingId:booking._id,accountId:account._id,status:'refund_pending',lineIndex:0,oldLine:{title:'Previous lens',qty:1,lineTotal:20},newLine:{title:'Replacement lens',qty:1,lineTotal:10},quote:{deltaPence:-1000},stockAppliedAt:Date.now(),creditsRestoredAt:Date.now(),refundJobId:refund._id});booking.activeItemSwapId=swap._id;const receipt=put('swap_stock_applied_receipts',{bookingId:booking._id,swapId:swap._id,deliveryState:'acknowledged',stockRisk:kind==='stock-risk'});return {booking,swap,receipt};}
(async()=>{
 for(const kind of ['stock-risk','owner-changed','clear','authority-disabled','bridge-disabled']){
   const {booking,swap,receipt}=scenario(kind),before=messages.length;
   authorityAvailable=kind!=='authority-disabled';
   process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL=kind==='bridge-disabled'?'false':'true';
   if(kind==='authority-disabled'||kind==='bridge-disabled'){
     await assert.rejects(state.apply.handler(ctx,{id:swap._id}),/Shared stock authority is unavailable/);
     assert.equal(swap.status,'refund_pending');
     assert.equal(booking.activeItemSwapId,swap._id,`${kind} must preserve the handover fence`);
     assert.equal(receipt.auditDueAt,undefined);
     assert.equal(messages.length,before);
     continue;
   }
   assert((await state.apply.handler(ctx,{id:swap._id})).applied);
   if(kind==='clear'){
     assert.equal(booking.activeItemSwapId,undefined);
     assert.match(messages.at(-1).text,/change is complete/);
   }else{
     assert.equal(booking.activeItemSwapId,swap._id,`${kind} must preserve the handover fence`);
     assert.ok(receipt.auditDueAt);
     if(kind==='stock-risk')assert.match(messages.at(-1).text,/still being checked/);
     else {
       assert.equal(messages.length,before,'Changed ownership must not receive a customer message');
       assert.ok(alerts.some(alert=>alert.eventKey===`refund-owner-changed:${swap.refundJobId}`));
     }
   }
 }
 console.log('PASS refund settlement fences: recorded stock conflict and changed ownership remain locked; synthetic data only.');
})().catch(error=>{console.error(error);process.exitCode=1});
