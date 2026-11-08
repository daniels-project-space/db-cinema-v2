const assert=require("node:assert/strict");
const {load,db,put,tables,setMock}=require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN="member-swap-owner";process.env.RENTAL_ITEM_SWAP_ENABLED="true";process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL="true";
setMock("./lib/rentalChat",{...load("convex/lib/rentalChat.ts"),postRentalMessage:async()=>{}});
setMock("./lib/rentalSwapAuthority",{assertSwapAuthorityAvailable:()=>{},swapAuthorityAvailable:()=>true});
const state=load("convex/rentalSwapState.ts"),ctx={db,scheduler:{runAfter:async()=>{}}};
async function markRefundSucceeded(id,refund){const paymentIntentId=`pi_refund_${id}`;await db.patch(refund._id,{allocations:[{paymentIntentId,amountPence:refund.amountPence}],parts:[{paymentIntentId,stripeRefundId:`re_${id}`,amountPence:refund.amountPence,status:"succeeded"}],status:"succeeded"});}
const account=put("accounts",{email:"member-swap@example.invalid"});
put("sessions",{accountId:account._id,token:"member-renter",expiresAt:Date.now()+86400000});
put("rmv2_sync_state",{key:"shared-stock-v1",status:"ok",lastSyncedAt:Date.now(),cursor:JSON.stringify({checkedAt:Date.now()})});
const grant=put("membership_credit_grants",{accountId:account._id,invoiceId:"member-invoice",initialCreditAppliedPence:2000,revokedPence:0});
const refund=put("credits",{accountId:account._id,kind:"refund",currency:"GBP",amount:10,remaining:0});
const earned=put("credits",{accountId:account._id,kind:"earned",currency:"GBP",amount:15,remaining:0,membershipGrantId:grant._id,membershipInvoiceId:grant.invoiceId});
const start=Date.UTC(2030,1,1);
function listing(title,daily){const unit=put("inventory_units",{name:title,quantityOwned:1});return {unit,item:put("listings",{title,active:true,depositAmount:100,pricing:{daily},components:[{inventoryUnitId:unit._id,qty:1}]})};}
const first=listing("First",10),old=listing("Old",90),next=listing("Next",5);
const line=(item,total)=>({listingId:item._id,title:item.title,start,end:start,qty:1,lineTotal:total});
const booking=put("bookings",{accountId:account._id,guestEmail:account.email,status:"confirmed",subtotal:100,discount:0,total:55,depositAmount:0,pricingVersion:"single-benefit-v1",benefitKind:"earned_credit",creditApplied:45,membershipCreditApplied:20,refundCreditApplied:10,earnedCreditApplied:15,membershipCreditGrantId:grant._id,
 lineItems:[line(first.item,10),line(old.item,90)],checkoutLineFunding:[{listingId:first.item._id,start,end:start,qty:1,gross:10,discount:0,membershipCredit:10,accountCredit:0,card:0},{listingId:old.item._id,start,end:start,qty:1,gross:90,discount:0,membershipCredit:10,accountCredit:25,card:55}],creditAllocations:[{creditId:refund._id,kind:"refund",amount:10},{creditId:earned._id,kind:"earned",amount:15}],checkoutLineCreditSources:[{lineIndex:1,creditId:refund._id,kind:"refund",amount:10},{lineIndex:1,creditId:earned._id,kind:"earned",amount:15}],replacementValues:[{listingId:first.item._id,unitPence:10000},{listingId:old.item._id,unitPence:10000}]});
for(const entry of [first,old])put("reservations",{bookingId:booking._id,listingId:entry.item._id,inventoryUnitId:entry.unit._id,start,end:start,qty:1,source:"site",status:"confirmed"});
(async()=>{
 const args={token:process.env.ADMIN_TOKEN,bookingId:booking._id,lineIndex:1,newListingId:next.item._id},preview=await state.preview.handler(ctx,args);
 assert.equal(preview.quote.deltaPence,-5500);
 const id=await state.propose.handler(ctx,{...args,requestId:"member-multiline-swap-fixture",quoteSnapshot:preview.quoteSnapshot,confirmed:true});
 await state.accept.handler(ctx,{token:"member-renter",id,expectedDeltaPence:-5500});
 require('./lib/rentalTestHarness.cjs').confirmSyntheticSwapStock(id);
 const refundJob=await state.prepareRefund.handler(ctx,{id});assert.equal(refundJob.amountPence,5500);
 await assert.rejects(state.apply.handler(ctx,{id,stageRefund:true}),/cannot be applied before its refund succeeds/);
 assert.deepEqual(booking.lineItems.map(row=>row.listingId),[first.item._id,old.item._id]);
 assert.equal(booking.membershipCreditApplied,20);assert.equal(booking.creditApplied,45);assert.equal(tables.get("credits").filter(row=>row.reason===`swap_restored_credit:${id}`).length,0);
 await markRefundSucceeded(id,refundJob);
 assert((await state.apply.handler(ctx,{id})).applied);
 assert.equal(booking.membershipCreditApplied,15);assert.equal(booking.total,55,"The original charged total remains immutable; its downgrade refund is recorded separately");assert.equal(booking.creditApplied,15);assert.equal(booking.refundCreditApplied,0);assert.equal(booking.earnedCreditApplied,0);
 assert.deepEqual(booking.checkoutLineFunding.map(row=>[row.membershipCredit,row.accountCredit,row.card]),[[10,0,0],[5,0,0]]);
 assert.deepEqual(booking.checkoutLineCreditSources,[]);
 const issued=tables.get("credits").filter(row=>row.reason===`swap_restored_credit:${id}`);
 assert.deepEqual(issued.map(row=>[row.kind,row.amount]).sort(),[["earned",5],["earned",15],["refund",10]].sort());
 assert(issued.filter(row=>row.kind==="earned").every(row=>row.membershipGrantId===grant._id));
 assert((await state.apply.handler(ctx,{id})).already);
 assert.equal(tables.get("credits").filter(row=>row.reason===`swap_restored_credit:${id}`).length,3);
 console.log("PASS multi-line member settlement: grant, earned/refund credit, refund-first commit and idempotent restoration");
})().catch(error=>{console.error(error);process.exitCode=1});
