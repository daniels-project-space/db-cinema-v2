const captured=[];
const {createHash}=require('node:crypto');const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const {seedVerificationFiles}=require('./lib/verificationFiles.cjs');
const sessions=new Map(),trace=[];let creates=0,retrieves=0,sourceOk=true,sessionStatus='open',sessionMismatch=false,transportError=false;
class StripeFixture {
 static errors={StripeInvalidRequestError:class extends Error{}};
 paymentMethodConfigurations={retrieve:async()=>({active:true,card:{display_preference:{value:'on'}},apple_pay:{display_preference:{value:'off'}},google_pay:{display_preference:{value:'off'}},link:{display_preference:{value:'off'}}})};
 checkout={sessions:{create:async params=>{creates++;captured.push(params);const s={id:'cs-fixture-'+creates,status:'open',url:'https://fixture.invalid/payment/'+creates,metadata:params.metadata};sessions.set(s.id,s);return s},retrieve:async id=>{retrieves++;if(transportError)throw Error('Unknown provider outcome');const s=sessions.get(id);return {...s,status:sessionStatus,...(sessionMismatch?{metadata:{bookingId:'wrong-booking'}}:{})}}}};
}
h.setMock('stripe',{default:StripeFixture});
h.setMock('../shared/legalDocuments',{RENTAL_DRAFT_RELEASE_READY:true});
const checkout=h.load('convex/checkout.ts'),bookings=h.load('convex/bookings.ts'),catalog=h.load('convex/catalog.ts'),availability=h.load('convex/availability.ts'),sync=h.load('convex/sync.ts'),memberBenefits=h.load('convex/membershipBenefits.ts'),{agreementRequestFingerprint}=h.load('shared/rentalAgreement.ts'),{AGREEMENTS}=h.load('src/lib/legal.ts');
Object.assign(process.env,{RMV2_WEBHOOK_URL:'https://fixture-manager.convex.site/dbcinema/booking-sync',RMV2_WEBHOOK_SECRET:'fixture-private-read',RENTAL_CHECKOUT_ENABLED:'true',DIDIT_API_KEY:'test',DIDIT_WORKFLOW_ID:'test',DIDIT_WEBHOOK_SECRET:'test',DIDIT_APPLICATION_ID:'test',DIDIT_ENVIRONMENT:'sandbox',STRIPE_WEBHOOK_SECRET:'test',STRIPE_SECRET_KEY:'test',STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID:'test',INVOICE_SECRET:'test',APP_URL:'https://fixture.invalid',BUSINESS_LEGAL_NAME:'Fixture supplier',BUSINESS_INVOICE_ADDRESS:'Fixture address',RESEND_API_KEY:'test',RESEND_FROM:'DB Cinema Rentals <bookings@dbcinemarentals.com>'});
const unit=h.put('inventory_units',{name:'Source camera',sku:'mi-body',rmv2ItemId:'body',quantityOwned:1,active:true,replacementCost:160}),listing=h.put('listings',{title:'Source camera',slug:'source-camera',category:'Cameras',itemType:'camera-body',active:true,stockMappingStatus:'complete',components:[{inventoryUnitId:unit._id,qty:1}],pricing:{daily:50},depositAmount:160});
assert.equal(h.load('shared/rentalSecurity.ts').assessmentDepositFor(160),20);assert.equal(h.load('shared/rentalSecurity.ts').assessmentDepositFor(999),20);assert.equal(h.load('shared/rentalSecurity.ts').assessmentDepositFor(1000),50);assert.equal(h.load('shared/rentalSecurity.ts').assessmentDepositFor(4000),100);
const utcDayOffset=offset=>{const date=new Date(Date.now()+offset*86400000);return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())};
const start=utcDayOffset(30),end=start+86400000,realFetch=global.fetch;
global.fetch=async()=>{trace.push('source-http');if(!sourceOk)throw Error('Source unavailable');return {ok:true,status:200,json:async()=>({protocolVersion:1,status:'success',path:'items:sharedStockForStorefront',value:[{version:1,checkedAt:Date.now(),units:[{masterItemId:'body',active:true,quantityOwned:1,windows:[]}]}]})}};
const ctx={db:h.db,scheduler:{runAfter:async()=>{}},runAction:async(ref,args)=>{trace.push(ref);assert.equal(ref,'sync.syncHyggloReservations');return sync.syncHyggloReservations.handler(ctx,args)},runQuery:async(ref,args)=>{trace.push(ref);if(ref==='membershipBenefits.byRequest')return memberBenefits.byRequest.handler(ctx,args);if(ref==='settings.get')return {acceptingOrders:true};if(ref==='accounts._byEmail')return accounts._byEmail.handler(ctx,args);if(ref==='accounts._byToken')return accounts._byToken.handler(ctx,args);if(ref==='bookings.availableCheckoutCredit')return bookings.availableCheckoutCredit.handler(ctx,args);if(ref==='referrals.offers')return referrals.offers.handler(ctx,args);if(ref==='promo.validate')return args.code.toLowerCase()==='db10off'?promo.validate.handler(ctx,args):{valid:true,code:'QA',discount:20};if(ref==='bookings.assertCheckoutReservation')return bookings.assertCheckoutReservation.handler(ctx,args);if(ref==='bookings.depositWaiverEligibility')return bookings.depositWaiverEligibility.handler(ctx,args);if(ref==='bookings.checkoutAttempt')return bookings.checkoutAttempt.handler(ctx,args);if(ref==='catalog.repriceLines')return catalog.repriceLines.handler(ctx,args);if(ref==='availability.forListing')return availability.forListing.handler(ctx,args);if(ref==='availability.forCart')return availability.forCart.handler(ctx,args);throw Error('Unexpected query '+ref)},runMutation:async(ref,args)=>{trace.push(ref);if(ref.startsWith('accounts.'))return accounts[ref.split('.')[1]].handler(ctx,args);if(ref==='sync.applySharedStock')return sync.applySharedStock.handler(ctx,args);if(ref.startsWith('membershipBenefits.'))return memberBenefits[ref.split('.')[1]].handler(ctx,args);assert(ref.startsWith('bookings.'));return bookings[ref.split('.')[1]].handler(ctx,args)}};
const args={items:[{listingId:listing._id,title:listing.title,start,end,qty:1,total:100,deposit:160}],customer:{email:'fixture@example.invalid',name:'Fixture Renter',billingAddress:'123 Fixture Street, London'},fulfilment:'pickup',deliveryFee:0,expectedTotalDue:0,expectedSavedCardLimit:100,pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Fixture Renter',requestId:'fixture-bound-payment-acceptance',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS}};
function cleanPriorRental(account,index){
 const start=Date.UTC(2025,0,1+index*5),end=start+86400000,returnedAt=Date.now()-((index+1)*86400000),inspection=[{key:'legacy:0:0',title:listing.title,condition:'good',details:'',openCase:false}],line={listingId:listing._id,title:listing.title,qty:1,start,end,lineTotal:100};
 return h.put('bookings',{accountId:account._id,guestEmail:account.email,status:'returned',stripeCheckoutSessionId:`cs-clean-${account._id}-${index}`,stripePaymentIntentId:`pi-clean-${account._id}-${index}`,depositAmount:0,depositHoldAmount:0,total:100,subtotal:100,rentalPaidPence:10000,checkoutExpectedAmountPence:10000,checkoutPaidAt:returnedAt-86400000,checkoutPaymentAmountPence:10000,checkoutPaymentCurrency:'GBP',checkoutPaymentStatus:'paid',currency:'GBP',paidConfirmedAt:returnedAt-86400000,returnedAt,actualReturnedAt:returnedAt,lineItems:[line],returnDecision:{actualReturnedAt:returnedAt,damageKept:0,depositKept:0,chargeLate:false,lateClaimPolicyVersion:'owner-claim-v1',inspection},returnStatement:{number:`R-${index}`,issuedAt:returnedAt+1000,actualReturnedAt:returnedAt,supplierName:'Fixture supplier',customerEmail:account.email,lineItems:[line],subtotal:100,discount:0,deliveryFee:0,creditApplied:0,checkoutPaid:100,rentalRefunded:0,securityPaid:0,securityRefunded:0,holdStatus:'not_applicable',damageTotal:0,damageFromHold:0,inspection,lateAssessed:0,lateWaived:0,lateBreakdown:[]}});
}
function attachVerifiedDidit(account){
 const now=Date.now();account.name??='Fixture Renter';account.address??='123 Fixture Road, London';account.emailVerifiedAt??=now;
 const source=h.put('bookings',{accountId:account._id,accountAccessRequired:false,guestEmail:account.email,agreementName:account.name,billingAddress:account.address,lineItems:[],diditSessionId:`didit-${account._id}`,verificationProvider:'didit',idVerificationSource:'didit',idVerifyStatus:'verified',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},status:'confirmed'});
 account.rentalVerification={sourceBookingId:source._id,name:account.name.trim().toLowerCase(),address:account.address.trim().toLowerCase(),verifiedAt:now,expiresAt:now+90*86400000};
 const archive=h.put('verification_archives',{bookingId:source._id,accountId:account._id,sessionId:source.diditSessionId,email:account.email,source:'didit',status:'complete',attempts:1,dueAt:now,createdAt:now});seedVerificationFiles(h.put,archive);
 return account;
}
function paidMembership(account){
 h.put('membership_credit_grants',{accountId:account._id,subscriptionId:account.stripeSubscriptionId,invoiceId:`in-${account.stripeSubscriptionId}`,paidMembershipPence:1900,creditPence:1900,earnedCreditPence:1900,bonusPence:0,revokedPence:0,membershipRefundedPence:0,periodEnd:account.membershipPaidThrough,createdAt:Date.now()});
}

const promo=h.load('convex/promo.ts');
const accounts=h.load('convex/accounts.ts'),referrals=h.load('convex/referrals.ts'),policy=h.load('shared/rentalSecurity.ts'),legal=h.load('src/lib/legal.ts');
Object.assign(process.env,{REFUNDABLE_DEPOSIT_POLICY_ENABLED:'true',ASSESSMENT_SECURITY_POLICY_ENABLED:'true'});
StripeFixture.prototype.customers={create:async()=>({id:'cus_fixture'}),retrieve:async id=>({id,deleted:false}),update:async id=>({id})};
StripeFixture.prototype.prices={list:async()=>({data:[{id:'price_fixture',unit_amount:1900,currency:'gbp',recurring:{interval:'month'}}]})};
(async()=>{try{
 const owner=h.put('accounts',{email:'referrer@example.invalid',emailVerifiedAt:Date.now(),referralCode:'DBC-ABCDEFGHIJKLMN'});
 h.put('promo_codes',{code:'db10off',type:'percent',value:10,active:true,usedCount:0,firstOrderOnly:true});
 for(const version of ['2026-10-v15','2026-10-v16']){
  const text=h.load('shared/legalDocuments.ts').LEGAL_ARCHIVE[version]['deposit-agreement'].sections.map(section=>section.p).join(' ');
  assert.match(text,/Eligible active members\/subscribers and verified Encore renters/);
  assert.match(text,/accepted quotation records the exact amount and exemption/);
  assert.doesNotMatch(text,/selecting a (new )?subscription (automatically )?waives/i);
 }
 for(const version of [legal.ASSESSMENT_DEPOSIT_LEGAL_VERSION,legal.CANCELLATION_PROTECTION_LEGAL_VERSION]){
  const text=h.load('shared/legalDocuments.ts').LEGAL_ARCHIVE[version]['deposit-agreement'].sections.map(section=>section.p).join(' ');
  assert.match(text,/first rental never qualifies/i);
  assert.match(text,/at least one successful recurring payment/i);
  assert.match(text,/final Encore level recorded/i);
  assert.match(text,/every item recorded in a good-condition return inspection/i);
  assert.match(text,/No extra funds are blocked/i);
  assert.doesNotMatch(text,/Eligible active members\/subscribers and verified Encore renters have no cash deposit/);
 }
 const waiverChecker=h.load('convex/lib/strictDepositWaiver.ts');
 const claimAccount=attachVerifiedDidit(h.put('accounts',{email:'member-with-prior-claim@example.invalid',stripeCustomerId:'cus_claim',stripeSubscriptionId:'sub_claim',membershipActive:true,membershipStatus:'active',membershipPaidThrough:Date.now()+30*86400000}));
 paidMembership(claimAccount);
 const claimBooking=cleanPriorRental(claimAccount,99);
 assert.equal(await waiverChecker.strictDepositWaiverReason(ctx,claimAccount,99900),'active_membership');
 assert.equal(await waiverChecker.strictDepositWaiverReason(ctx,claimAccount,400000),undefined,'The waiver does not apply at the £4,000 equipment threshold.');
 h.put('rental_security_charges',{bookingId:claimBooking._id,accountId:claimAccount._id,requestId:'prior-claim-00000001',kind:'damage',amountPence:1000,reason:'Previously claimed item damage',customerId:'cus_claim',paymentMethodId:'pm_claim',consentSnapshot:'{}',state:'voided',createdAt:Date.now(),updatedAt:Date.now()});
 assert.equal(await waiverChecker.strictDepositWaiverReason(ctx,claimAccount,99900),undefined,'A prior rental with any security claim is not issue-free, even if that claim was later voided.');
 const incompleteAccount=attachVerifiedDidit(h.put('accounts',{email:'member-incomplete-return@example.invalid',stripeCustomerId:'cus_incomplete',stripeSubscriptionId:'sub_incomplete',membershipActive:true,membershipStatus:'active',membershipPaidThrough:Date.now()+30*86400000}));
 paidMembership(incompleteAccount);
 const incompleteBooking=cleanPriorRental(incompleteAccount,98);
 incompleteBooking.returnStatement=undefined;
 assert.equal(await waiverChecker.strictDepositWaiverReason(ctx,incompleteAccount,99900),undefined,'A returned booking without its completed return statement is not eligible.');
 const uncleanAccount=attachVerifiedDidit(h.put('accounts',{email:'member-unclean-return@example.invalid',stripeCustomerId:'cus_unclean',stripeSubscriptionId:'sub_unclean',membershipActive:true,membershipStatus:'active',membershipPaidThrough:Date.now()+30*86400000}));
 paidMembership(uncleanAccount);
 const uncleanBooking=cleanPriorRental(uncleanAccount,97);
 uncleanBooking.returnDecision.inspection[0].condition='fair';
 uncleanBooking.returnStatement.inspection[0].condition='fair';
 assert.equal(await waiverChecker.strictDepositWaiverReason(ctx,uncleanAccount,99900),undefined,'A completed return with any item below good condition is not eligible.');
 const staleSubscriptionAccount=attachVerifiedDidit(h.put('accounts',{email:'member-stale-subscription@example.invalid',stripeCustomerId:'cus_stale',stripeSubscriptionId:'sub_current',membershipActive:true,membershipStatus:'active',membershipPaidThrough:Date.now()+30*86400000}));
 cleanPriorRental(staleSubscriptionAccount,96);
 h.put('membership_credit_grants',{accountId:staleSubscriptionAccount._id,subscriptionId:'sub_previous',invoiceId:'in-previous',paidMembershipPence:1900,creditPence:1900,earnedCreditPence:1900,bonusPence:0,revokedPence:0,membershipRefundedPence:0,periodEnd:staleSubscriptionAccount.membershipPaidThrough,createdAt:Date.now()});
 assert.equal(await waiverChecker.strictDepositWaiverReason(ctx,staleSubscriptionAccount,99900),undefined,'A successful payment from an old subscription cannot qualify a different current subscription.');
 for(const [value,deposit] of [[999,20],[1000,50],[4000,100]]){
  listing.depositAmount=value;
  const quote=await checkout.priceQuote.handler(ctx,{items:args.items,customerEmail:'guest-threshold@example.invalid',fulfilment:'pickup',selectedMembership:{tier:'plus',intro:'none'}});
  assert.equal(quote.depositAmount,deposit,`Guest signup at £${value} equipment value`);
 }
 listing.depositAmount=160;
 for(const [index,signedIn] of [false,true].entries()){
  const email=(signedIn?'new-account':'guest')+'@example.invalid',token=signedIn?'new-account-token':undefined;
  if(signedIn){const account=h.put('accounts',{email,emailVerifiedAt:Date.now(),stripeCustomerId:'cus_fixture'});h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+86400000});}
 const {legalVersionForPolicy,CURRENT_PRIVACY_NOTICE_VERSION}=h.load('shared/legalVersioning.ts');
 const selectedMembership={tier:'plus',intro:'none',termsVersion:h.load('shared/membership.ts').MEMBERSHIP_TERMS_VERSION,requestId:(signedIn?'s':'g').repeat(40),...(!signedIn?{accountTermsPrivacyAcknowledged:true,accountTermsVersion:legalVersionForPolicy({}),privacyNoticeVersion:CURRENT_PRIVACY_NOTICE_VERSION}:{})};
  const signup=structuredClone(args);signup.token=token;signup.customer.email=email;signup.selectedMembership=selectedMembership;
  signup.items[0].start+=(70+index*5)*86400000;signup.items[0].end+=(70+index*5)*86400000;
  signup.agreement.documents=legal.agreementsForSecurityPolicy(policy.ASSESSMENT_SECURITY_POLICY_VERSION);signup.agreement.requestId='fixture-signup-no-waiver-'+index;
  const quote=await checkout.priceQuote.handler(ctx,{items:signup.items,token,customerEmail:email,fulfilment:'pickup',selectedMembership:{tier:'plus',intro:'none'}});
  assert.equal(quote.depositAmount,20);assert.equal(quote.securityWaiverReason,undefined);
  signup.expectedTotalDue=quote.combinedTotalDue;signup.expectedSavedCardLimit=quote.savedCardLimit;
  const stale={...signup,expectedTotalDue:signup.expectedTotalDue-20},bookingsBefore=(h.tables.get('bookings')??[]).length,accountsBefore=(h.tables.get('accounts')??[]).length,membershipsBefore=(h.tables.get('membership_checkouts')??[]).length,createsBefore=creates;
  await assert.rejects(checkout.start.handler(ctx,stale),/rental total has changed/);
  assert.equal((h.tables.get('bookings')??[]).length,bookingsBefore);assert.equal((h.tables.get('accounts')??[]).length,accountsBefore);assert.equal((h.tables.get('membership_checkouts')??[]).length,membershipsBefore);assert.equal(creates,createsBefore);
  const normalMutation=ctx.runMutation;let guardTested=false;
  ctx.runMutation=async(ref,input)=>{if(ref==='bookings.createPending'){guardTested=true;await assert.rejects(normalMutation(ref,{...input,securityWaiverReason:'membership_checkout'}),/deposit exemption/);}return normalMutation(ref,input)};
  try{await checkout.start.handler(ctx,{...signup,idVerifyStatus:'verified',verificationProvider:'manual'});}finally{ctx.runMutation=normalMutation;}
  assert(guardTested);const params=captured.at(-1),booking=h.tables.get('bookings').at(-1);
  assert.equal(booking.idVerifyStatus,'required','Every new checkout begins with Didit verification required');assert.equal(booking.verificationProvider,'didit','The pending booking cannot choose an alternate verification provider');
  assert.equal(booking.depositAmount,20);assert.equal(booking.securityWaiverReason,undefined);
  assert.equal(params.line_items.find(item=>item.price_data?.product_data?.name?.startsWith('Refundable security deposit')).price_data.unit_amount,2000);
 }
 for(const [index,kind] of ['plain','credit','member','member-no-history','trial','manual-encore-no-history','manual-encore','referral','voucher','encore','threshold'].entries()){
  const paid=['member','member-no-history','threshold'].includes(kind),trial=kind==='trial',periodEnd=Date.now()+86400000;
  const account=h.put('accounts',{email:kind+'@example.invalid',emailVerifiedAt:Date.now(),stripeCustomerId:'cus_fixture',...(paid?{stripeSubscriptionId:'sub-'+kind,membershipActive:true,membershipTier:'pro',membershipStatus:'active',membershipPaidThrough:periodEnd}:{}),...(trial?{stripeSubscriptionId:'sub-trial',membershipActive:true,membershipTier:'pro',membershipStatus:'trialing',membershipPaidThrough:periodEnd}:{}),...(['manual-encore','manual-encore-no-history'].includes(kind)?{adminEncoreLevel:3,loyaltyLevel:3,loyaltyPolicyVersion:'review-earned-v1',loyaltyEligible:true,loyaltyCompleted:1}:{})});
  if(['member','member-no-history','trial','manual-encore-no-history','manual-encore','threshold','encore'].includes(kind))attachVerifiedDidit(account);
  if(paid)paidMembership(account);
  if(['member','trial','manual-encore','threshold'].includes(kind))cleanPriorRental(account,0);
  if(kind==='encore'){
   const {reviewContext}=h.load('convex/lib/reviewContext.ts'),{reviewSettlementFingerprint}=h.load('convex/lib/reviewEligibility.ts');
   account.loyaltyLevel=3;
   for(let i=0;i<3;i++){const past=cleanPriorRental(account,i);past.stripeCheckoutSessionId='cs-past-'+i;past.reviewEligibilityFingerprint=reviewSettlementFingerprint(await reviewContext(ctx,past));h.put('reviews',{verifiedBookingId:past._id,source:'native',authorAccountId:account._id,rating:1,published:false});}
  }
  const token='token-'+kind;h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+86400000});
  if(kind==='credit')h.put('credits',{accountId:account._id,amount:1000,remaining:1000,kind:'refund',createdAt:0,expiresAt:Date.now()+86400000,status:'active'});
  const a=structuredClone(args);a.token=token;a.customer.email=account.email;a.items[0].start+=index*5*86400000;a.items[0].end+=index*5*86400000;
  a.agreement.documents=legal.agreementsForSecurityPolicy(policy.ASSESSMENT_SECURITY_POLICY_VERSION);a.agreement.requestId='fixture-deposit-full-'+kind;
  if(kind==='referral')a.promoCode=owner.referralCode;
  if(kind==='voucher')a.promoCode='DB10OFF';
  if(kind==='threshold'){unit.replacementCost=4000;listing.depositAmount=4000;}
  const quote=await checkout.priceQuote.handler(ctx,{items:a.items,token,customerEmail:account.email,fulfilment:'pickup',promoCode:a.promoCode});
  const waiver=['member','encore'].includes(kind),cash=waiver?0:kind==='threshold'?100:20;assert.equal(quote.depositAmount,cash,kind);assert.equal(quote.savedCardLimit,0);assert.equal(quote.securityWaiverReason,kind==='member'?'active_membership':waiver?'encore':undefined,kind);
  a.expectedTotalDue=quote.combinedTotalDue;a.expectedSavedCardLimit=quote.savedCardLimit;
  let guardTested=false;const runMutation=ctx.runMutation;
  if(['member-no-history','trial','manual-encore-no-history'].includes(kind))ctx.runMutation=async(ref,input)=>{if(ref==='bookings.createPending'){guardTested=true;await assert.rejects(runMutation(ref,{...input,securityWaiverReason:kind==='manual-encore-no-history'?'encore':'active_membership',depositAmount:0}),/deposit eligibility changed/);}return runMutation(ref,input)};
  try{await checkout.start.handler(ctx,a);}finally{ctx.runMutation=runMutation;}
  if(['member-no-history','trial','manual-encore-no-history'].includes(kind))assert(guardTested);
  const params=captured.at(-1),b=h.tables.get('bookings').at(-1);
  assert.equal(params.mode,'payment');assert.equal(params.payment_intent_data.setup_future_usage,'off_session');
  const deposit=params.line_items.find(l=>l.price_data.product_data.name.startsWith('Refundable security deposit'));
  if(cash)assert.equal(deposit.price_data.unit_amount,cash*100);else assert.equal(deposit,undefined);
  assert.equal(params.line_items.reduce((sum,l)=>sum+l.price_data.unit_amount*l.quantity,0),Math.round(quote.totalDue*100));
  assert(!params.custom_text.submit.message.includes('limit'));assert(!params.custom_text.submit.message.includes('10%'));if(cash)assert(!params.custom_text.submit.message.includes('No cash security deposit'));else assert(params.custom_text.submit.message.includes('No cash security deposit'));assert(params.custom_text.submit.message.length<=500);
  assert.equal(b.depositAmount,cash);assert.equal(JSON.parse(b.agreementSnapshot).version,legal.ASSESSMENT_DEPOSIT_LEGAL_VERSION);
  if(b.verificationProvider==='didit')await h.db.patch(b._id,{idVerifyStatus:'verified',idVerificationSource:'didit',idVerifiedAt:Date.now(),verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},verificationExpiresAt:Date.now()+86400000,documentExpiresAt:Date.now()+86400000});
  await bookings.confirm.handler(ctx,{bookingId:b._id,paymentIntentId:'pi-'+kind});
  assert(Number.isSafeInteger(b.paidConfirmedAt),'Actual confirmation records payment evidence even for later cancellation');
  assert.equal(b.status,'confirmed');assert(h.tables.get('reservations').some(r=>r.bookingId===b._id&&r.status==='confirmed'));
  if(kind==='credit')assert.equal(quote.totalDue,20,'Refund credit cannot pay cash security');
  if(kind==='referral')assert.equal(quote.benefitKind,'referral_friend');
  if(kind==='voucher'){
    assert.equal(quote.benefitKind,'promo');assert.equal(b.promoCode,'db10off');
    assert.equal(b.discount,10);assert.equal(quote.membershipSignupOfferSaving??0,0);
    assert.equal(quote.weekendSaving??0,0);assert.equal(quote.loyaltySaving??0,0);assert.equal(quote.earnedCreditApplied??0,0);
    assert.equal((await promo.validate.handler(ctx,{code:'db10off',token,eligibleSubtotal:100})).valid,false,'Paid first order permanently consumes eligibility');
    await h.db.patch(b._id,{status:'cancelled'});
    assert.equal((await promo.validate.handler(ctx,{code:'db10off',token,eligibleSubtotal:100})).valid,false,'Refund/cancellation cannot restore the first-order voucher');
  }
  if(kind==='threshold'){unit.replacementCost=160;listing.depositAmount=160;}
 }
 process.env.CANCELLATION_PROTECTION_POLICY_ENABLED='true';
 for(const [index,useAccountCredit]of [false,true].entries()){
  const account=h.put('accounts',{email:'credit-choice-'+index+'@example.invalid',emailVerifiedAt:Date.now(),stripeCustomerId:'cus_fixture'}),token='credit-choice-'+index;
  h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+86400000});
  h.put('credits',{accountId:account._id,amount:10,remaining:10,kind:'earned',currency:'GBP',createdAt:Date.now(),expiresAt:Date.now()+365*86400000,status:'active'});
  const a=structuredClone(args);a.token=token;a.customer.email=account.email;a.useAccountCredit=useAccountCredit;a.items[0].start+=120*86400000+index*5*86400000;a.items[0].end+=120*86400000+index*5*86400000;
  a.agreement.documents=legal.agreementsForSecurityPolicy(policy.ASSESSMENT_SECURITY_POLICY_VERSION,true);a.agreement.requestId='fixture-seven-day-choice-'+index;
  const quote=await checkout.priceQuote.handler(ctx,{items:a.items,token,customerEmail:account.email,fulfilment:'pickup',useAccountCredit});
  assert.equal(quote.cancellationProtectionEnabled,true);assert.equal(quote.availableAccountCredit,10);assert.equal(quote.creditApplied,useAccountCredit?10:0);
  a.expectedTotalDue=quote.combinedTotalDue;a.expectedSavedCardLimit=0;
  const stale={...a,agreement:{...a.agreement,documents:legal.agreementsForSecurityPolicy(policy.ASSESSMENT_SECURITY_POLICY_VERSION)}};
  await assert.rejects(checkout.start.handler(ctx,stale),/current rental agreements/);
  await checkout.start.handler(ctx,a);const params=captured.at(-1),b=h.tables.get('bookings').at(-1);
  assert.equal(b.useAccountCredit,useAccountCredit);assert.equal(b.cancellationProtectionEnabled,true);
  const snapshot=JSON.parse(b.agreementSnapshot);assert.equal(snapshot.version,legal.CANCELLATION_PROTECTION_LEGAL_VERSION);assert.equal(snapshot.particulars.useAccountCredit,useAccountCredit);
  const cancellation=snapshot.documents.find(d=>d.kind==='cancellation').text;assert.match(JSON.stringify(cancellation),/seven or fewer London calendar days/);assert.match(JSON.stringify(snapshot.documents.find(d=>d.kind==='terms').text),/before booking/);
  assert.equal(params.line_items.reduce((n,l)=>n+l.price_data.unit_amount*l.quantity,0),Math.round(quote.totalDue*100));assert.equal(quote.totalDue,useAccountCredit?110:120);assert.equal(b.depositAmount,20);
  if(b.verificationProvider==='didit')await h.db.patch(b._id,{idVerifyStatus:'verified',idVerificationSource:'didit',idVerifiedAt:Date.now(),verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},verificationExpiresAt:Date.now()+86400000,documentExpiresAt:Date.now()+86400000});
  await bookings.confirm.handler(ctx,{bookingId:b._id,paymentIntentId:'pi-choice-'+index});
  const invoice=await bookings.invoiceData.handler(ctx,{bookingId:b._id,token});assert.equal(invoice.creditApplied,useAccountCredit?10:0);assert.equal(invoice.total,quote.totalDue);
  assert.equal(h.tables.get('credits').find(c=>c.accountId===account._id).remaining,useAccountCredit?0:10);
  const paidNotice=h.tables.get('admin_notifications').find(n=>n.eventKey==='paid:'+b._id);assert.equal(paidNotice.income.net,useAccountCredit?90:100,'Money-made notifications exclude credit already funded or granted earlier');
 }
 delete process.env.CANCELLATION_PROTECTION_POLICY_ENABLED;
 process.env.CARD_HOLD_SECURITY_POLICY_ENABLED='true';
 for(const [index,value,hold] of [[0,999,50],[1,1000,100],[2,3999,100],[3,4000,200]]){
  unit.replacementCost=value;listing.depositAmount=value;
  const a=structuredClone(args);a.items[0].deposit=value;a.items[0].start+=(200+index*3)*86400000;a.items[0].end+=(200+index*3)*86400000;
  a.agreement.documents=legal.agreementsForSecurityPolicy(policy.CARD_HOLD_SECURITY_POLICY_VERSION);a.agreement.laterChargeConsent=false;a.agreement.requestId='fixture-card-hold-'+index;
  const quote=await checkout.priceQuote.handler(ctx,{items:a.items,customerEmail:'card-hold-'+index+'@example.invalid',fulfilment:'pickup'});
  assert.equal(quote.securityPolicyVersion,policy.CARD_HOLD_SECURITY_POLICY_VERSION);assert.equal(quote.depositAmount,0);assert.equal(quote.depositHoldAmount,hold);assert.equal(quote.savedCardLimit,0);assert.equal(quote.securityWaiverReason,undefined);
  a.customer.email='card-hold-'+index+'@example.invalid';a.expectedTotalDue=quote.combinedTotalDue;a.expectedSavedCardLimit=0;
  await checkout.start.handler(ctx,a);
  const params=captured.at(-1),booking=h.tables.get('bookings').at(-1);
  assert.equal(booking.securityPolicyVersion,policy.CARD_HOLD_SECURITY_POLICY_VERSION);assert.equal(booking.securityHoldPolicyVersion,'2026-11-checkout-card-hold-v1');
  assert.equal(booking.depositAmount,0);assert.equal(booking.depositHoldAmount,hold);assert.equal(booking.savedCardLimit,undefined);assert.equal(booking.laterChargeConsentAt,undefined);
  assert.equal(params.line_items.reduce((sum,line)=>sum+line.price_data.unit_amount*line.quantity,0),Math.round(quote.totalDue*100),'Hold is not added to checkout payment');
  assert.match(params.custom_text.submit.message,/not a charge/i);assert.match(params.custom_text.submit.message,/recorded reason/i);assert(!params.custom_text.submit.message.includes('later card limit'));
  assert.equal(JSON.parse(booking.agreementSnapshot).version,legal.CARD_HOLD_LEGAL_VERSION);
 }
 unit.replacementCost=999;listing.depositAmount=999;
 for(const [index,hasCleanReturn,expectedHold,expectedReason] of [[0,false,50,undefined],[1,true,0,'active_membership']]){
  const periodEnd=Date.now()+86400000,email=`card-hold-member-${index}@example.invalid`,token=`card-hold-member-token-${index}`;
  const account=h.put('accounts',{email,emailVerifiedAt:Date.now(),stripeCustomerId:'cus_fixture',stripeSubscriptionId:`sub-card-hold-${index}`,membershipActive:true,membershipTier:'pro',membershipStatus:'active',membershipPaidThrough:periodEnd});
  if(hasCleanReturn)attachVerifiedDidit(account);
  h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+86400000});paidMembership(account);
  if(hasCleanReturn)cleanPriorRental(account,index);
  const holdStart=utcDayOffset(30+index*5),items=[{...args.items[0],start:holdStart,end:holdStart+86400000,deposit:999}];
  const quote=await checkout.priceQuote.handler(ctx,{items,token,customerEmail:email,fulfilment:'pickup'});
  assert.equal(quote.depositHoldAmount,expectedHold);assert.equal(quote.securityWaiverReason,expectedReason);
 }
 const holdAgreement=legal.agreementsForSecurityPolicy(policy.CARD_HOLD_SECURITY_POLICY_VERSION);
 assert.match(h.load('shared/legalDocuments.ts').LEGAL_ARCHIVE[legal.CARD_HOLD_LEGAL_VERSION]['deposit-agreement'].sections.map(section=>section.p).join(' '),/five hours before pickup/i);
 assert.match(h.load('shared/legalDocuments.ts').LEGAL_ARCHIVE[legal.CARD_HOLD_LEGAL_VERSION]['deposit-agreement'].sections.map(section=>section.p).join(' '),/without reported issues, we automatically cancel/i);
 const pickupPolicy=h.load('shared/pickupSecurity.ts');
 assert.equal(pickupPolicy.pickupHoldEligible({securityHoldPolicyVersion:'2026-11-checkout-card-hold-v1',status:'pending_verification',depositHoldAmount:50}),true);
 assert.equal(pickupPolicy.pickupHoldEligible({securityHoldPolicyVersion:'2026-11-checkout-hold-v1',status:'pending_verification',depositHoldAmount:50}),false,'Only the new version authorises during pending verification');
 assert(holdAgreement.some(doc=>doc.kind==='deposit-agreement'&&doc.version===legal.CARD_HOLD_LEGAL_VERSION));
 delete process.env.CARD_HOLD_SECURITY_POLICY_ENABLED;
 process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED='true';
 for(const [index,value,limit] of [[0,999,50],[1,1000,100],[2,3999.99,100],[3,4000,200]]){
  unit.replacementCost=value;listing.depositAmount=value;
  const email=`setup-intent-${index}@example.invalid`,a=structuredClone(args);a.customer.email=email;a.items[0].deposit=value;a.items[0].start+=(260+index*3)*86400000;a.items[0].end+=(260+index*3)*86400000;
  a.agreement.documents=legal.agreementsForSecurityPolicy(policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION);a.agreement.requestId=`fixture-immediate-claim-${index}`;
  const quote=await checkout.priceQuote.handler(ctx,{items:a.items,customerEmail:email,fulfilment:'pickup'});
  assert.equal(quote.securityPolicyVersion,policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION);assert.equal(quote.savedCardLimit,limit);assert.equal(quote.depositAmount,0);assert.equal(quote.depositHoldAmount,0);assert.equal(quote.securityWaiverReason,undefined);
  a.expectedTotalDue=quote.combinedTotalDue;a.expectedSavedCardLimit=limit;
  await checkout.start.handler(ctx,a);
  const params=captured.at(-1),booking=h.tables.get('bookings').at(-1),snapshot=JSON.parse(booking.agreementSnapshot);
  assert.equal(params.mode,'payment');assert.equal(params.payment_intent_data.setup_future_usage,'off_session');assert.equal(booking.securityPolicyVersion,policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION);
  assert.equal(booking.depositAmount,0);assert.equal(booking.depositHoldAmount,0);assert.equal(booking.savedCardLimit,limit);assert.equal(booking.securityHoldPolicyVersion,undefined);assert.equal(h.load('shared/savedCardSecurity.ts').assertSavedCardConsent(booking),limit);
  assert(!params.line_items.some(line=>line.price_data.product_data.name.startsWith('Refundable security deposit')));assert.equal(snapshot.version,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
  assert.match(snapshot.particulars.savedCardConsent,/no funds are reserved/i);assert.match(snapshot.particulars.savedCardConsent,new RegExp(`£${limit}\\.00`));assert.match(snapshot.particulars.savedCardConsent,/attempt that amount immediately/i);assert.doesNotMatch(snapshot.particulars.savedCardConsent,/10% of the quoted/i);
  assert.match(params.custom_text.submit.message,/No deposit or funds are held/i);assert(params.custom_text.submit.message.length<=500);
 }
 const setupIntentTerms=h.load('shared/legalDocuments.ts').LEGAL_ARCHIVE[legal.IMMEDIATE_CLAIM_LEGAL_VERSION]['deposit-agreement'].sections.map(section=>section.p).join(' ');
 assert.match(setupIntentTerms,/below £1,000/);assert.match(setupIntentTerms,/one off-session collection attempt using the saved card/);assert.match(setupIntentTerms,/may happen immediately after notice/);assert.doesNotMatch(setupIntentTerms,/at least seven days/);assert.match(setupIntentTerms,/Insurance claims and any policy excess are separate/);assert.match(setupIntentTerms,/No amount is automatically charged for an on-time return/);
 const creditAccount=h.put('accounts',{email:'setup-intent-zero@example.invalid',emailVerifiedAt:Date.now(),stripeCustomerId:'cus_zero'}),creditToken='setup-intent-zero-token';
 h.put('sessions',{token:creditToken,accountId:creditAccount._id,expiresAt:Date.now()+86400000});h.put('credits',{accountId:creditAccount._id,amount:1000,remaining:1000,kind:'refund',createdAt:Date.now(),expiresAt:Date.now()+365*86400000,status:'active'});
 const zeroArgs=structuredClone(args);zeroArgs.token=creditToken;zeroArgs.customer.email=creditAccount.email;zeroArgs.useAccountCredit=true;zeroArgs.items[0].start+=280*86400000;zeroArgs.items[0].end+=280*86400000;zeroArgs.agreement.documents=legal.agreementsForSecurityPolicy(policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION);zeroArgs.agreement.requestId='fixture-immediate-claim-zero-due';
 const zeroQuote=await checkout.priceQuote.handler(ctx,{items:zeroArgs.items,token:creditToken,customerEmail:creditAccount.email,fulfilment:'pickup',useAccountCredit:true});assert.equal(zeroQuote.totalDue,0);zeroArgs.expectedTotalDue=zeroQuote.combinedTotalDue;zeroArgs.expectedSavedCardLimit=zeroQuote.savedCardLimit;
 await checkout.start.handler(ctx,zeroArgs);const zeroParams=captured.at(-1);assert.equal(zeroParams.mode,'setup');assert(zeroParams.setup_intent_data?.metadata?.securityPolicyVersion===policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION);assert.equal(zeroParams.line_items,undefined);
 const trialAccount=h.put('accounts',{email:'setup-intent-trial@example.invalid',emailVerifiedAt:Date.now(),stripeCustomerId:'cus_trial'}),trialToken='setup-intent-trial-token';h.put('sessions',{token:trialToken,accountId:trialAccount._id,expiresAt:Date.now()+86400000});
 await checkout.startMembership.handler(ctx,{token:trialToken,tier:'plus',origin:'https://fixture.invalid',intro:'trial',termsVersion:h.load('shared/membership.ts').MEMBERSHIP_TERMS_VERSION,requestId:'setup-intent-trial-checkout'});
 const trialParams=captured.at(-1);assert.equal(trialParams.mode,'subscription');assert.equal(trialParams.payment_method_collection,'always');assert.equal(trialParams.subscription_data.trial_period_days,7);assert.equal(trialParams.subscription_data.trial_settings.end_behavior.missing_payment_method,'cancel');
 delete process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED;
 console.log('PASS future saved-card policy: £50/£100/£200 no-hold caps, paid and zero-due Stripe setup, explicit v20 consent, no seven-day hold renewal, and card-required 7-day subscription trial. Synthetic transport/data only.');
}finally{global.fetch=realFetch}})().catch(e=>{console.error(e);process.exitCode=1});
