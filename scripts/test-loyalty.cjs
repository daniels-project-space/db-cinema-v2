const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {qualifyingRentalCount}=load('shared/loyalty.ts');
const rentalBenefits=load('shared/rentalBenefits.ts');
assert.equal(rentalBenefits.memberRentalBenefitCandidates({account:null,subtotalPence:10000,weekendSavingPence:1000}).find(candidate=>candidate.kind==='loyalty').savingPence,0,'Guests without an account cannot receive Encore');
const accounts=load('convex/accounts.ts'),bookings=load('convex/bookings.ts'),reviews=load('convex/reviews.ts');
const {reviewContext}=load('convex/lib/reviewContext.ts'),{reviewSettlementFingerprint}=load('convex/lib/reviewEligibility.ts'),{loyaltyProgress,loyaltyProgressWithin,encoreGate}=load('convex/lib/loyalty.ts');
const {calculateRentalPrice}=load('convex/lib/rentalPrice.ts'),catalog=load('convex/catalog.ts');
const {dateLabel,londonRentalInstant}=load('shared/rentalWindow.ts');
const DAY=86400000,now=Date.now();
process.env.ADMIN_TOKEN='loyalty-review-test';
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
 const submitEncoreReview=async(booking,token='owned',rating=5)=>{
  booking.reviewEligibilityFingerprint=reviewSettlementFingerprint(await reviewContext(ctx,booking));
  await reviews.submitNative.handler(ctx,{token,bookingId:booking._id,rating,text:'An honest review of my clean rental.'});
 };
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'owned'}),/honest review after a clean, settled rental/);
 const adminAssigned=put('accounts',{email:'admin-assigned@example.invalid',adminEncoreLevel:3});put('sessions',{accountId:adminAssigned._id,token:'admin-assigned',expiresAt:now+DAY});
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'admin-assigned'}),/honest review after a clean, settled rental/,'A manual Encore assignment is not earned rental progress');
 const assignedOnly=await accounts.me.handler(ctx,{token:'admin-assigned'});
 assert.equal(assignedOnly.loyaltyLevel,3,'Manual access remains separate from earned progress');
 assert.equal(assignedOnly.loyaltyCompleted,0,'A manual assignment never fabricates completed rentals');
 assert.equal(assignedOnly.loyaltyCelebrated,true,'A manual assignment does not show an earned-tier celebration');
 const history=[];
 for(const [i] of [DAY,DAY*4,DAY*7].entries()){
  const end=dateLabel(now-(i+3)*DAY),actualReturnedAt=londonRentalInstant(end,'20:00');
  const lineItems=[{listingId:`camera-${i}`,title:'Camera',qty:1,start:end-DAY,end,returnTime:'20:00',lineTotal:50},
   {listingId:`lens-${i}`,title:'Lens',qty:1,start:end-DAY,end,returnTime:'20:00',lineTotal:50}];
  const inspection=[{key:'legacy:0:0',title:'Camera',condition:'good',details:'',openCase:false},
   {key:'legacy:1:0',title:'Lens',condition:'good',details:'',openCase:false}];
  const b=put('bookings',{...row('x'+i,end-DAY),lineItems,accountId:account._id,guestEmail:account.email,idVerifyStatus:'verified',status:i===0?'returned':'active',
   depositAmount:0,depositHoldAmount:0,total:100,subtotal:100,currency:'GBP',rentalPaidPence:10000,paidConfirmedAt:actualReturnedAt-DAY,
   checkoutPaidAt:actualReturnedAt-DAY,checkoutPaymentAmountPence:10000,checkoutExpectedAmountPence:10000,checkoutPaymentCurrency:'GBP',checkoutPaymentStatus:'paid',
   stripeCheckoutSessionId:`cs-loyalty-${i}`,stripePaymentIntentId:`pi-loyalty-${i}`,pickedUpAt:londonRentalInstant(end-DAY,'09:00'),actualReturnedAt,
   returnDecision:{actualReturnedAt,damageKept:0,depositKept:0,chargeLate:false,inspection},
   returnStatement:{actualReturnedAt,inspection,rentalRefunded:0,securityPaid:0,securityRefunded:0,holdStatus:'not_applicable',damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0}});
  history.push(b);
 }
 const legacyAccount=put('accounts',{email:'legacy-encore@example.invalid',loyaltyLevel:2,loyaltyPolicyVersion:'clean-completed-rental-earned-v5'});
 for(const [index,booking] of history.slice(0,2).entries()){
  const {_id:_legacySourceId,_creationTime:_legacySourceCreatedAt,...legacyTemplate}=booking;
  put('bookings',{...legacyTemplate,accountId:legacyAccount._id,guestEmail:legacyAccount.email,status:'returned',stripeCheckoutSessionId:`cs-legacy-encore-${index}`});
 }
 const legacyProgress=await loyaltyProgress(ctx,legacyAccount);
 assert.equal(legacyProgress.completed,0,'Existing v5 grants are not reclassified as newly reviewed progress');
 assert.equal(legacyProgress.level,2,'Previously earned Encore access is retained for legacy accounts during policy migration');
 assert.equal(legacyProgress.historicalLevel,2,'The retained legacy tier stays distinguishable from newly reviewed progress');
 let earned=await accounts.me.handler(ctx,{token:'owned'});
 assert.equal(earned.loyaltyLevel,0,'A stale cached tier without an eligible policy and review cannot grant Encore');
 assert.equal(earned.loyaltyEligible,false);
 assert.equal(earned.loyaltyCompleted,0,'A clean return without a renter review does not advance Encore');
 await submitEncoreReview(history[0], 'owned', 1);
 earned=await accounts.me.handler(ctx,{token:'owned'});
 assert.equal(earned.loyaltyLevel,1,'The first clean rental earns Encore I only after its review is submitted');
 assert.equal(earned.loyaltyPercent,2,'A one-star honest review earns the same 2% as every other rating');
 assert.equal(earned.loyaltyCompleted,1);
 await bookings.markReturnedStatus.handler(ctx,{bookingId:history[1]._id});
 earned=await accounts.me.handler(ctx,{token:'owned'});
 assert.equal(earned.loyaltyLevel,1,'A second clean return without a review does not advance Encore');
 assert.equal(earned.loyaltyCompleted,1);
 await submitEncoreReview(history[1], 'owned', 5);
 earned=await accounts.me.handler(ctx,{token:'owned'});
 assert.equal(earned.loyaltyLevel,2,'A second reviewed clean rental earns Encore II');
 assert.equal(earned.loyaltyPercent,4,'A five-star review earns the same per-rental milestone as one star');
 await bookings.markReturnedStatus.handler(ctx,{bookingId:history[2]._id});
 const third=history[2];earned=await accounts.me.handler(ctx,{token:'owned'});
 assert.equal(earned.loyaltyLevel,2,'A third clean return does not advance Encore before its review');
 assert.equal(earned.loyaltyCompleted,2);
 await submitEncoreReview(history[2], 'owned', 2);
 earned=await accounts.me.handler(ctx,{token:'owned'});
 assert.equal(earned.loyaltyLevel,3,'The third reviewed clean rental earns Encore III');
 assert.equal(earned.loyaltyPercent,10);
 assert.equal(earned.loyaltyCompleted,3);
 const savedStatement=history[0].returnStatement;
 await db.patch(history[0]._id,{returnStatement:{...savedStatement,rentalRefunded:1}});
 assert.equal((await loyaltyProgress(ctx,account)).completed,2,'A rental with a partial rental refund cannot supply an Encore qualifying return');
 await db.patch(history[0]._id,{depositAmount:50,depositRefunded:true,depositRefundAmount:25,
  returnStatement:{...savedStatement,securityPaid:50,securityRefunded:25}});
 assert.equal((await loyaltyProgress(ctx,account)).completed,2,'A partially refunded security deposit cannot supply an Encore qualifying return');
 await db.patch(history[0]._id,{depositAmount:0,depositRefunded:undefined,depositRefundAmount:undefined,returnStatement:savedStatement,
  depositHoldAmount:50,depositHoldStatus:'held'});
 assert.equal((await loyaltyProgress(ctx,account)).completed,2,'An unreleased card hold cannot supply an Encore qualifying return');
 await db.patch(history[0]._id,{depositHoldAmount:0,depositHoldStatus:undefined});
 assert.equal((await loyaltyProgress(ctx,account)).completed,3,'Fully settled valid receipts restore progress deterministically after settlement is repaired');
 const duplicateAccount=put('accounts',{email:'duplicate-rental@example.invalid'});
 const {_id:_templateId,_creationTime:_templateCreatedAt,...duplicateTemplate}=history[0];
 const duplicateBookings=[];
 for(let duplicateIndex=0;duplicateIndex<2;duplicateIndex++)duplicateBookings.push(put('bookings',{...duplicateTemplate,accountId:duplicateAccount._id,
  guestEmail:duplicateAccount.email,status:'returned'}));
 put('sessions',{accountId:duplicateAccount._id,token:'duplicate-owner',expiresAt:now+DAY});
 await submitEncoreReview(duplicateBookings[0],'duplicate-owner',5);
 assert.equal((await loyaltyProgress(ctx,duplicateAccount)).completed,1,'Replayed/duplicated booking rows with the same checkout and rental window count once');
 assert.equal((await loyaltyProgress(ctx,duplicateAccount)).completed,1,'Progress retries are stable and do not mint an additional rental');
 assert.equal(account.loyaltyPolicyVersion,'reviewed-clean-completed-rental-earned-v6','Reviewing a clean rental records the reviewed-rental policy');assert(Number.isFinite(account.loyaltyUnlockedAt),'The final reviewed tier unlock time is recorded');
 const manualReviewAccount=put('accounts',{email:'manual-review@example.invalid',adminEncoreLevel:3});put('sessions',{accountId:manualReviewAccount._id,token:'manual-review',expiresAt:now+DAY});
 const {_id:_returnedId,_creationTime:_returnedCreatedAt,...returnedTemplate}=history[0];
 const manualReviewBooking=put('bookings',{...returnedTemplate,accountId:manualReviewAccount._id,guestEmail:manualReviewAccount.email,status:'returned',stripeCheckoutSessionId:'cs-manual-reviewed-rental'});
 manualReviewBooking.reviewEligibilityFingerprint=reviewSettlementFingerprint(await reviewContext(ctx,manualReviewBooking));
 await reviews.submitNative.handler(ctx,{token:'manual-review',bookingId:manualReviewBooking._id,rating:5,text:'An honest review after a clean rental.'});
 const manualReview=await db.query('reviews').withIndex('by_booking',q=>q.eq('verifiedBookingId',manualReviewBooking._id)).first();
 assert.equal(manualReview.incentivized,true,'A clean reviewed rental earns the recorded Encore benefit');
 assert.equal(manualReview.encoreReward,true,'The disclosure names the Encore reward actually earned');
 assert.equal(manualReviewAccount.loyaltyLevel,1,'The stored loyalty level remains earned progress, separate from the manual tier');
 assert.equal((await db.query('reviews').collect()).length,5,'Each reviewed rental and one duplicate-checkout review has one native review');
 const submittedReviews=await db.query('reviews').collect();
 assert(submittedReviews.every(review=>review.moderationStatus==='pending'&&review.published===false),'New renter reviews stay unpublished pending moderation');
 assert.equal((await reviews.listNativePublished.handler(ctx,{limit:20})).length,0,'Pending reviews do not enter the public carousel');
 assert.equal((await reviews.stats.handler(ctx,{})).count,0,'Pending reviews do not affect the public rating aggregate');
 for(const review of submittedReviews)await reviews.moderateNative.handler(ctx,{token:'loyalty-review-test',reviewId:review._id,decision:'approve'});
 const rewardReview=(await db.query('reviews').collect())[0];assert.equal(rewardReview.incentivized,true);assert.equal(rewardReview.encoreReward,true,'Only reviews that actually advance earned Encore disclose the resulting benefit');
 const ordinaryStats=await reviews.stats.handler(ctx,{});assert.equal(ordinaryStats.count,5,'Approved reviews enter the real rating aggregate');assert.equal(ordinaryStats.average,3.6,'Every approved star rating, including one star, contributes equally');
 put('reviews',{source:'native',published:true,author:'Encore renter',rating:5,text:'This approved review recorded an Encore-only incentive.',date:now,incentivized:true,encoreReward:true,prizeEntry:false});
 const encoreStats=await reviews.stats.handler(ctx,{});assert.equal(encoreStats.count,6,'An approved Encore-only incentive remains part of the rating aggregate');assert.equal(encoreStats.average,3.83,'The aggregate includes its actual star value without weighting');
 await db.patch(rewardReview._id,{published:false});assert.equal((await loyaltyProgress(ctx,account)).level,3,'An approved review remains eligible when hidden from the public carousel');
 await db.patch(history[0]._id,{returnDecision:{...history[0].returnDecision,inspection:history[0].returnDecision.inspection.map((item,index)=>index===0?{...item,condition:'issue',details:'Damage was recorded'}:item)}});assert.equal((await loyaltyProgress(ctx,account)).level,2,'A documented return issue cannot count even with no money retained');
 await db.patch(history[0]._id,{returnDecision:{...history[0].returnDecision,inspection:history[0].returnDecision.inspection.map(item=>({...item,condition:'good',details:''}))}});assert.equal((await loyaltyProgress(ctx,account)).level,3);
 const oldEmail=account.email;await db.patch(account._id,{email:'updated-encore@example.invalid'});put('accounts',{email:oldEmail});assert.equal((await loyaltyProgress(ctx,account)).level,3,'Linked rental history survives email changes without passing to a recycled mailbox');
 const impostor=put('bookings',{...row('foreign-same-email',DAY*12),accountId:foreign._id,guestEmail:account.email,status:'returned',actualReturnedAt:now,returnDecision:history[0].returnDecision});put('reviews',{verifiedBookingId:impostor._id,source:'native',authorAccountId:account._id});
 assert.equal((await loyaltyProgress(ctx,account)).level,3,'Linked foreign same-email rows never become owned rental history');
 for(const patch of [{returnDecision:undefined,returnStatement:undefined},{returnDecision:{inspection:[{condition:'issue'}]}},{lateFeeAmount:10,lateFeeStatus:'waived'},{depositHoldCapturedForDamage:1},{depositRefunded:false,depositAmount:1}])assert(encoreGate({...history[0],...patch}),'Unknown inspection, damage, late charge or pending security cannot earn a reward');
 const me=await accounts.me.handler(ctx,{token:'owned'});assert(me.loyaltyEligible);assert.equal(me.loyaltyCompleted,3);assert(Number.isSafeInteger(me.membershipFirstCleanRentalCompletedAt)&&me.membershipFirstCleanRentalCompletedAt>0,'The authenticated account projection exposes the clean-rental marker required by shared member-pricing eligibility');assert(!me.loyaltyCelebrated);
 assert.equal((await accounts._byToken.handler(ctx,{token:'owned'})).loyaltyEligible,true,'pricing uses authenticated history');
 assert.equal((await accounts._byToken.handler(ctx,{token:'other'})).loyaltyEligible,false);
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'expired'}),/Sign in/);
 await assert.rejects(accounts.acknowledgeLoyalty.handler(ctx,{token:'other'}),/honest review after a clean, settled rental/);
 await accounts.acknowledgeLoyalty.handler(ctx,{token:'owned'});const first=account.loyaltyCelebratedAt;await accounts.acknowledgeLoyalty.handler(ctx,{token:'owned'});assert.equal(account.loyaltyCelebratedAt,first,'one saved celebration across devices');
 assert.equal((await accounts.me.handler(ctx,{token:'owned'})).loyaltyCelebrated,true);
 const camera=put('listings',{active:true,title:'Camera',pricing:{daily:300},depositAmount:2000,components:[]});
 const pricingCtx={...ctx,runQuery:async(ref,args)=>{
  if(ref==='accounts._byEmail')return load('convex/accounts.ts')._byEmail.handler({db},args);
 if(ref==='accounts._byToken')return accounts._byToken.handler(ctx,args);
  if(ref==='catalog.repriceLines')return catalog.repriceLines.handler(ctx,args);
  if(ref==='bookings.availableCheckoutCredit')return 0;
  if(ref==='bookings.depositWaiverEligibility')return undefined;
  throw Error('unexpected '+ref);
 }};
 const input={items:[{listingId:camera._id,title:'forged',start:Date.UTC(2027,0,4),end:Date.UTC(2027,0,4),qty:1,total:1,deposit:1}],token:'owned',customer:{email:account.email},fulfilment:'pickup'};
 account.loyaltyLevel=0;account.loyaltyPercent=0;account.loyaltyEligible=false;
 const sourceTruthQuote=await calculateRentalPrice(pricingCtx,input);
 assert.equal(sourceTruthQuote.loyaltySaving,30,'Checkout recalculates Encore from owned clean rental history without trusting stale cached account fields');
 assert.match(sourceTruthQuote.reductionLabel,/Encore · 10%/,'Checkout labels the earned percentage discount clearly');
 const promoted=put('accounts',{email:'promoted-first-rental@example.invalid',adminEncoreLevel:3});put('sessions',{accountId:promoted._id,token:'promoted-first-rental',expiresAt:now+DAY});
 const promotedProgress=await loyaltyProgress(ctx,promoted);assert.equal(promotedProgress.completed,0);assert.equal(promotedProgress.level,3);assert.equal(promotedProgress.percent,10);
 process.env.ASSESSMENT_SECURITY_POLICY_ENABLED='true';
 const promotedQuote=await calculateRentalPrice(pricingCtx,{...input,token:'promoted-first-rental',customer:{email:promoted.email}});
 process.env.ASSESSMENT_SECURITY_POLICY_ENABLED='false';process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED='false';
 assert.equal(promotedQuote.loyaltySaving,30,'An admin-assigned Encore tier applies immediately to a first rental');
 assert.match(promotedQuote.reductionLabel,/Encore · 10%/,'The first-rental quote labels its assigned Encore saving');
 assert(promotedQuote.depositAmount>0,'An Encore III override cannot waive security on a first rental');
 assert.notEqual(promotedQuote.securityWaiverReason,'encore');
 const promotedReturning=put('accounts',{email:'promoted-returning@example.invalid',adminEncoreLevel:3,firstCleanRentalCompletedAt:now-DAY});put('sessions',{accountId:promotedReturning._id,token:'promoted-returning',expiresAt:now+DAY});
 const promotedReturningQuote=await calculateRentalPrice(pricingCtx,{...input,token:'promoted-returning',customer:{email:promotedReturning.email}});
 assert.equal(promotedReturningQuote.loyaltySaving,30,'An authenticated admin Encore promotion applies after the first eligible completed rental');
 for(const [level,percent] of [[1,2],[2,4],[3,10]]){
  await db.patch(promotedReturning._id,{adminEncoreLevel:level});
  const levelQuote=await calculateRentalPrice(pricingCtx,{...input,token:'promoted-returning',customer:{email:promotedReturning.email}});
  assert.equal(levelQuote.reductionLabel,`Encore · ${percent}% rental saving`,`An admin-assigned Encore ${level} checkout quote shows the correct renter-facing saving label`);
 }
 let quote=await calculateRentalPrice(pricingCtx,input);assert.equal(quote.loyaltySaving,30);assert.equal(quote.totalReduction,30);assert.equal(quote.depositAmount,0);assert.equal(quote.securityWaiverReason,undefined);assert.equal(quote.deliveryReduction,0);
 const pendingArgs={customerEmail:account.email,fulfilment:'pickup',deliveryFee:quote.deliveryFee,lineItems:quote.items.map(i=>({listingId:i.listingId,title:i.title,start:i.start,end:i.end,qty:1,lineTotal:i.total})),subtotal:quote.subtotal,depositAmount:quote.depositAmount,discount:quote.totalReduction,total:quote.totalBeforeCredit,expectedTotalDue:quote.totalDue,creditAccountId:account._id,loyaltySaving:quote.loyaltySaving,currency:'GBP'};
 const promotedPendingArgs={...pendingArgs,customerEmail:promoted.email,customerName:'Admin-assigned Encore renter',billingAddress:'Fixture billing address London',accountId:promoted._id,creditAccountId:promoted._id,
  lineItems:promotedQuote.items.map(i=>({listingId:i.listingId,title:i.title,start:i.start,end:i.end,qty:1,lineTotal:i.total})),
  subtotal:promotedQuote.subtotal,depositAmount:promotedQuote.depositAmount,depositHoldAmount:promotedQuote.depositHoldAmount,
  discount:promotedQuote.totalReduction,total:promotedQuote.totalBeforeCredit,expectedTotalDue:promotedQuote.totalDue,
  loyaltySaving:promotedQuote.loyaltySaving,pricingVersion:promotedQuote.pricingVersion,benefitKind:promotedQuote.benefitKind,
  securityPolicyVersion:promotedQuote.securityPolicyVersion,savedCardLimit:promotedQuote.savedCardLimit,protection:promotedQuote.protection,
  agreementName:'Admin-assigned Encore renter',agreementRequestId:'manual-encore-checkout-0001',
  agreementDocs:load('src/lib/legal.ts').agreementsForSecurityPolicy(promotedQuote.securityPolicyVersion).map(({kind,version})=>({kind,version})),
  securityHoldConsent:true,laterChargeConsent:true,pickupTime:'10:00',returnTime:'18:00'};
 process.env.ASSESSMENT_SECURITY_POLICY_ENABLED='true';
 const promotedPending=await bookings.createPending.handler(pricingCtx,promotedPendingArgs);
 const promotedBooking=await db.get(promotedPending.bookingId);
 assert.equal(promotedBooking.discount,30,'the authoritative booking mutation accepts the server-calculated admin Encore benefit');
 assert(promotedBooking.depositAmount>0,'the manual discount does not waive the separate first-rental security amount');
 await assert.rejects(bookings.createPending.handler(pricingCtx,{...promotedPendingArgs,agreementRequestId:'manual-encore-forgery-0001',loyaltySaving:31,discount:31}),/Encore rental saving changed/,'the authoritative booking mutation rejects an inflated manual-tier discount');
 process.env.ASSESSMENT_SECURITY_POLICY_ENABLED='false';
 const pending=await bookings.createPending.handler(pricingCtx,pendingArgs);assert.equal((await db.get(pending.bookingId)).discount,30);
 assert.deepEqual((await db.get(pending.bookingId)).checkoutLineFunding.map(({gross,discount,membershipCredit,accountCredit,card})=>({gross,discount,membershipCredit,accountCredit,card})),[{gross:300,discount:30,membershipCredit:0,accountCredit:0,card:270}]);
 await assert.rejects(bookings.createPending.handler(pricingCtx,{...pendingArgs,loyaltySaving:31}),/saving changed/);
 quote=await calculateRentalPrice(pricingCtx,{...input,selectedMembership:{tier:'pro',intro:'trial'}});assert.equal(quote.loyaltySaving,30,'earned Encore remains available with a trial selected at checkout');assert.equal(quote.membershipCreditApplied,0,'a first-rental trial grants no membership credit');assert.equal(quote.membershipSignupOfferSaving,0);assert.equal(quote.depositAmount,0);
 account.membershipActive=true;account.membershipTier='pro';account.membershipStatus='active';account.membershipPaidThrough=now+DAY;
 quote=await calculateRentalPrice(pricingCtx,input);assert.equal(quote.loyaltySaving,30,'earned Encore remains a candidate alongside an active paid subscription');assert.equal(quote.depositAmount,0);
 account.membershipPerksPendingBookingId=third._id;quote=await calculateRentalPrice(pricingCtx,input);assert.equal(quote.depositAmount,0,'No new-policy cash security even while member perks are pending');
 await db.patch(account._id,{adminEncoreLevel:1});const overriddenEarned=await loyaltyProgress(ctx,account);assert.equal(overriddenEarned.completed,3);assert.equal(overriddenEarned.level,1,'Explicit admin Encore tier overrides earned display tier');
 await db.patch(account._id,{adminEncoreLevel:undefined});assert.equal((await loyaltyProgress(ctx,account)).level,3,'Automatic restores earned Encore tier');
 const large=put('accounts',{email:'large-history@example.invalid',firstCleanRentalCompletedAt:now-DAY});
 const cleanTemplate={...history[0]};delete cleanTemplate._id;delete cleanTemplate._creationTime;
 for(let index=0;index<150;index++)put('bookings',{...cleanTemplate,accountId:large._id,guestEmail:large.email,status:'returned'});
 const readCounts={bookings:0,reviews:0};
 const boundedDb={...db,query(table){const query=db.query(table),take=query.take.bind(query),first=query.first.bind(query);query.take=async count=>{const rows=await take(count);if(table in readCounts)readCounts[table]+=rows.length;return rows;};query.first=async()=>{const row=await first();if(row&&table in readCounts)readCounts[table]++;return row;};return query;}};
 const boundedCtx={db:boundedDb};
 assert.equal(await loyaltyProgressWithin(boundedCtx,large,100),null,'A truncated completed-rental history stays unknown instead of returning a false earned level');
 const longHistory=await accounts._byToken.handler(boundedCtx,{token:'large-history'}).catch(()=>null);
 assert.equal(longHistory,null,'A checkout token requires an authenticated session');
 put('sessions',{accountId:large._id,token:'large-history',expiresAt:now+DAY});
 const longHistoryBenefit=await accounts._byToken.handler(boundedCtx,{token:'large-history'});
 assert.equal(longHistoryBenefit.loyaltyEligible,false,'Unknown long history fails closed without an earned discount');
 assert.equal(longHistoryBenefit.loyaltyPercent,0);
 assert.equal(longHistoryBenefit.loyaltyCompleted,null);
 assert(readCounts.bookings<=808,`Checkout loyalty lookup caps returned booking rows across each bounded history check (${readCounts.bookings})`);
 assert(readCounts.reviews<=400,`Review eligibility checks stay bounded by the same history ceiling (${readCounts.reviews})`);
 const assignedLong=put('accounts',{email:'assigned-long-history@example.invalid',adminEncoreLevel:2,firstCleanRentalCompletedAt:now-DAY});
 for(let index=0;index<150;index++)put('bookings',{...cleanTemplate,accountId:assignedLong._id,guestEmail:assignedLong.email,status:'returned'});
 const assignedUnknown=await loyaltyProgress(boundedCtx,assignedLong);
 assert.equal(assignedUnknown.completed,null,'Long history does not invent earned progress for a manually promoted account');
 assert.equal(assignedUnknown.level,2,'A deliberate manual tier remains available independently of earned history');
 assert.equal(assignedUnknown.percent,4);
 put('sessions',{accountId:assignedLong._id,token:'assigned-long-history',expiresAt:now+DAY});
 await assert.rejects(accounts.acknowledgeLoyalty.handler(boundedCtx,{token:'assigned-long-history'}),/history needs a check/,
  'Unknown bounded history cannot be acknowledged as an earned tier');
 assert(readCounts.reviews<=400,`Manual assignments do not expand the bounded review lookup (${readCounts.reviews})`);
 console.log('PASS review-earned Encore: clean settled paid rentals earn 2/4/10% only after reviews; only reviews that advance a tier disclose the Encore incentive; ownership, settlement, admin, checkout, and bounded-history guards remain enforced.');
})().catch(e=>{console.error(e);process.exitCode=1});
