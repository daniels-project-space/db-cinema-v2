const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const {threeMonthsAfter,bestBenefit}=load('shared/rentalBenefits.ts');
const referral=load('convex/referrals.ts'),ledger=load('convex/lib/referrals.ts');
const bookings=load('convex/bookings.ts'),catalog=load('convex/catalog.ts'),accounts=load('convex/accounts.ts');
const {calculateRentalPrice}=load('convex/lib/rentalPrice.ts');
const now=Date.now(),DAY=86400000;
const jobs=[];const ctx={db,storage:{getUrl:async()=>null},scheduler:{runAfter:async(_delay,ref,args)=>jobs.push({ref,args})}};
assert.equal(new Date(threeMonthsAfter(Date.UTC(2026,10,30,12))).toISOString(),'2027-02-28T12:00:00.000Z');
assert.equal(new Date(threeMonthsAfter(Date.UTC(2027,0,31))).toISOString(),'2027-04-30T00:00:00.000Z');
assert.equal(bestBenefit([{kind:'promo',savingPence:1000,label:'coupon'},{kind:'earned_credit',savingPence:900,label:'credit'}]).kind,'promo');
async function account(email,token){const a=put('accounts',{email,emailVerifiedAt:now});put('sessions',{accountId:a._id,token,expiresAt:now+DAY});await referral.ensureMine.handler(ctx,{token});return a;}
const start=Date.UTC(2027,0,4),camera=put('listings',{title:'Camera',active:true,pricing:{daily:100},depositAmount:2000,components:[]});
const input=a=>({items:[{listingId:camera._id,title:'wrong',start,end:start,qty:1,total:1,deposit:1}],token:a.email,customer:{email:a.email},fulfilment:'pickup'});
const pricing={...ctx,runQuery:async(ref,args)=>{
 if(ref==='accounts._byEmail')return load('convex/accounts.ts')._byEmail.handler({db},args);
 if(ref==='accounts._byToken')return accounts._byToken.handler(ctx,args);
 if(ref==='catalog.repriceLines')return catalog.repriceLines.handler(ctx,args);
 if(ref==='bookings.availableCheckoutCredit')return bookings.availableCheckoutCredit.handler(ctx,args);
 if(ref==='referrals.offers')return referral.offers.handler(ctx,args);
 if(ref==='promo.validate')return {valid:true,code:'SALE',discount:30};
 throw Error('unexpected query '+ref);
}};
const pendingArgs=(p,a)=>({securityPolicyVersion:p.securityPolicyVersion,protection:p.protection,pricingVersion:p.pricingVersion,benefitKind:p.benefitKind,refundCreditApplied:p.refundCreditApplied,earnedCreditApplied:p.earnedCreditApplied,referralCode:p.referralCode,referralRewardId:p.referralRewardId,customerEmail:a.email,creditAccountId:a._id,fulfilment:'pickup',deliveryFee:0,quotedDeliveryFee:0,lineItems:p.items.map(i=>({listingId:i.listingId,title:i.title,start:i.start,end:i.end,qty:1,lineTotal:i.total})),subtotal:p.subtotal,total:p.totalBeforeCredit,expectedTotalDue:p.totalDue,depositAmount:p.depositAmount,depositHoldAmount:p.depositHoldAmount,discount:p.totalReduction,membershipCreditApplied:p.membershipCreditApplied,loyaltySaving:p.loyaltySaving,currency:'GBP'});
(async()=>{
 const owner=await account('owner@example.invalid','owner@example.invalid'),friend=await account('friend@example.invalid','friend@example.invalid');
 assert.match(owner.referralCode,/^DBC-[A-Z0-9]{14}$/);assert.notEqual(friend.referralCode,owner.referralCode);
 assert.equal(await referral.ensureMine.handler(ctx,{token:owner.email}),owner.referralCode,'code stable across devices');
 await assert.rejects(referral.ensureMine.handler(ctx,{token:'bad'}),/Sign in/);
 assert.equal((await ledger.referralEligibility(ctx,owner,owner.referralCode)).valid,false);
 const freeHistory=await account('prior-free@example.invalid','prior-free@example.invalid');put('bookings',{guestEmail:freeHistory.email,status:'cancelled',accountCreatedAtCheckout:true});assert.equal((await ledger.referralEligibility(ctx,freeHistory,owner.referralCode)).valid,false,'a previously settled free/setup rental still counts as the first rental');
 await assert.rejects(calculateRentalPrice(pricing,{...input(friend),token:undefined,promoCode:owner.referralCode}),/Sign in/);
 camera.depositAmount=150;
 const small=await calculateRentalPrice(pricing,{...input(friend),promoCode:owner.referralCode});
 assert.equal(small.depositAmount,100);assert.equal(small.depositHoldAmount,15);
 const smallArgs=pendingArgs(small,friend);
 await assert.rejects(bookings.createPending.handler(ctx,{...smallArgs,depositAmount:0}),/normal upfront security/);
 const smallBooking=await bookings.createPending.handler(ctx,smallArgs);
 await bookings.expireUnpaidPending.handler(ctx,{bookingId:smallBooking.bookingId});
 camera.depositAmount=2000;
 let p=await calculateRentalPrice(pricing,{...input(friend),promoCode:owner.referralCode});assert.equal(p.benefitKind,'referral_friend');assert.equal(p.totalReduction,10);assert(p.depositAmount>0);
 const args=pendingArgs(p,friend),created=await bookings.createPending.handler(ctx,args),b=await db.get(created.bookingId);
 await assert.rejects(bookings.createPending.handler(ctx,args),/first rental|claimed/,'a second serializable reservation is rejected');
 assert.equal(await referral.qualify.handler(ctx,{bookingId:b._id}),null,'unpaid cannot earn');
 await bookings.expireUnpaidPending.handler(ctx,{bookingId:b._id});assert.equal((await ledger.referralEligibility(ctx,friend,owner.referralCode)).valid,true,'terminal unpaid claim can retry');
 const second=await bookings.createPending.handler(ctx,args),paid=await db.get(second.bookingId);await bookings.confirm.handler(ctx,{bookingId:paid._id,paymentIntentId:'pi_friend'});
 const redemption=await db.get(paid.referralRedemptionId);assert.equal(redemption.state,'paid');assert(friend.referralFirstUsedAt);
 await bookings.confirm.handler(ctx,{bookingId:paid._id,paymentIntentId:'pi_friend'});assert.equal((await db.query('referral_redemptions').collect()).filter(r=>r.state==='paid').length,1);
 assert.equal(await referral.qualify.handler(ctx,{bookingId:paid._id}),null,'payment alone is not a completed return');
 await referral.recordPayment.handler(ctx,{bookingId:paid._id,paymentHash:'friend-card'});
 await db.patch(paid._id,{status:'returned',pickedUpAt:now,idVerifyStatus:'verified',returnStatement:{number:'fixture'}});
 const issued=await referral.qualify.handler(ctx,{bookingId:paid._id});assert(issued.rewardId);assert.equal(await referral.qualify.handler(ctx,{bookingId:paid._id}),null);
 const reward=await db.get(issued.rewardId);assert.equal(reward.expiresAt,threeMonthsAfter(reward.createdAt));
 const another=put('referral_redemptions',{referrerAccountId:owner._id,friendAccountId:friend._id,state:'paid'});assert.equal(await ledger.issueReferralReward(ctx,another),reward._id,'lifetime limit per referrer');
 owner.membershipActive=true;owner.membershipTier='pro';owner.membershipStatus='active';owner.membershipPaidThrough=now+DAY;
 p=await calculateRentalPrice(pricing,input(owner));assert.equal(p.benefitKind,'referral_reward');assert.equal(p.totalReduction,40);assert(p.depositAmount>0);assert.equal(p.securityWaiverReason,undefined);
 const rewardArgs=pendingArgs(p,owner),claim=await bookings.createPending.handler(ctx,rewardArgs);
 await assert.rejects(bookings.createPending.handler(ctx,rewardArgs),/no longer available/);
 await bookings.expireUnpaidPending.handler(ctx,{bookingId:claim.bookingId});assert(await ledger.availableReferralReward(ctx,owner));
 const use=await bookings.createPending.handler(ctx,rewardArgs);await bookings.confirm.handler(ctx,{bookingId:use.bookingId,paymentIntentId:'pi_owner'});assert.equal(reward.state,'used');assert(owner.referralRewardUsedAt);
 await bookings._finalizeCancellation.handler(ctx,{bookingId:use.bookingId,accountId:owner._id,mode:'refund',refundAmount:100,creditAmount:0,currency:'GBP'});assert.equal(await ledger.availableReferralReward(ctx,owner),null,'paid cancellation does not reissue');
 reward.state='expired';assert.equal(await ledger.issueReferralReward(ctx,another),reward._id,'expiry cannot reset lifetime limit');
 const expiring=await account('expired-reward@example.invalid','expired-reward@example.invalid'),open=put('bookings',{guestEmail:expiring.email,status:'pending_payment'}),expiringReward=put('referral_rewards',{accountId:expiring._id,redemptionId:another._id,percent:40,state:'available',createdAt:now-1000,expiresAt:now-10,reservedBookingId:open._id});
 assert.equal(await ledger.availableReferralReward(ctx,expiring),null,'expiry is checked immediately, without waiting for cron');await referral.expire.handler(ctx,{});assert.equal(expiringReward.state,'available','a valid pending reservation may settle before its payment window closes');await db.patch(open._id,{status:'cancelled'});await referral.expire.handler(ctx,{});assert.equal(expiringReward.state,'expired','terminal reservation allows automatic expiry');

 // Earned credit is one alternative; customer refund money can still pay the balance.
 const mixed=await account('mixed@example.invalid','mixed@example.invalid');mixed.loyaltyLevel=3;
 put('credits',{accountId:mixed._id,kind:'earned',remaining:20,amount:20,status:'active',createdAt:now-1000,expiresAt:now+DAY});
 put('credits',{accountId:mixed._id,kind:'refund',remaining:15,amount:15,status:'active',createdAt:now-1000,expiresAt:now+DAY});
 p=await calculateRentalPrice(pricing,{...input(mixed),promoCode:'SALE'});assert.equal(p.benefitKind,'promo');assert.equal(p.loyaltySaving,0);assert.equal(p.earnedCreditApplied,0);assert.equal(p.refundCreditApplied,15);assert.equal(p.totalDue,55+p.depositAmount);
 const reserve=await bookings.createPending.handler(ctx,pendingArgs(p,mixed));await assert.rejects(bookings.createPending.handler(ctx,pendingArgs(p,mixed)),/available credit changed/);await bookings.confirm.handler(ctx,{bookingId:reserve.bookingId,paymentIntentId:'pi_mixed'});
 assert.equal((await db.query('credits').collect()).find(c=>c.accountId===mixed._id&&c.kind==='earned').remaining,20);
 await bookings._finalizeCancellation.handler(ctx,{bookingId:reserve.bookingId,accountId:mixed._id,mode:'credit',refundAmount:0,creditAmount:70,currency:'GBP'});
 const restored=(await db.query('credits').collect()).filter(c=>c.accountId===mixed._id&&c.bookingId===reserve.bookingId);assert.equal(restored.reduce((n,c)=>n+c.remaining,0),70);assert(restored.every(c=>c.kind==='refund'),'cash and refund origin remain customer money');
 // A later account earns progressive levels and cannot acknowledge an unearned one.
 const progressive=await account('levels@example.invalid','levels@example.invalid');
 for(let level=1;level<=3;level++){
  const b=put('bookings',{accountId:progressive._id,guestEmail:progressive.email,status:'returned',stripeCheckoutSessionId:'cs_level_'+level,depositAmount:0,total:0,actualReturnedAt:now,
   returnDecision:{inspection:[{key:'camera',title:'Camera',condition:'good',details:'',openCase:false}]},lineItems:[{start:start+level*DAY*5,end:start+level*DAY*5,qty:1,title:'Camera'}]});
  b.reviewEligibilityFingerprint=load('convex/lib/reviewEligibility.ts').reviewSettlementFingerprint(await load('convex/lib/reviewContext.ts').reviewContext(ctx,b));
  await load('convex/reviews.ts').submitNative.handler(ctx,{token:progressive.email,bookingId:b._id,rating:1,text:'An honest account of this rental.'});
  const me=await accounts.me.handler(ctx,{token:progressive.email});assert.equal(me.loyaltyLevel,level);assert.equal(me.loyaltyPercent,[0,2,4,10][level]);
  if(level<3)await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:progressive.email,level:level+1}),/clean rental.*review/);
  await accounts.acknowledgeLoyalty.handler(ctx,{token:progressive.email,level});assert.equal(progressive.loyaltyCelebratedLevel,level);
 }

 const self=await account('self@example.invalid','self@example.invalid');owner.paymentIdentityHashes=['same-card'];const selfBooking=put('bookings',{guestEmail:self.email,status:'returned',pickedUpAt:now,idVerifyStatus:'verified',returnStatement:{}}),selfClaim=put('referral_redemptions',{bookingId:selfBooking._id,friendAccountId:self._id,referrerAccountId:owner._id,state:'paid'});await referral.recordPayment.handler(ctx,{bookingId:selfBooking._id,paymentHash:'same-card'});assert.equal(selfClaim.state,'void');assert.equal(await referral.qualify.handler(ctx,{bookingId:selfBooking._id}),null);
 // Owner-gated campaign, opt-outs, leases and signed unsubscribe; never mail real people.
 process.env.ADMIN_TOKEN='owned-fixture';process.env.FILM_FUND_EMAIL_SECRET='owned-test-secret';
 const campaigns=load('convex/referralCampaigns.ts');friend.marketingEmails=true;
 await assert.rejects(campaigns.launch.handler(ctx,{token:'bad',confirmed:true}),/unauthorized/);await assert.rejects(campaigns.launch.handler(ctx,{token:'owned-fixture',confirmed:false}),/Review/);
 const campaign=await campaigns.launch.handler(ctx,{token:'owned-fixture',confirmed:true});assert.equal(await campaigns.launch.handler(ctx,{token:'owned-fixture',confirmed:true}),campaign);await campaigns.enqueue.handler(ctx,{id:campaign,cursor:null});
 const messages=await campaigns.due.handler(ctx,{});assert.equal(messages.length,1);const lease=await campaigns.claim.handler(ctx,{id:messages[0]});assert(lease);assert.equal(await campaigns.claim.handler(ctx,{id:messages[0]}),null);
 await campaigns.finish.handler(ctx,{id:lease.id,leaseUntil:lease.leaseUntil,sent:false});assert.equal((await db.get(lease.id)).state,'pending');
 setMock('./lib/mailer',{sendMail:async()=>true});const mail=load('convex/referralMail.ts'),token=mail.unsubscribeToken(friend.email);assert.equal(mail.unsubscribeEmail(token),friend.email);assert.throws(()=>mail.unsubscribeEmail(token.slice(0,-1)+'!'),/Invalid/);await campaigns.unsubscribe.handler(ctx,{email:friend.email});await db.patch(lease.id,{dueAt:now});assert.equal(await campaigns.claim.handler(ctx,{id:lease.id}),null,'latest consent is checked before sending');
 console.log('PASS referrals: stable account codes, first rental/auth/self checks, transactional reservations, paid-return qualification, one lifetime reward, calendar expiry, paid cancellation, normal security, credit-origin/nonstack, progressive Encore, gated email/lease/opt-out/signatures.');
})().catch(e=>{console.error(e);process.exitCode=1});
