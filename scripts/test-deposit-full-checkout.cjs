const captured=[];
const {createHash}=require('node:crypto');const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const sessions=new Map(),trace=[];let creates=0,retrieves=0,sourceOk=true,sessionStatus='open',sessionMismatch=false,transportError=false;
class StripeFixture {
 static errors={StripeInvalidRequestError:class extends Error{}};
 paymentMethodConfigurations={retrieve:async()=>({active:true,card:{display_preference:{value:'on'}},apple_pay:{display_preference:{value:'off'}},google_pay:{display_preference:{value:'off'}},link:{display_preference:{value:'off'}}})};
 paymentIntents={retrieve:async id=>({id,status:'succeeded',customer:'cus_fixture',setup_future_usage:'off_session',payment_method:'pm_fixture'})};
 paymentMethods={retrieve:async id=>({id,type:'card',customer:'cus_fixture'})};
 checkout={sessions:{create:async params=>{creates++;captured.push(params);const s={id:'cs-fixture-'+creates,status:'open',url:'https://fixture.invalid/payment/'+creates,metadata:params.metadata};sessions.set(s.id,s);return s},retrieve:async id=>{retrieves++;if(transportError)throw Error('Unknown provider outcome');const s=sessions.get(id);return {...s,status:sessionStatus,...(sessionMismatch?{metadata:{bookingId:'wrong-booking'}}:{})}}}};
}
h.setMock('stripe',{default:StripeFixture});
h.setMock('../shared/legalDocuments',{RENTAL_DRAFT_RELEASE_READY:true});
h.setMock('../shared/rentalAgreementRelease',{RENTAL_DRAFT_RELEASE_READY:true});
const checkout=h.load('convex/checkout.ts'),bookings=h.load('convex/bookings.ts'),catalog=h.load('convex/catalog.ts'),availability=h.load('convex/availability.ts'),sync=h.load('convex/sync.ts'),memberBenefits=h.load('convex/membershipBenefits.ts'),{agreementRequestFingerprint}=h.load('shared/rentalAgreement.ts'),{AGREEMENTS}=h.load('src/lib/legal.ts');
const {toPence}=h.load('convex/lib/pricing.ts'),{initialInvoiceSnapshot}=h.load('convex/lib/initialInvoiceSnapshot.ts');
Object.assign(process.env,{SHARED_STOCK_AUTHORITY_READY:'enabled',SHARED_STOCK_BRIDGE_EXPERIMENTAL:'true',SHARED_STOCK_WEBSITE_SECRET:'fixture-stock-authority-secret-12345678901234567890',RMV2_WEBHOOK_URL:'https://fixture-manager.convex.site/dbcinema/booking-sync',RMV2_WEBHOOK_SECRET:'fixture-private-read',RENTAL_CHECKOUT_ENABLED:'true',DIDIT_API_KEY:'test',DIDIT_WORKFLOW_ID:'test',DIDIT_WEBHOOK_SECRET:'test',DIDIT_APPLICATION_ID:'test',DIDIT_ENVIRONMENT:'sandbox',STRIPE_WEBHOOK_SECRET:'test',STRIPE_SECRET_KEY:'test',STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID:'test',INVOICE_SECRET:'test',APP_URL:'https://fixture.invalid',BUSINESS_LEGAL_NAME:'Fixture supplier',BUSINESS_INVOICE_ADDRESS:'Fixture address',RESEND_API_KEY:'test',RESEND_FROM:'DB Cinema Rentals <bookings@dbcinemarentals.com>'});
const unit=h.put('inventory_units',{name:'Source camera',sku:'mi-body',rmv2ItemId:'body',quantityOwned:1,active:true,replacementCost:1000}),listing=h.put('listings',{title:'Source camera',slug:'source-camera',category:'Cameras',itemType:'camera-body',active:true,stockMappingStatus:'complete',components:[{inventoryUnitId:unit._id,qty:1}],pricing:{daily:50},depositAmount:1000});
const start=Date.UTC(2030,0,1),end=start+86400000,realFetch=global.fetch;
global.fetch=async()=>{trace.push('source-http');if(!sourceOk)throw Error('Source unavailable');return {ok:true,status:200,json:async()=>({protocolVersion:1,status:'success',path:'items:sharedStockForStorefront',value:[{version:1,checkedAt:Date.now(),units:[{masterItemId:'body',active:true,quantityOwned:1,windows:[]}]}]})}};
const ctx={db:h.db,scheduler:{runAfter:async()=>{}},runAction:async(ref,args)=>{trace.push(ref);assert.equal(ref,'sync.syncHyggloReservations');return sync.syncHyggloReservations.handler(ctx,args)},runQuery:async(ref,args)=>{trace.push(ref);if(ref==='membershipBenefits.byRequest')return memberBenefits.byRequest.handler(ctx,args);if(ref==='settings.get')return {acceptingOrders:true};if(ref==='accounts._byEmail')return accounts._byEmail.handler(ctx,args);if(ref==='accounts._byToken')return accounts._byToken.handler(ctx,args);if(ref==='bookings.availableCheckoutCredit')return bookings.availableCheckoutCredit.handler(ctx,args);if(ref==='referrals.offers')return referrals.offers.handler(ctx,args);if(ref==='promo.validate')return args.code.toLowerCase()==='db10off'?promo.validate.handler(ctx,args):{valid:true,code:'QA',discount:20};if(ref==='bookings.assertCheckoutReservation')return bookings.assertCheckoutReservation.handler(ctx,args);if(ref==='bookings.checkoutAttempt')return bookings.checkoutAttempt.handler(ctx,args);if(ref==='catalog.repriceLines')return catalog.repriceLines.handler(ctx,args);if(ref==='availability.forListing')return availability.forListing.handler(ctx,args);if(ref==='availability.forCart')return availability.forCart.handler(ctx,args);throw Error('Unexpected query '+ref)},runMutation:async(ref,args)=>{trace.push(ref);if(ref.startsWith('accounts.'))return accounts[ref.split('.')[1]].handler(ctx,args);if(ref==='sync.applySharedStock')return sync.applySharedStock.handler(ctx,args);if(ref.startsWith('membershipBenefits.'))return memberBenefits[ref.split('.')[1]].handler(ctx,args);assert(ref.startsWith('bookings.'));return bookings[ref.split('.')[1]].handler(ctx,args)}};
const args={items:[{listingId:listing._id,title:listing.title,start,end,qty:1,total:100,deposit:1000}],customer:{email:'fixture@example.invalid',name:'Fixture Renter',billingAddress:'123 Fixture Street, London'},fulfilment:'pickup',deliveryFee:0,expectedTotalDue:0,expectedSavedCardLimit:100,pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Fixture Renter',requestId:'fixture-bound-payment-acceptance',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS}};

const promo=h.load('convex/promo.ts');
const accounts=h.load('convex/accounts.ts'),referrals=h.load('convex/referrals.ts'),policy=h.load('shared/rentalSecurity.ts'),legal=h.load('src/lib/legal.ts');
Object.assign(process.env,{REFUNDABLE_DEPOSIT_POLICY_ENABLED:'true'});
StripeFixture.prototype.customers={create:async()=>({id:'cus_fixture'}),retrieve:async id=>({id,deleted:false})};
(async()=>{try{
 const owner=h.put('accounts',{email:'referrer@example.invalid',emailVerifiedAt:Date.now(),referralCode:'DBC-ABCDEFGHIJKLMN'});
 h.put('promo_codes',{code:'db10off',type:'percent',value:10,active:true,usedCount:0,firstOrderOnly:true});
 for(const [index,kind] of ['plain','credit','member','referral','voucher'].entries()){
  const account=h.put('accounts',{email:kind+'@example.invalid',emailVerifiedAt:Date.now(),stripeCustomerId:'cus_fixture',...(kind==='member'?{membershipActive:true,membershipTier:'pro',membershipStatus:'active',membershipPaidThrough:Date.now()+86400000}: {})});
  const token='token-'+kind;h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+86400000});
  if(kind==='credit')h.put('credits',{accountId:account._id,amount:1000,remaining:1000,kind:'refund',createdAt:0,expiresAt:Date.now()+86400000,status:'active'});
  const a=structuredClone(args);a.token=token;a.customer.email=account.email;a.items[0].start+=index*5*86400000;a.items[0].end+=index*5*86400000;
  a.agreement.documents=legal.agreementsForSecurityPolicy(policy.REFUNDABLE_DEPOSIT_POLICY_VERSION);a.agreement.requestId='fixture-deposit-full-'+kind;
  if(kind==='referral')a.promoCode=owner.referralCode;
  if(kind==='voucher')a.promoCode='DB10OFF';
  const quote=await checkout.priceQuote.handler(ctx,{items:a.items,token,customerEmail:account.email,fulfilment:'pickup',promoCode:a.promoCode});
  assert.equal(quote.depositAmount,50);assert.equal(quote.savedCardLimit,100);assert.equal(quote.securityWaiverReason,undefined);
  a.expectedTotalDue=quote.combinedTotalDue;a.expectedSavedCardLimit=quote.savedCardLimit;
  await checkout.start.handler(ctx,a);
  const params=captured.at(-1),b=h.tables.get('bookings').at(-1);
  assert.equal(params.mode,'payment');assert.equal(params.payment_intent_data.setup_future_usage,'off_session');
  const deposit=params.line_items.find(l=>l.price_data.product_data.name.startsWith('Refundable security deposit'));
  assert.equal(deposit.price_data.unit_amount,5000);
  assert.equal(params.line_items.reduce((sum,l)=>sum+l.price_data.unit_amount*l.quantity,0),Math.round(quote.totalDue*100));
  assert(params.custom_text.submit.message.includes('refundable £50.00 deposit'));assert(!params.custom_text.submit.message.includes('No security money'));assert(params.custom_text.submit.message.length<=500);
  assert.equal(b.depositAmount,50);assert.equal(JSON.parse(b.agreementSnapshot).version,'2026-10-v14');
  const paymentIntentId='pi-'+kind;
  const paymentReceipt=await bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:b._id,sessionId:b.stripeCheckoutSessionId,paymentIntentId,
   amountTotalPence:Math.round(quote.combinedTotalDue*100),currency:'GBP',paymentStatus:'paid'});
  assert.equal(paymentReceipt.requiresSavedCard,true);
  const saved=await checkout.checkoutSavedCard({id:b.stripeCheckoutSessionId,customer:'cus_fixture',payment_intent:paymentIntentId},new StripeFixture());
  await h.load('convex/savedCardState.ts').save.handler(ctx,{bookingId:b._id,sessionId:b.stripeCheckoutSessionId,...saved});
  const confirmation=await bookings.confirm.handler(ctx,{bookingId:b._id,paymentIntentId:'pi-'+kind});
  assert.equal(confirmation.awaitingVerification,true);assert.equal(b.status,'pending_verification');assert(h.tables.get('reservations').some(r=>r.bookingId===b._id&&r.status==='hold'));
  if(kind==='credit')assert.equal(quote.totalDue,50,'Refund credit cannot pay cash security');
  if(kind==='referral')assert.equal(quote.benefitKind,'referral_friend');
  if(kind==='voucher'){
    assert.equal(quote.benefitKind,'promo');assert.equal(b.promoCode,'db10off');
    assert.equal(b.discount,10);assert.equal(quote.membershipSignupOfferSaving??0,0);
    assert.equal(quote.weekendSaving??0,0);assert.equal(quote.loyaltySaving??0,0);assert.equal(quote.earnedCreditApplied??0,0);
    assert.equal((await promo.validate.handler(ctx,{code:'db10off',token,eligibleSubtotal:100})).valid,false,'Paid first order permanently consumes eligibility');
    await h.db.patch(b._id,{status:'cancelled'});
    assert.equal((await promo.validate.handler(ctx,{code:'db10off',token,eligibleSubtotal:100})).valid,false,'Refund/cancellation cannot restore the first-order voucher');
  }
 }
 listing.pricing={daily:22.22,day3:19.37,day7:16.09};
 const centsStart=start+30*86400000,centsEnd=centsStart,centsAccount=h.put('accounts',{email:'cents@example.invalid',emailVerifiedAt:Date.now(),stripeCustomerId:'cus_fixture'}),centsToken='token-cents';
 h.put('sessions',{token:centsToken,accountId:centsAccount._id,expiresAt:Date.now()+86400000});
 const centsArgs=structuredClone(args);centsArgs.token=centsToken;centsArgs.customer.email=centsAccount.email;centsArgs.items[0].start=centsStart;centsArgs.items[0].end=centsEnd;centsArgs.agreement.documents=legal.agreementsForSecurityPolicy(policy.REFUNDABLE_DEPOSIT_POLICY_VERSION);centsArgs.agreement.requestId='fixture-cent-checkout-001';
 const centsQuote=await checkout.priceQuote.handler(ctx,{items:centsArgs.items,token:centsToken,customerEmail:centsAccount.email,fulfilment:'pickup'});
 assert.equal(centsQuote.items[0].total,23,'Authoritative daily quote rounds fractional-pound rates up');assert.equal(centsQuote.subtotal,23);assert.equal(centsQuote.totalDue,73);
 centsArgs.expectedTotalDue=centsQuote.combinedTotalDue;centsArgs.expectedSavedCardLimit=centsQuote.savedCardLimit;
 await checkout.start.handler(ctx,centsArgs);
 const centsParams=captured.at(-1),centsBooking=h.tables.get('bookings').at(-1),rentalLine=centsParams.line_items.find(line=>line.price_data.product_data.name==='Source camera');
 assert.equal(centsBooking.lineItems[0].lineTotal,23,'Stored rental line keeps the rounded-up pound total');assert.equal(centsBooking.subtotal,23);assert.equal(centsBooking.total,73);
 assert.equal(rentalLine.price_data.unit_amount,2300,'Stripe receives the rounded-up rental line in pence');
 assert.equal(centsParams.line_items.reduce((sum,line)=>sum+line.price_data.unit_amount*line.quantity,0),7300,'Stripe line amounts reconcile to the paid quote in pence');
 assert.equal(centsParams.metadata.rentalPaidPence,'7300');
 const chargedPence=toPence(centsBooking.lineItems[0].lineTotal);
 assert.equal(toPence(chargedPence/100),chargedPence,'Pounds↔pence conversion is idempotent for a charged line');
 await h.db.patch(centsBooking._id,{status:'confirmed',paidConfirmedAt:Date.now(),stripePaymentIntentId:'pi-cent-invoice'});
 const snapshot=initialInvoiceSnapshot(centsBooking,centsBooking.guestName,centsBooking.guestEmail);
 await bookings.saveInitialInvoiceSnapshot.handler(ctx,{bookingId:centsBooking._id,snapshot});
 assert.equal(centsBooking.invoiceSnapshot.lineItems[0].lineTotal,23,'Issued invoice snapshot preserves the rounded-up rental price');
 assert.equal(centsBooking.invoiceSnapshot.total,73,'Issued invoice snapshot total reconciles exactly with Stripe');
 console.log('PASS actual new-policy quote → checkout → paid pending-verification state: plain, refund credit, paid member and referral; exact v14 acceptance, £50 cash always protected, saved-card reuse, truthful Stripe text and physical allocation. Synthetic transport/data only.');
}finally{global.fetch=realFetch}})().catch(e=>{console.error(e);process.exitCode=1});
