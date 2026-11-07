const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { quoteSwapFunding, adjustedSwapCreditBalances } = load("convex/lib/rentalSwapFunding.ts");
const account=put("accounts",{email:"member-multiline@example.invalid"});
const grant=put("membership_credit_grants",{accountId:account._id,invoiceId:"invoice-fixture",initialCreditAppliedPence:2000,revokedPence:0});
const refund=put("credits",{accountId:account._id,kind:"refund",currency:"GBP",amount:10,remaining:0});
const earned=put("credits",{accountId:account._id,kind:"earned",currency:"GBP",amount:15,remaining:0,membershipGrantId:grant._id,membershipInvoiceId:grant.invoiceId});
const first={listingId:"first",start:100,end:200,qty:1,lineTotal:10},second={...first,listingId:"second",lineTotal:90};
const booking={accountId:account._id,pricingVersion:"single-benefit-v1",benefitKind:"earned_credit",subtotal:100,discount:0,deliveryFee:0,creditApplied:45,membershipCreditApplied:20,refundCreditApplied:10,earnedCreditApplied:15,membershipCreditGrantId:grant._id,lineItems:[first,second],
 checkoutLineFunding:[{...first,gross:10,discount:0,membershipCredit:10,accountCredit:0,card:0},{...second,gross:90,discount:0,membershipCredit:10,accountCredit:25,card:55}],
 creditAllocations:[{creditId:refund._id,kind:"refund",amount:10},{creditId:earned._id,kind:"earned",amount:15}],
 checkoutLineCreditSources:[{lineIndex:1,creditId:refund._id,kind:"refund",amount:10},{lineIndex:1,creditId:earned._id,kind:"earned",amount:15}]};

(async()=>{
 const upgraded=await quoteSwapFunding({db},booking,0,{...first,listingId:"upgrade",lineTotal:25});
 assert.equal(upgraded.deltaPence,1500);
 assert.deepEqual(upgraded.nextAllFunding.map(row=>[row.membershipCredit,row.accountCredit,row.card]),[[20,5,0],[0,20,70]]);
 assert.deepEqual(upgraded.nextAllCreditSources.map(row=>[row.lineIndex,row.creditId,row.amount]),[[0,refund._id,5],[1,refund._id,5],[1,earned._id,15]]);
 const down=await quoteSwapFunding({db},booking,1,{...second,listingId:"downgrade",lineTotal:0});
 assert.equal(down.deltaPence,-5500);
 assert.deepEqual(down.restore.map(row=>[row.kind,row.amountPence]),[["refund",1000],["earned",1500],["membership",1000]]);
 assert.deepEqual(down.nextAllFunding.map(row=>[row.membershipCredit,row.accountCredit,row.card]),[[10,0,0],[0,0,0]]);
 const balances=adjustedSwapCreditBalances(booking,down.restore);
 assert.deepEqual([balances.creditApplied,balances.membershipCreditApplied,balances.refundCreditApplied,balances.earnedCreditApplied],[10,10,0,0]);
 const revised={...booking,...balances,subtotal:10,lineItems:[first,{...second,listingId:"downgrade",lineTotal:0}],checkoutLineFunding:down.nextAllFunding,checkoutLineCreditSources:down.nextAllCreditSources};
 const repeated=await quoteSwapFunding({db},revised,1,{...second,listingId:"next",lineTotal:20});
 assert.equal(repeated.deltaPence,2000,"Restored credit is not silently spent again");
 await assert.rejects(quoteSwapFunding({db},{...booking,membershipSignupOfferSaving:5,discount:5},1,{...second,listingId:"downgrade",lineTotal:0}),/cannot be safely repriced/);
 await assert.rejects(quoteSwapFunding({db},{...booking,membershipCreditGrantId:undefined},1,{...second,listingId:"downgrade",lineTotal:0}),/membership credit grant cannot be verified/);
 await assert.rejects(quoteSwapFunding({db},{...booking,checkoutLineCreditSources:[]},1,{...second,listingId:"downgrade",lineTotal:0}),/credit sources cannot be verified/);
 console.log("PASS multi-line membership swaps: original grant and mixed credit sources, reallocation, refunds, restoration and repeat");
})().catch(error=>{console.error(error);process.exitCode=1});
