const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {qualifyingRentalCount}=load('shared/loyalty.ts');
const accounts=load('convex/accounts.ts'),bookings=load('convex/bookings.ts'),reviews=load('convex/reviews.ts');
const {reviewContext}=load('convex/lib/reviewContext.ts'),{reviewSettlementFingerprint}=load('convex/lib/reviewEligibility.ts'),{loyaltyProgress,encoreGate}=load('convex/lib/loyalty.ts');
const {calculateRentalPrice}=load('convex/lib/rentalPrice.ts'),catalog=load('convex/catalog.ts');
const DAY=86400000,now=Date.now();
const row=(id,date,session='cs-'+id,status='returned')=>({_id:id,status,stripeCheckoutSessionId:session,lineItems:[{start:date,end:date+DAY},{start:date,end:date+DAY}]});
assert.equal(qualifyingRentalCount([row('a',DAY)]),1,'multiple items count as one');
assert.equal(qualifyingRentalCount([row('a',DAY,'cs'),row('b',DAY*4,'cs'),row('c',DAY*7,'cs')]),1,'one checkout counts once even with different dates');
assert.equal(qualifyingRentalCount([row('a',DAY),row('b',DAY),row('c',DAY)]),1,'same rental dates do not count as separate rentals');
assert.equal(qualifyingRentalCount([row('a',DAY),row('b',DAY*4),row('c',DAY*7)]),3);
assert.equal(qualifyingRentalCount([row('a',DAY),row('b',DAY*4,undefined,'cancelled'),row('c',DAY*7,undefined,'pending_payment')]),1);
assert.equal(qualifyingRentalCount([{...row('a',DAY),cancellationDecision:{kind:'store_credit'}}]),0);
assert.equal(qualifyingRentalCount([{...row('a',DAY),stripeCheckoutSessionId:undefined}]),0,'no payment provenance');
// Ambiguous duplicate history is independent of row order.
assert.equal(qualifyingRentalCount([row('a',DAY,'cs-a'),row('a2',DAY*4,'cs-a'),row('b',DAY,'cs-b'),row('c',DAY*7,'cs-c')]),3);
(async()=>{
 const account=put('accounts',{email:'encore@example.invalid',loyaltyLevel:3,loyaltyUnlockedAt:now,loyaltyCelebratedAt:now,loyaltyCelebratedLevel:3}),foreign=put('accounts',{email:'other@example.invalid'});
 put('sessions',{accountId:account._id,token:'owned',expiresAt:now+DAY});put('sessions',{accountId:foreign._id,token:'other',expiresAt:now+DAY});put('sessions',{accountId:account._id,token:'expired',expiresAt:now-1});
 const ctx={db,scheduler:{runAfter:async()=>{}},storage:{getUrl:async()=>null}};
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'owned'}),/clean rental.*review/);
 const history=[];
 for(const [i,date] of [DAY,DAY*4,DAY*7].entries()){
  const b=put('bookings',{...row('x'+i,date),accountId:account._id,guestEmail:account.email,status:i===2?'active':'returned',depositAmount:0,total:0,actualReturnedAt:now,
   returnDecision:{inspection:[{key:'first',title:'Camera',condition:'good',details:'',openCase:false},{key:'second',title:'Lens',condition:'good',details:'',openCase:false}]}});
  history.push(b);
 }
 assert.equal((await accounts.me.handler(ctx,{token:'owned'})).loyaltyLevel,0,'Legacy cached level is not proof of a reviewed rental');
 const third=history[2];await bookings.markReturnedStatus.handler(ctx,{bookingId:third._id});
 assert.equal((await accounts.me.handler(ctx,{token:'owned'})).loyaltyLevel,0,'The actual return cannot unlock Encore without a review');
 // Every star rating counts equally, including a one-star critical review.
 for(const [index,b] of history.entries()){
  b.reviewEligibilityFingerprint=reviewSettlementFingerprint(await reviewContext(ctx,b));
  await reviews.submitNative.handler(ctx,{token:'owned',bookingId:b._id,rating:index===0?1:5,text:'An honest review of my rental experience.'});
  const earned=await accounts.me.handler(ctx,{token:'owned'});assert.equal(earned.loyaltyLevel,index+1);assert.equal(earned.loyaltyPercent,[2,4,10][index]);assert.equal(earned.loyaltyCelebrated,false,'Newly reviewed reward shows a fresh celebration');
  assert.equal(account.loyaltyPolicyVersion,'review-earned-v1');
 }
 assert(account.loyaltyUnlockedAt,'Third actual review persists the verified entitlement');
 const rewardReview=(await db.query('reviews').collect())[0];assert.equal(rewardReview.incentivized,true);assert.equal(rewardReview.encoreReward,true,'Benefit disclosure is stored with review');
 await db.patch(rewardReview._id,{published:false});assert.equal((await loyaltyProgress(ctx,account)).level,3,'Moderating a critical review cannot remove its reward');
 await db.patch(history[0]._id,{returnDecision:{inspection:[{key:'first',condition:'issue',details:'Damage was recorded',openCase:false}]}});assert.equal((await loyaltyProgress(ctx,account)).level,2,'A documented return issue cannot count even with no money retained');
 await db.patch(history[0]._id,{returnDecision:{inspection:[{key:'first',condition:'good',details:'',openCase:false}]}});assert.equal((await loyaltyProgress(ctx,account)).level,3);
 const oldEmail=account.email;await db.patch(account._id,{email:'updated-encore@example.invalid'});put('accounts',{email:oldEmail});assert.equal((await loyaltyProgress(ctx,account)).level,3,'Linked reviews survive email changes without passing to a recycled mailbox');
 const impostor=put('bookings',{...row('foreign-same-email',DAY*12),accountId:foreign._id,guestEmail:account.email,status:'returned',actualReturnedAt:now,returnDecision:history[0].returnDecision});put('reviews',{verifiedBookingId:impostor._id,source:'native',authorAccountId:account._id});
 assert.equal((await loyaltyProgress(ctx,account)).level,3,'Linked foreign same-email rows never become owned history');
 for(const patch of [{returnDecision:undefined,returnStatement:undefined},{returnDecision:{inspection:[{condition:'issue'}]}},{lateFeeAmount:10,lateFeeStatus:'waived'},{depositHoldCapturedForDamage:1},{depositRefunded:false,depositAmount:1}])assert(encoreGate({...history[0],...patch}),'Unknown inspection, damage, late charge or pending security cannot earn a reward');
 const me=await accounts.me.handler(ctx,{token:'owned'});assert(me.loyaltyEligible);assert.equal(me.loyaltyCompleted,3);assert(!me.loyaltyCelebrated);
 assert.equal((await accounts._byToken.handler(ctx,{token:'owned'})).loyaltyEligible,true,'pricing uses authenticated history');
 assert.equal((await accounts._byToken.handler(ctx,{token:'other'})).loyaltyEligible,false);
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'expired'}),/Sign in/);
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'other'}),/clean rental.*review/);
 await accounts.acknowledgeLoyalty.handler(ctx,{token:'owned'});const first=account.loyaltyCelebratedAt;await accounts.acknowledgeLoyalty.handler(ctx,{token:'owned'});assert.equal(account.loyaltyCelebratedAt,first,'one saved celebration across devices');
 assert.equal((await accounts.me.handler(ctx,{token:'owned'})).loyaltyCelebrated,true);
 const camera=put('listings',{active:true,title:'Camera',pricing:{daily:300},depositAmount:2000,components:[]});
 const pricingCtx={...ctx,runQuery:async(ref,args)=>{
  if(ref==='accounts._byEmail')return load('convex/accounts.ts')._byEmail.handler({db},args);
 if(ref==='accounts._byToken')return accounts._byToken.handler(ctx,args);
  if(ref==='catalog.repriceLines')return catalog.repriceLines.handler(ctx,args);
  if(ref==='bookings.availableCheckoutCredit')return 0;
  throw Error('unexpected '+ref);
 }};
 const input={items:[{listingId:camera._id,title:'forged',start:Date.UTC(2027,0,4),end:Date.UTC(2027,0,4),qty:1,total:1,deposit:1}],token:'owned',customer:{email:account.email},fulfilment:'pickup'};
 let quote=await calculateRentalPrice(pricingCtx,input);assert.equal(quote.loyaltySaving,30);assert.equal(quote.totalReduction,30);assert(quote.depositAmount>0);assert.equal(quote.deliveryReduction,0);
 const pendingArgs={customerEmail:account.email,fulfilment:'pickup',deliveryFee:quote.deliveryFee,lineItems:quote.items.map(i=>({listingId:i.listingId,title:i.title,start:i.start,end:i.end,qty:1,lineTotal:i.total})),subtotal:quote.subtotal,depositAmount:quote.depositAmount,discount:quote.totalReduction,total:quote.totalBeforeCredit,expectedTotalDue:quote.totalDue,creditAccountId:account._id,loyaltySaving:quote.loyaltySaving,currency:'GBP'};
 const pending=await bookings.createPending.handler(pricingCtx,pendingArgs);assert.equal((await db.get(pending.bookingId)).discount,30);
 await assert.rejects(bookings.createPending.handler(pricingCtx,{...pendingArgs,loyaltySaving:31}),/saving changed/);
 quote=await calculateRentalPrice(pricingCtx,{...input,selectedMembership:{tier:'pro',intro:'none'}});assert.equal(quote.loyaltySaving,0,'checkout-added subscription cannot stack');assert.equal(quote.membershipSignupOfferSaving,10);assert(quote.depositAmount>0);
 account.membershipActive=true;account.membershipTier='pro';account.membershipStatus='active';account.membershipPaidThrough=now+DAY;
 await assert.rejects(bookings.createPending.handler(pricingCtx,pendingArgs),/Encore benefit changed/);
 quote=await calculateRentalPrice(pricingCtx,input);assert.equal(quote.loyaltySaving,0,'existing subscription cannot stack');assert.equal(quote.depositAmount,0);
 account.membershipPerksPendingBookingId=third._id;quote=await calculateRentalPrice(pricingCtx,input);assert(quote.depositAmount>0,'pending first booking cannot unlock security waiver');
 console.log('PASS review-earned Encore: no return-only or cached grants; three clean/provider-attested owned reviews; negative/unpublished ratings equal; permanent accounts and no reused-mail grants; issue/late/security gates; real pricing/checkout guard, nonstack and persisted celebration.');
})().catch(e=>{console.error(e);process.exitCode=1});
