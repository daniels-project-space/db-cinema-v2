const assert = require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const realNow=Date.now,now=realNow();Date.now=()=>now;
const billing=load('convex/membershipBenefits.ts'),bookings=load('convex/bookings.ts'),checkout=load('convex/checkout.ts');
const {calculateRentalPrice}=load('convex/lib/rentalPrice.ts'),catalog=load('convex/catalog.ts');
const {MEMBERSHIP_TERMS_VERSION}=load('shared/membership.ts');
const {shouldResetMembershipPreference}=load('shared/membershipSelection.ts');
// Render the actual card with a signed-in account and actual handler quotes.
// Only the account context and decorative leaves are isolated for this test.
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),ts=require('typescript'),fs=require('node:fs'),path=require('node:path');
let renderingAccount=null;
const uiModule={exports:{}};
const uiCode=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/CheckoutMembership.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','module','exports',uiCode)(name=>{
 if(name==='@/lib/membership')return load('shared/membership.ts');
 if(name==='./account/AccountProvider')return {useAccount:()=>({me:renderingAccount})};
 if(name==='./SubscriptionBenefitSymbol')return {SubscriptionBenefitSymbol:()=>null};
 if(name==='next/link')return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
 return require(name);
},uiModule,uiModule.exports);
function renderQuotedHook(quote,member,variant='basket'){
 renderingAccount=member;
 return renderToStaticMarkup(React.createElement(uiModule.exports.CheckoutMembership,{variant,suggestions:quote?.recommendations,selected:null,onChange:()=>{},appliedSavings:quote}));
}
const camera=put('listings',{active:true,title:'Camera',pricing:{daily:300},depositAmount:100000,components:[]});
let account;
const ctx={db,scheduler:{runAfter:async()=>{}},runQuery:async(ref,args)=>{
 if(ref==='accounts._byEmail')return load('convex/accounts.ts')._byEmail.handler({db},args);
 if(ref==='accounts._byToken')return account;
 if(ref==='catalog.repriceLines')return catalog.repriceLines.handler({db},args);
 if(ref==='bookings.availableCheckoutCredit')return bookings.availableCheckoutCredit.handler({db},args);
 throw Error('Unexpected query '+ref);
}};
const input=()=>({items:[{listingId:camera._id,title:'Camera',start:Date.UTC(2027,0,4),end:Date.UTC(2027,0,4),qty:1,total:1,deposit:1}],token:'fixture',customerEmail:account.email,fulfilment:'pickup',protection:'verify'});
async function prepare(tier='plus') {
 const args=input(),price=await calculateRentalPrice(ctx,{...args,customer:{email:account.email},selectedMembership:{tier,intro:'none'}});
 const reservation=await billing.reserveCheckout.handler(ctx,{accountId:account._id,tier,intro:'none',requestId:'r-'+account._id,termsVersion:MEMBERSHIP_TERMS_VERSION});
 const pendingArgs={pricingVersion:price.pricingVersion,benefitKind:price.benefitKind,refundCreditApplied:price.refundCreditApplied,earnedCreditApplied:price.earnedCreditApplied,customerEmail:account.email,fulfilment:'pickup',deliveryFee:0,lineItems:price.items.map(i=>({listingId:i.listingId,title:i.title,start:i.start,end:i.end,qty:1,lineTotal:i.total})),subtotal:price.subtotal,depositAmount:price.depositAmount,discount:price.totalReduction,total:price.totalBeforeCredit,expectedTotalDue:price.totalDue,creditAccountId:account._id,membershipCheckoutId:reservation._id,membershipCreditApplied:price.membershipCreditApplied,membershipSignupOfferSaving:price.membershipSignupOfferSaving,currency:'GBP'};
 const pending=await bookings.createPending.handler(ctx,pendingArgs);
 await assert.rejects(bookings.createPending.handler(ctx,pendingArgs),/already reserved/);
 await billing.bindCheckout.handler(ctx,{id:reservation._id,sessionId:'cs-'+account._id,bookingId:pending.bookingId});
 await billing.syncSubscription.handler(ctx,{accountId:account._id,subscriptionId:'sub-'+account._id,tier,status:'active',subscriptionCreatedAt:now,cancelAtPeriodEnd:false,checkoutId:reservation._id});
 return {price,reservation,booking:await db.get(pending.bookingId)};
}
async function pay(fixture,fee=1900) {
 const args={accountId:account._id,subscriptionId:account.stripeSubscriptionId,invoiceId:'in-'+account._id,paidMembershipPence:fee,periodEnd:now+30*86400000,checkoutId:fixture.reservation._id};
 const id=await billing.grantPaidInvoice.handler(ctx,args);
 assert.equal(await billing.grantPaidInvoice.handler(ctx,args),id,'duplicate payment cannot mint credit twice');
 await assert.rejects(billing.grantPaidInvoice.handler(ctx,{...args,invoiceId:'second-'+account._id}),/already settled/);
 return {args,grant:await db.get(id),credit:await db.get((await db.get(id)).creditId)};
}
(async()=>{
 assert(!renderQuotedHook(undefined,null).includes('membership-upsell'),'Initial loading must not show an empty savings card');
 assert.equal(renderQuotedHook(undefined,null),'','No fallback membership chooser before a savings quote');
 assert.equal(renderQuotedHook(undefined,null,'checkout'),'','Checkout offers nothing before a positive authoritative quote');
 account=put('accounts',{email:'thresholds@example.invalid'});
 for(const [spend,tier] of [[99,null],[100,'plus'],[199,'plus'],[200,'pro'],[299,'pro'],[300,'studio']]) {
  camera.pricing.daily=spend;
  const quote=await checkout.priceQuote.handler(ctx,input());
  const checkoutHtml=renderQuotedHook(quote,account,'checkout');
  assert(!checkoutHtml.includes('membership-chooser'),'Checkout must never offer a manual plan chooser');
  assert(!checkoutHtml.includes('membership-plan-'),'Checkout must show one recommended plan, not plan choices');
  if (quote.recommendations.some(o=>o.netSaving>0)) {
   const offer=quote.recommendations.find(o=>o.netSaving>0);
   assert.deepEqual(quote.membershipOffer,{tier:offer.tier,netSaving:offer.netSaving,state:'join'});
   const staleUiAccount={...account,membershipActive:true,membershipTier:'studio'};
   const html=renderQuotedHook(quote,staleUiAccount);
   assert(!html.includes('membership-chooser'),'The entire booking flow uses one recommendation');
   assert(html.includes('Subscribe to save £'+offer.netSaving.toFixed(2)),'Finished server quote must keep its heading even when client account context differs');
   assert(html.includes('data-testid="add-membership"'),'Server join offer must remain selectable rather than becoming an existing-member card');
   assert(checkoutHtml.includes('Subscribe to save £'+offer.netSaving.toFixed(2)));
   assert.equal((checkoutHtml.match(/data-testid="add-membership"/g)||[]).length,1);
   assert(checkoutHtml.includes('Selecting this card confirms the'),'One-click recurring-payment consent must be visible');
   assert(checkoutHtml.includes('text-3xl'),'Checkout savings hook must be prominent');
  } else {
   assert.equal(checkoutHtml,'','No actual net saving means no checkout offer or fallback button');
  }
  assert.equal(quote.recommendations[0]?.tier??null,tier,'threshold uses rental charges, not the much larger security/hold');
  if(tier)assert.equal(quote.recommendations[0].intro,'none','weekday offer starts paid membership to use credit now');
 }
 camera.pricing.daily=300;
 account=put('accounts',{email:'renewed-studio-headline@example.invalid',membershipTier:'studio',membershipActive:true});
 const renewedCredit=put('credits',{accountId:account._id,amount:128.7,remaining:128.7,kind:'earned',createdAt:now,expiresAt:now+86400000,status:'active'});
 const renewedQuote=await checkout.priceQuote.handler(ctx,input());
 assert.equal(renewedQuote.earnedCreditApplied,128.7);
 assert.equal(renewedQuote.membershipNetSaving,128.7,'Active subscriber headline includes actual renewed credit used, not a zero discount field');
 assert.match(renderQuotedHook(renewedQuote,account),/<h3[^>]*>Subscribe to save £128\.70<\/h3>/,'Actual signed-in card must render the savings headline');
 assert.equal(renewedQuote.membershipFee,0,'Do not subtract or bill another membership month for an existing subscriber');
 await db.patch(renewedCredit._id,{remaining:10});
 const partialRenewedQuote=await checkout.priceQuote.handler(ctx,input());
 assert.equal(partialRenewedQuote.membershipNetSaving,10,'Show actual remaining credit applied, never the full monthly allowance');
 assert.match(renderQuotedHook(partialRenewedQuote,account),/<h3[^>]*>Subscribe to save £10\.00<\/h3>/);
 put('credits',{accountId:account._id,amount:280,remaining:280,kind:'refund',createdAt:now,expiresAt:now+86400000,status:'active'});
 const refundAndEarnedQuote=await checkout.priceQuote.handler(ctx,input());
 assert.equal(refundAndEarnedQuote.refundCreditApplied,280);
 assert.equal(refundAndEarnedQuote.membershipNetSaving,10,'Refund credit is payment, not subscription savings');
 assert.match(renderQuotedHook(refundAndEarnedQuote,account),/<h3[^>]*>Subscribe to save £10\.00<\/h3>/);
 await db.patch(renewedCredit._id,{remaining:0});
 const noRenewedCredit=await checkout.priceQuote.handler(ctx,input());
 assert.equal(noRenewedCredit.membershipNetSaving,0,'No applied earned credit or price benefit means no invented saving');
 assert(!renderQuotedHook(noRenewedCredit,account).includes('membership-upsell'),'No blank active-member discount card after a zero-saving quote');
 assert(!renderQuotedHook(noRenewedCredit,account).includes('Subscribe to save £'),'No fabricated saving when only refund credit remains');
 // A restored Studio choice can lose money while Starter saves money after
 // refund credits. It must not blank the profitable offer or preserve consent.
 account=put('accounts',{email:'restored-refund@example.invalid'});
 camera.pricing.daily=100;
 put('credits',{accountId:account._id,amount:80,remaining:80,kind:'refund',createdAt:now,expiresAt:now+86400000,status:'active'});
 const restoredQuote=await checkout.priceQuote.handler(ctx,{...input(),selectedMembership:{tier:'studio',intro:'none'}});
 assert.equal(restoredQuote.membershipNetSaving,-79);
 assert.equal(restoredQuote.recommendations[0].tier,'plus');
 assert.equal(restoredQuote.recommendations[0].netSaving,1);
 assert.equal(shouldResetMembershipPreference({tier:'studio',intro:'none',termsAccepted:false},restoredQuote),true);
 assert.equal(shouldResetMembershipPreference({tier:'studio',intro:'none',termsAccepted:true},restoredQuote),false,'Never replace a plan explicitly confirmed in this checkout');
 assert.equal(shouldResetMembershipPreference({tier:'studio',intro:'none',termsAccepted:false},{...restoredQuote,membershipNetSaving:1}),false,'Profitable selected plans stay selected');
 assert.equal(shouldResetMembershipPreference({tier:'studio',intro:'none',termsAccepted:false},{...restoredQuote,recommendations:[]}),false,'No substitute offer means the old plan remains manageable');
 assert.equal(shouldResetMembershipPreference(null,restoredQuote),false);
 // The reported £375 rental must deduct both credits before adding the
 // first month and refundable deposit. Authorisation is never a charge.
 account=put('accounts',{email:'reported-checkout-total@example.invalid'});
 camera.pricing.daily=375;camera.depositAmount=1620;
 const reportedBase=await checkout.priceQuote.handler(ctx,input());
 const reportedSelected=await checkout.priceQuote.handler(ctx,{...input(),selectedMembership:{tier:'studio',intro:'none'}});
 assert.equal(reportedBase.combinedTotalDue,415.5);
 assert.equal(reportedSelected.membershipSignupOfferSaving,10);
 assert.equal(reportedSelected.membershipCreditApplied,128.7);
 assert.equal(reportedSelected.totalDue-reportedSelected.depositAmount,236.3);
 assert.equal(reportedSelected.membershipFee,99);
 assert.equal(reportedSelected.depositAmount,40.5);
 assert.equal(reportedSelected.depositHoldAmount,162);
 assert.equal(reportedSelected.combinedTotalDue,375.8);
 assert.equal(Math.round((reportedBase.combinedTotalDue-reportedSelected.combinedTotalDue)*100)/100,39.7);
 camera.depositAmount=100000;
 // Regression for the real five-line £1,905 basket: a retired £45 gear
 // offer must no longer suppress the actual £39.70 Studio net saving.
 account=put('accounts',{email:'retired-gear-offer@example.invalid'});
 camera.pricing.daily=1625;camera.itemType='camera-body';
 const extras=[['Tripod',90,'tripod'],['Filter',50,'nd-filter'],['Monitor',80,'monitor'],['Light',60,'light']]
   .map(([title,daily,itemType])=>put('listings',{active:true,title,pricing:{daily},itemType,depositAmount:1000,components:[]}));
 const restoredBasket={...input(),items:[...input().items,...extras.map(l=>({listingId:l._id,title:l.title,start:Date.UTC(2027,0,4),end:Date.UTC(2027,0,4),qty:1,total:l.itemType==='tripod'?45:l.pricing.daily,deposit:1,...(l.itemType==='tripod'?{offerType:'tripod50'}:{})}))]};
 assert.deepEqual(await load('convex/offers.ts').forCart.handler(ctx,{items:restoredBasket.items}),[],'No retired gear discounts may be advertised');
 const retiredBase=await checkout.priceQuote.handler(ctx,restoredBasket);
 assert.equal(retiredBase.subtotal,1905);
 assert.equal(retiredBase.items[1].total,90,'Saved discounted client prices and offer markers cannot revive a retired offer');
 assert.equal(retiredBase.benefitKind,'none');assert.equal(retiredBase.totalReduction,0);
 assert.deepEqual(retiredBase.membershipOffer,{tier:'studio',netSaving:39.7,state:'join'});
 for(const variant of ['basket','drawer','checkout'])assert.match(renderQuotedHook(retiredBase,account,variant),/<h3[^>]*>Subscribe to save £39\.70<\/h3>/);
 const retiredSelected=await checkout.priceQuote.handler(ctx,{...restoredBasket,selectedMembership:{tier:'studio',intro:'none'}});
 assert.equal(retiredSelected.membershipCreditApplied,128.7);assert.equal(retiredSelected.membershipSignupOfferSaving,10);
 assert.equal(retiredSelected.combinedTotalDue-retiredSelected.depositAmount,1865.3,'Savings includes the £99 subscription fee and excludes security');
 extras[0].quietDeal=50;
 const competingQuiet=await checkout.priceQuote.handler(ctx,restoredBasket);
 assert.equal(competingQuiet.benefitKind,'quiet');assert.equal(competingQuiet.totalReduction,45);
 assert.equal(competingQuiet.membershipOffer,null,'Keep no stacking: a genuine larger remaining price benefit still wins');
 assert.equal(competingQuiet.recommendations.find(r=>r.tier==='studio').netSaving,-5.3);
 assert.equal(renderQuotedHook(competingQuiet,account),'','Never invent a positive savings card for a more expensive subscription');
 extras[0].quietDeal=undefined;
 account=put('accounts',{email:'large@example.invalid'});camera.pricing.daily=300;
 const large=await checkout.priceQuote.handler(ctx,input());assert.equal(large.recommendations[0].netSaving,39.7);
 camera.pricing.daily=100;account=put('accounts',{email:'starter-immediate@example.invalid'});
 const f=await prepare();assert.equal(f.price.membershipCreditApplied,20.9);assert.equal(f.price.membershipSignupOfferSaving,5);assert.equal(f.price.combinedTotalDue,f.price.depositAmount+93.1);
 assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),0,'unpaid credit is unavailable to other rentals');
 await assert.rejects(bookings.confirm.handler(ctx,{bookingId:f.booking._id}),/has not settled/);
 assert(f.price.depositAmount>0,"first checkout retains upfront security");const receipt=await pay(f);assert.equal(account.membershipPerksPendingBookingId,f.booking._id);assert.equal(load("shared/membership.ts").paidDepositExempt(account),false);assert.equal(receipt.credit.remaining,0);assert.equal(!!account.membershipSignupOfferUsed,true);
 await bookings.confirm.handler(ctx,{bookingId:f.booking._id,paymentIntentId:'pi-fixture'});
 await bookings.confirm.handler(ctx,{bookingId:f.booking._id,paymentIntentId:'pi-fixture'});
 assert.equal(receipt.credit.remaining,0,'confirm does not spend first-month credit twice');assert.equal(account.membershipPerksPendingBookingId,undefined);assert.equal(load('shared/membership.ts').paidDepositExempt(account),true);
 const mail=[];setMock('./lib/mailer',{sendMail:async m=>{mail.push(m);return true}});
 await load('convex/invoice.ts').invoiceEmail.handler({runQuery:async(ref,args)=>{assert.equal(ref,'bookings.receiptContext');return bookings.receiptContext.handler(ctx,args)}},{bookingId:f.booking._id});
 assert(mail[0].html.includes('First-month membership credit used on this rental: £20.90'),'receipt email reads the real internal credit breakdown');
 await billing.grantPaidInvoice.handler(ctx,{...receipt.args,checkoutId:undefined,invoiceId:'renewal-'+account._id});
 assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),20.9,'renewal grants full monthly credit');
 await bookings._finalizeCancellation.handler(ctx,{bookingId:f.booking._id,accountId:account._id,mode:'refund',refundAmount:f.booking.total,creditAmount:f.booking.creditApplied,currency:'GBP'});
 await bookings._finalizeCancellation.handler(ctx,{bookingId:f.booking._id,accountId:account._id,mode:'refund',refundAmount:f.booking.total,creditAmount:f.booking.creditApplied,currency:'GBP'});
 assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),41.8,'cancel restores used credit exactly once');
 await billing.revokeRefundedInvoice.handler(ctx,{invoiceId:receipt.args.invoiceId,membershipRefundedPence:1900});
 assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),20.9,'membership refund revokes restored first-month credit but preserves renewal credit');
 account=put('accounts',{email:'reverse-before-cancel@example.invalid'});const second=await prepare();const paid=await pay(second);await bookings.confirm.handler(ctx,{bookingId:second.booking._id});
 await billing.revokeRefundedInvoice.handler(ctx,{invoiceId:paid.args.invoiceId,membershipRefundedPence:1900});assert.equal(account.membershipCreditDebtPence,2090);
 await bookings._finalizeCancellation.handler(ctx,{bookingId:second.booking._id,accountId:account._id,mode:'refund',refundAmount:second.booking.total,creditAmount:second.booking.creditApplied,currency:'GBP'});
 assert.equal(account.membershipCreditDebtPence,0);assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),0,'restoration clears the reversal offset without gifting new credit');
 account.membershipActive=false;account.membershipStatus='canceled';const rejoin=await calculateRentalPrice(ctx,{...input(),customer:{email:account.email},selectedMembership:{tier:'plus',intro:'none'}});assert.equal(rejoin.membershipSignupOfferSaving,0,'Starter cannot repeat its £5 joining discount');
 camera.pricing.daily=300;const starterUpgrade=await calculateRentalPrice(ctx,{...input(),customer:{email:account.email},selectedMembership:{tier:'studio',intro:'none'}});assert.equal(starterUpgrade.membershipSignupOfferSaving,0,'Starter joining discount blocks another Studio joining discount');
 account=put('accounts',{email:'pro-welcome@example.invalid'});camera.pricing.daily=200;const welcome=await prepare('pro');assert.equal(welcome.price.membershipSignupOfferSaving,10);assert.equal(welcome.price.combinedTotalDue,welcome.price.depositAmount+180.2);await pay(welcome,4900);assert.equal(!!account.membershipSignupOfferUsed,true);account.membershipActive=false;account.membershipStatus='canceled';camera.pricing.daily=300;const upgrade=await calculateRentalPrice(ctx,{...input(),customer:{email:account.email},selectedMembership:{tier:'studio',intro:'none'}});assert.equal(upgrade.membershipSignupOfferSaving,0,'switching/rejoining Studio cannot repeat the Pro signup discount');
 account=put('accounts',{email:'weekend-signup@example.invalid'});camera.pricing.daily=300;const weekendInput=input();weekendInput.items[0].start=Date.UTC(2027,0,8);weekendInput.items[0].end=Date.UTC(2027,0,9);const weekend=await calculateRentalPrice(ctx,{...weekendInput,customer:{email:account.email},selectedMembership:{tier:'pro',intro:'none'}});assert.equal(weekend.weekendSaving,0,'checkout-added membership has no weekend perk on its first rental');assert.equal(weekend.membershipSignupOfferSaving,10);assert(weekend.depositAmount>0);assert.equal(weekend.deliveryReduction,0);
 account=put('accounts',{email:'unused-credit@example.invalid'});camera.pricing.daily=50;const partial=await prepare('pro');const partialReceipt=await pay(partial,4900);assert.equal(partial.price.membershipCreditApplied,50);assert.equal(partialReceipt.credit.remaining,8.8,'unused first-month credit survives');
 await bookings.confirm.handler(ctx,{bookingId:partial.booking._id});
 await billing.revokeRefundedInvoice.handler(ctx,{invoiceId:partialReceipt.args.invoiceId,membershipRefundedPence:2450});
 await bookings._finalizeCancellation.handler(ctx,{bookingId:partial.booking._id,accountId:account._id,mode:'refund',refundAmount:0,creditAmount:partial.booking.creditApplied,currency:'GBP'});
 assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),29.4);
 await billing.revokeRefundedInvoice.handler(ctx,{invoiceId:partialReceipt.args.invoiceId,membershipRefundedPence:4900});
 assert.equal(await bookings.availableCheckoutCredit.handler({db},{accountId:account._id}),0,'remaining restored credit stays linked after a partial membership reversal');assert.equal(account.membershipCreditDebtPence,0);
 account=put('accounts',{email:'existing-credit@example.invalid'});camera.pricing.daily=300;put('credits',{accountId:account._id,amount:300,remaining:300,createdAt:now-1000,expiresAt:now+86400000,status:'active'});
 const covered=await checkout.priceQuote.handler(ctx,input());assert(covered.recommendations.every(r=>r.netSaving<=0),'already-credit-covered order does not claim a new saving');
 const trial=await calculateRentalPrice(ctx,{...input(),customer:{email:account.email},selectedMembership:{tier:'plus',intro:'trial'}});assert.equal(trial.membershipCreditApplied,0);assert.equal(trial.membershipSignupOfferSaving,0);assert(trial.depositAmount>0);
 account=put('accounts',{email:'debt-before-payment@example.invalid'});camera.pricing.daily=100;const reserved=await prepare();account.membershipCreditDebtPence=600;await pay(reserved);assert.equal(account.membershipCreditDebtPence,600,'a later reversal cannot steal credit promised to an open checkout');
 account=put('accounts',{email:'actual-welcome@example.invalid',membershipCreditDebtPence:2090});camera.pricing.daily=100;const joined=await prepare();assert.equal(joined.price.benefitKind,'joining');assert.equal(joined.price.membershipSignupOfferSaving,5);assert.equal(joined.price.membershipCreditApplied,0);await pay(joined);assert.equal(account.membershipSignupOfferUsed,true,'a chosen joining discount is recorded once');
 account=put('accounts',{email:'unpaid-cancel@example.invalid'});const abandoned=await prepare();await db.patch(abandoned.booking._id,{status:'cancelled'});const late=await pay(abandoned);assert.equal(late.credit.remaining,20.9,'a late paid invoice does not consume credit for an already-closed rental');
 console.log('PASS same-checkout membership credit: charge-only thresholds, net fees, one-time £5/£10 joining offers, no unpaid/double spending, capped/unused credit, renewals, restoration and refund ordering.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=realNow});
