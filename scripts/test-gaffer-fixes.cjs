/** Behavioural regression checks. No network, bookings, emails or payments. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(root, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const req = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) {
      let target = path.resolve(root, "src", name.slice(2));
      if (!path.extname(target)) target += fs.existsSync(target + ".ts") ? ".ts" : fs.existsSync(target + ".tsx") ? ".tsx" : ".js";
      if (target.endsWith(".ts") || target.endsWith(".tsx")) return load(target, mocks, globals);
      return require(target);
    }
    if (name.startsWith('.')) {
      let target = path.resolve(path.dirname(filename), name);
      if (!path.extname(target)) target += fs.existsSync(target + '.ts') ? '.ts' : '.js';
      if (target.endsWith('.ts')) return load(target, mocks, globals);
      return require(target);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)(req, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const registered = { query: x => x, mutation: x => x, internalQuery: x => x, internalMutation: x => x, action: x => x, internalAction: x => x };
const refs = new Proxy({}, { get: (_, group) => new Proxy({}, { get: (_, name) => `${String(group)}:${String(name)}` }) });
const { PROMPT: GAFFER_VOICE_AGENT_PROMPT } = require('./gaffer-system-prompt');
assert.match(GAFFER_VOICE_AGENT_PROMPT, /# DECIDE, THEN SPEAK[\s\S]*one concise, complete answer/i);
assert.match(GAFFER_VOICE_AGENT_PROMPT, /Never begin one answer and replace it halfway through/i);
// These values satisfy the checkout activation boundary; no provider call is made.
Object.assign(process.env, {
  // Let checkout tests reach the behavior under test using synthetic stock
  // authority. No provider request is made by these fixtures.
  SHARED_STOCK_AUTHORITY_READY: 'enabled', SHARED_STOCK_BRIDGE_EXPERIMENTAL: 'true',
  SHARED_STOCK_WEBSITE_SECRET: 'fixture-stock-authority-secret-12345678901234567890',
  RMV2_WEBHOOK_URL: 'https://fixture-manager.convex.site/dbcinema/booking-sync', RMV2_WEBHOOK_SECRET: 'fixture-private-read',
  RENTAL_CHECKOUT_ENABLED: 'true', DIDIT_API_KEY: 'test', DIDIT_WORKFLOW_ID: 'test', DIDIT_WEBHOOK_SECRET: 'test', DIDIT_APPLICATION_ID: 'test', DIDIT_ENVIRONMENT: 'sandbox',
  STRIPE_WEBHOOK_SECRET: 'test', STRIPE_SECRET_KEY: 'test', STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID: 'test',
  INVOICE_SECRET: 'test', APP_URL: 'https://example.invalid', BUSINESS_LEGAL_NAME: 'Test supplier',
  BUSINESS_INVOICE_ADDRESS: 'Test address', RESEND_API_KEY: 'test', RESEND_FROM: 'DB Cinema Rentals <bookings@dbcinemarentals.com>',
});
class StripeStub {
  static lastCheckout;
  customers = {retrieve:async id=>({id,deleted:false,metadata:{}})};
  paymentMethodConfigurations = { retrieve: async () => ({ active: true, card: { display_preference: { value: 'on' } }, apple_pay: { display_preference: { value: 'off' } }, google_pay: { display_preference: { value: 'off' } }, link: { display_preference: { value: 'off' } } }) };
  checkout = { sessions: { create: async (params) => { StripeStub.lastCheckout=params; return {id:'cs_test_booking',url:'https://checkout.stripe.test/session'}; } } };
}
const serverMocks = { './_generated/server': registered, './_generated/api': { api: refs, internal: refs }, '../_generated/api': { api: refs, internal: refs }, './adminAuth': {}, stripe: StripeStub };
const { validate } = load('convex/promo.ts', serverMocks);
// This suite exercises the checkout pricing and Gaffer offer path after the
// release-readiness boundary. The dedicated checkout-readiness test verifies
// that the current false production flag blocks before any side effects.
const { start, priceQuote } = load('convex/checkout.ts', {
  ...serverMocks,
  '../shared/legalDocuments': { RENTAL_DRAFT_RELEASE_READY: true },
  '../shared/rentalAgreementRelease': { RENTAL_DRAFT_RELEASE_READY: true },
});
const { createPending } = load('convex/bookings.ts', serverMocks);
const { AGREEMENTS } = load('src/lib/legal.ts');
const { gafferDiscount } = load('convex/lib/gafferDiscount.ts');
const { asksForBetterPrice } = load('src/components/gaffer/priceRequest.ts');
const { createCallMemory } = load('src/components/gaffer/callMemory.ts');

(async () => {
  for (const [subtotal, eligible, expected] of [[400.00000000001,400,0],[399,399,0],[400,400,0],[400.01,400.01,40],[550,500,50],[450,390,39],[500,0,0],[NaN,500,0],[500,NaN,0],[412.55,412.55,41.26]]) {
    assert.equal(gafferDiscount(subtotal, eligible), expected);
  }
  for (const phrase of ['Can you do a better price?', 'Could you make it cheaper?', 'Any discount?', 'Can you knock something off?', 'What is your best price?']) assert.ok(asksForBetterPrice(phrase), phrase);
  for (const phrase of ['How much is it?', 'My budget is £500', 'Show me cameras', 'No discount please', "I don’t want a better price"]) assert.equal(asksForBetterPrice(phrase), false, phrase);
  assert.equal((await validate.handler({}, {code:'GAFFER10', eligibleSubtotal:390, rentalSubtotal:450})).discount,39);
  assert.equal((await validate.handler({}, {code:'gaffer10', eligibleSubtotal:500})).valid,false);

  // Exercise the real checkout action up to createPending. Repricing is supplied by
  // the authoritative query boundary; reject before any booking/Stripe side effect.
  async function checkout(prices, {code, submittedTotal=99999, deliveryFee=0, quotedFee=0, fulfilment='pickup', address, deliveryPostcode, qty=1, submittedTitle, token, customerEmail='test@example.invalid', availableCredit=0, expectedTotalOverride, expectedError} = {}) {
    let pending;
    const stop = new Error('captured booking boundary');
    const ctx = {
      runQuery: async (ref,args) => {
        if(ref==='bookings:checkoutAttempt') return null;
        if(ref==='settings:get') return {acceptingOrders:true};
        if(ref==='catalog:repriceLines') return prices.map((total,i)=>({title:`Real item ${i}`,total,deposit:1000}));
        if(ref==='availability:forCart') return Object.fromEntries(args.items.map(i=>[i.listingId,{available:10,ok:true}]));
        if(ref==='accounts:_byToken') return {_id:'acct-1',email:'owner@example.invalid',stripeCustomerId:'cus_fixture',membershipActive:false};
        if(ref==='accounts:_byEmail') return args.email==='owner@example.invalid'?{_id:'acct-1',email:args.email,stripeCustomerId:'cus_fixture',membershipActive:false}:null;
        if(ref==='bookings:availableCheckoutCredit') return args.kind==='refund'?0:availableCredit;
        if(ref==='repeatRentals:candidate') return null;
        if(ref==='promo:validate') return validate.handler({},args);
        throw Error(`Unexpected query ${ref}`);
      },
      runAction: async (ref,args) => { if(ref==='sync:syncHyggloReservations')return {mirrored:0,rows:0,checkedAt:123}; assert.equal(ref,'delivery:quote'); assert.equal(args.postcode,deliveryPostcode.replace(/\s/g,'').toUpperCase()); assert.equal(args.groups.flatMap(group=>group.listingIds).length,prices.length); return {ok:true,fee:quotedFee,oneWay:quotedFee/2,vehicle:'car',vehicleLabel:'Small car courier',km:1,load:1,isLondon:true,groups:args.groups.map(group=>({...group,fee:quotedFee,oneWay:quotedFee/2,vehicle:'car',vehicleLabel:'Small car courier',km:1,load:1}))}; },
      runMutation: async (ref,args) => { assert.equal(ref,'bookings:createPending'); pending=args; throw stop; },
    };
    const args={expectedSavedCardLimit:prices.length*100*qty,items:prices.map((_,i)=>({listingId:`listing${i}`,title:submittedTitle??`Item ${i}`,start:0,end:0,qty,total:submittedTotal,deposit:0,...(i?{offerType:'tripod50'}:{})})),token,customer:{email:customerEmail,name:'Test Renter',billingAddress:'123 Test Street, London'},fulfilment,address,deliveryPostcode,deliveryFee,promoCode:code,pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Test Renter',requestId:'test-acceptance-attempt-0001',securityHoldConsent:true,laterChargeConsent:true,deliveryAccepted:fulfilment==='delivery',documents:fulfilment==='delivery'?[...AGREEMENTS,{kind:'delivery-disclaimer',version:'2026-10-delivery-v2'}]:AGREEMENTS}};
    if (!expectedError || expectedTotalOverride !== undefined) {
      const quote = await priceQuote.handler(ctx,{items:args.items,token,customerEmail,fulfilment,address,deliveryPostcode,promoCode:code});
      args.expectedTotalDue = expectedTotalOverride ?? quote.totalDue;args.expectedSavedCardLimit=quote.savedCardLimit;
    }
    if (expectedError) {
      await assert.rejects(start.handler(ctx,args),expectedError);
      assert.equal(pending,undefined,'rejected before creating a booking');
      return;
    }
    await assert.rejects(start.handler(ctx,args),e=>e===stop);
    return pending;
  }
  let order=await checkout([500,50],{submittedTitle:'Forged title'}); assert.equal(order.discount,0,'never automatic'); assert.equal(order.lineItems[0].title,'Real item 0','booking title comes from catalog');
  order=await checkout([500,50],{code:'gaffer10',submittedTotal:1}); assert.equal(order.subtotal,550);assert.equal(order.discount,55);assert.equal(order.lineItems[1].lineTotal,50);
  order=await checkout([390,60],{code:'gaffer10'});assert.equal(order.discount,45,'retired offer markers do not exclude ordinary-priced gear from a promo');
  order=await checkout([400],{code:'gaffer10',deliveryFee:200});assert.equal(order.discount,0,'delivery/deposit do not qualify order');
  order=await checkout([401],{code:'gaffer10'});assert.equal(order.discount,40.1);
  order=await checkout([350],{code:'gaffer10'});assert.equal(order.discount,0,'discount is removed after basket shrinks');
  order=await checkout([400],{fulfilment:'delivery',address:'10 Downing Street, London SW1A 2AA',deliveryPostcode:'SW1A 2AA',deliveryFee:75,quotedFee:75});assert.equal(order.deliveryFee,75,'delivery fee comes from server quote');
  await checkout([400],{fulfilment:'delivery',address:'10 Downing Street, London SW1A 2AA',deliveryPostcode:'SW1A 2AA',deliveryFee:0,quotedFee:75,expectedError:/delivery quote has changed/});
  await checkout([400],{fulfilment:'delivery',address:'10 Downing Street, London SW1A 2AA',deliveryPostcode:'SW1A 1AA',deliveryFee:75,quotedFee:75,expectedError:/same postcode/});
  await checkout([400],{qty:2,expectedError:/one item with valid dates/});
  await checkout([400],{token:'signed-in-session',customerEmail:'other@example.invalid',expectedError:/signed-in account email/});
  order=await checkout([400],{customerEmail:'TEST@EXAMPLE.INVALID'});assert.equal(order.customerEmail,'test@example.invalid');
  order=await checkout([400],{token:'signed-in-session',customerEmail:'owner@example.invalid',availableCredit:30});
  assert.equal(order.expectedTotalDue,370,'the quoted total applies credit without any refundable security charge');
  await checkout([400],{expectedTotalOverride:1,expectedError:/rental total has changed/});

  // A second checkout can reserve account credit after the preview. The booking
  // transaction must reject the now-different card total before it inserts a row.
  let inserted = false;
  const raceDb = {
    get: async id => id === 'acct-1' ? {email:'owner@example.invalid'} : null,
    query: table => ({withIndex: () => ({
      first: async () => table === 'customers' ? {_id:'customer-1',email:'owner@example.invalid'} : null,
      collect: async () => table === 'credits'
        ? [{status:'active',expiresAt:Date.now()+60000,remaining:20}]
        : [],
    })}),
    insert: async () => { inserted=true; throw Error('should not insert'); },
  };
  await assert.rejects(createPending.handler({db:raceDb},{
    customerEmail:'owner@example.invalid',fulfilment:'pickup',deliveryFee:0,
    lineItems:[],subtotal:200,depositAmount:25,total:225,expectedTotalDue:200,expectedSavedCardLimit:100,
    creditAccountId:'acct-1',currency:'GBP',
  }),/available credit changed/);
  assert.equal(inserted,false);

  // Cross the real booking and Stripe boundaries with inert adapters: verify the
  // payment amount and return URLs cannot be supplied by the browser.
  let savedBooking;
  const checkoutCtx = {
    runAction:async(ref)=>{assert.equal(ref,'sync:syncHyggloReservations');return {mirrored:0,rows:0,checkedAt:123};},
    runQuery: async (ref,args) => {
      if(ref==='accounts:_byEmail') return null; // Guest fixture has no stored account.
      if(ref==='bookings:checkoutAttempt') return null;
        if(ref==='settings:get') return {acceptingOrders:true};
      if(ref==='catalog:repriceLines') return [{title:'Real camera',total:200,deposit:1000,dailyRate:40}];
      if(ref==='availability:forCart') return Object.fromEntries(args.items.map(i=>[i.listingId,{available:1,ok:true}]));
      throw Error(`Unexpected query ${ref}`);
    },
    runMutation: async (ref,args) => {
      if(ref==='bookings:createPending'){savedBooking=args;return {bookingId:'booking-1',creditApplied:0};}
      if(ref==='bookings:placeHolds'||ref==='bookings:bindCheckoutSession')return;
      throw Error(`Unexpected mutation ${ref}`);
    },
  };
  const checkoutResult=await start.handler(checkoutCtx,{
    items:[{listingId:'camera-1',title:'Forged camera',start:0,end:0,qty:1,total:1,deposit:0}],
    customer:{email:'test@example.invalid',name:'Test Renter',billingAddress:'123 Test Street, London'},
    fulfilment:'pickup',deliveryFee:0,expectedTotalDue:200,expectedSavedCardLimit:100,pickupTime:'10:00',returnTime:'18:00',
    agreement:{name:'Test Renter',requestId:'test-acceptance-attempt-0001',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS},
    origin:'https://attacker.invalid',
  });
  assert.equal(checkoutResult.url,'https://checkout.stripe.test/session');
  assert.equal(savedBooking.lineItems[0].title,'Real camera');
  assert.equal(savedBooking.depositHoldAmount,0);
  assert.equal(savedBooking.depositAmount,0);
  assert.equal(StripeStub.lastCheckout.line_items[0].price_data.unit_amount,20000);
  assert.equal(StripeStub.lastCheckout.line_items.length,1,'Only the rental is charged; no security line');assert.equal(StripeStub.lastCheckout.payment_intent_data.setup_future_usage,'off_session');
  assert.equal(StripeStub.lastCheckout.success_url,'https://example.invalid/checkout/success?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(StripeStub.lastCheckout.cancel_url,'https://example.invalid/cart');
  const ordinaryQuery=checkoutCtx.runQuery;
  checkoutCtx.runQuery=async(ref,args)=>ref==='promo:validate'?{valid:true,discount:10,code:'TEN'}:ordinaryQuery(ref,args);
  await start.handler(checkoutCtx,{items:[{listingId:'camera-1',title:'Camera',start:0,end:0,qty:1,total:1,deposit:0}],customer:{email:'test@example.invalid',name:'Test Renter',billingAddress:'123 Test Street, London'},fulfilment:'pickup',deliveryFee:0,expectedTotalDue:190,expectedSavedCardLimit:100,promoCode:'TEN',pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Test Renter',requestId:'test-acceptance-attempt-0001',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS}});
  assert.equal(StripeStub.lastCheckout.line_items[0].price_data.unit_amount,19000,'nonmember discount reduces rental only');
  assert.equal(StripeStub.lastCheckout.line_items.length,1,'Nonmembers and referrals also pay no upfront security');
  assert.equal(StripeStub.lastCheckout.discounts,undefined,'no global coupon may discount security');

  // An inventory rejection happens before Stripe creation. Exercise the real
  // pending-order cleanup instead of leaving reserved credits until cron.
  const stockHarness=require('./lib/rentalTestHarness.cjs');
  const stockBookings=stockHarness.load('convex/bookings.ts');
  const failedStockBooking=stockHarness.put('bookings',{status:'pending_payment',guestEmail:'test@example.invalid',lineItems:[],creditApplied:10});
  const priorCheckout=StripeStub.lastCheckout,stockCalls=[];
  await assert.rejects(()=>start.handler({...checkoutCtx,runMutation:async(ref,args)=>{
    stockCalls.push({ref,args});
    if(ref==='bookings:createPending')return {bookingId:failedStockBooking._id,creditApplied:0};
    if(ref==='bookings:placeHolds')throw Error('Physical equipment is already reserved');
    if(ref==='bookings:expireUnpaidPending')return stockBookings.expireUnpaidPending.handler({db:stockHarness.db},args);
    throw Error('Unexpected stock-rejection mutation '+ref);
  }},{items:[{listingId:'camera-1',title:'Camera',start:0,end:0,qty:1,total:1,deposit:0}],customer:{email:'test@example.invalid',name:'Test Renter',billingAddress:'123 Test Street, London'},fulfilment:'pickup',deliveryFee:0,expectedTotalDue:200,expectedSavedCardLimit:100,pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Test Renter',requestId:'test-stock-rejection-attempt-0001',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS}}),error=>{assert.equal(error.data.code,'CHECKOUT_STOCK_REJECTED');assert.equal(error.data.freshAcceptanceRequired,true);assert.match(error.data.message,/already reserved/);return true;});
  assert.equal(StripeStub.lastCheckout,priorCheckout,'Stock rejection cannot create a payment session');
  assert.equal(failedStockBooking.status,'cancelled','Actual cleanup releases the unbound pending order/credit reservation');
  assert.deepEqual(stockCalls.map(c=>c.ref),['bookings:createPending','bookings:placeHolds','bookings:expireUnpaidPending']);


  const memory=createCallMemory();
  memory.add('user','My name is Alex. I need the FX3 next Friday.');
  memory.add('tool','Added FX3; dates confirmed; enquiry saved.');
  memory.add('user','Could you do a better price?');
  assert.match(memory.context(),/Alex/);assert.match(memory.context(),/enquiry saved/);assert.match(memory.context(),/do not repeat completed basket changes/);
  memory.clear();assert.equal(memory.context(),'');
  const toolActions=[],toolRoutes=[],toolAvailabilityRequests=[];
  let quotedSameDayFee=0;
  let toolAvailabilityResponse={unavailable:{ok:false,available:0}};
  const cart={items:[],switchItem(key,item){this.items=this.items.map(i=>i.key===key?{...item,key}:i);},has(id){return this.items.some(item=>item.listingId===id);},add(item){this.items.push({...item,key:`line-${this.items.length+1}`});this.count=this.items.length;},remove(key){this.items=this.items.filter(item=>item.key!==key);this.count=this.items.length;},count:0,subtotal:550,eligibleSubtotal:500,depositTotal:50,promo:null,close(){},open(){},setPromo(code){this.promo=code;}};
  const {useGafferTools}=load('src/components/gaffer/useGafferTools.ts',{
    react:{useRef:current=>({current}),useState:initial=>[initial,()=>{}],useCallback:f=>f,useMemo:f=>f(),useEffect:()=>{}},
    'next/navigation':{useRouter:()=>({push(route){toolRoutes.push(route);}})},'convex/react':{useQuery:()=>[],useConvex:()=>({action:async(ref,args)=>{toolActions.push({ref,args});if(ref==='checkout:priceQuote'){const items=args.items.map(item=>({...item,total:item.listingId==='fx3'?47:100}));return{items,subtotal:items.reduce((sum,item)=>sum+item.total,0),totalReduction:0,sameDayFee:quotedSameDayFee};}return ref==='checkoutCarts:email'?{url:'https://example.invalid/cart/quote/opaque',shareKey:args.shareKey??'opaque'}:{challenge:'challenge'};},query:async(ref,args)=>{
      if(ref==='voiceCatalog:search')return {matches:[{id:'fx3',title:'Sony FX3',slug:'sony-fx3',daily:47,pricing:{daily:47},category:'Cameras',heroImage:'https://example.invalid/fx3.jpg',deposit:50}]};
      if(ref==='availability:forListing')return {available:1};
      if(ref==='availability:forCart'){toolAvailabilityRequests.push(args);return toolAvailabilityResponse;}
      if(ref==='cartReplacements:forCart')return {status:'ready',results:{source:[{listingId:'fx3',title:'Sony FX3',slug:'fx3',total:100,perDay:50,days:2,deposit:3200,heroImage:null}]}};
      return args.code==='better15'?{valid:true,discount:75}:validate.handler({},args);
    }})},
    '@cvx/_generated/api':{api:refs},'@cvx/lib/gafferDiscount':{GAFFER_PRICE_CODE:'gaffer10'},
    '@/components/account/useCreditBalance':{useCreditBalance:()=>undefined},
    '@/components/gaffer/cartSnapshot':load('src/components/gaffer/cartSnapshot.ts'),
    '@/components/cart/CartProvider':{useCart:()=>cart},'@/components/account/AccountProvider':{useAccount:()=>({})},
    '@/lib/pricing':{quote:(pricing,days)=>({total:pricing.daily*days})},'@/lib/voiceDates':{londonToday:()=> '2026-09-13',resolveDate:value=>({ok:true,date:/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'2026-09-14'}),inclusiveDays:()=>1},'@/lib/dates':{dayMs:()=>0},
    '@/components/gaffer/GafferFocus':{useGafferFocus:()=>({focusedId:null,suggestedIds:[],focus:()=>{},suggest:async()=>false}),scrollToId:async()=>false},
  });
  const priceTool=useGafferTools();
  priceTool.noteCustomerMessage('My budget is £550');
  assert.match(await priceTool.clientTools.request_better_price(),/has not asked/);assert.equal(cart.promo,null);
  priceTool.noteCustomerMessage('Can you do a better price?');
  assert.match(await priceTool.clientTools.request_better_price(),/saving £50, rental total £500/);assert.equal(cart.promo,'gaffer10');
  cart.promo='better15';assert.match(await priceTool.clientTools.request_better_price(),/kept the better price/);assert.equal(cart.promo,'better15');
  priceTool.resetPriceRequest();assert.match(await priceTool.clientTools.request_better_price(),/has not asked/);

  for (const destination of ['gear','Lighting','sony fx3']) {
    assert.match(await priceTool.clientTools.navigate_to({destination}),/not finished loading on screen/);
  }
  const delayedBrowse=await priceTool.clientTools.browse_for({item:'Sony FX3'});
  assert.match(delayedBrowse,/not finished loading on screen/);assert.doesNotMatch(delayedBrowse,/On screen now/);assert.match(delayedBrowse,/Exact times are selected at checkout/);

  toolAvailabilityResponse={fx3:{ok:true,available:1}};
  assert.match(await priceTool.clientTools.find_gear({item:'Sony FX3',start:'2026-12-07',end:'2026-12-09'}),/free for those dates; final stock is rechecked at checkout/,'Gaffer can answer date-level gear availability without requesting exact times');
  const addedWithoutTimes=await priceTool.clientTools.add_to_basket({item:'Sony FX3',start:'2026-12-07',end:'2026-12-09'});
  assert.match(addedWithoutTimes,/Exact pickup and return times are selected at checkout/);
  assert.equal(cart.items.at(-1).pickupTime,undefined,'Adding a catalogue item never asks for or assigns exact pickup time');
  assert.equal(cart.items.at(-1).returnTime,undefined,'Adding a catalogue item never asks for or assigns exact return time');
  assert.equal(toolAvailabilityRequests.at(-1).items.at(-1).pickupTime,undefined,'Pre-check uses the chosen dates, not a fabricated pickup time');
  assert.equal(toolAvailabilityRequests.at(-1).items.at(-1).returnTime,undefined,'Pre-check uses the chosen dates, not a fabricated return time');

  cart.items=[];cart.count=0;quotedSameDayFee=10.25;
  const sameDayGafferQuote=await priceTool.clientTools.add_to_basket({item:'Sony FX3',start:'2026-09-13',end:'2026-09-13'});
  assert.match(sameDayGafferQuote,/complete basket rental subtotal .*£57\.25, including a £10\.25 same-day booking fee/,'Gaffer includes the authoritative same-day fee once in its spoken rental subtotal and discloses it separately');
  assert.equal(toolActions.filter(action=>action.ref==='checkout:priceQuote').at(-1).args.items.at(-1).start,0,'The same-day Gaffer quote uses the normal authoritative checkout quote path');
  assert.equal(cart.items.at(-1).total,47,'The fee stays a separate quote charge and is not duplicated into the cart line');
  quotedSameDayFee=0;

  cart.items=[{key:'source',listingId:'unavailable',title:'Unavailable Camera',slug:'unavailable',start:'2026-12-07',end:'2026-12-09',days:3,total:300}];cart.count=1;
  toolAvailabilityResponse={unavailable:{ok:false,available:0}};
  assert.match(await priceTool.clientTools.check_basket(),/Show more replacements/,'A date-only basket can be checked and replacements offered before times are chosen');
  assert.match(await priceTool.clientTools.suggest_alternatives({item:'Unavailable Camera'}),/Sony FX3/,'Gaffer can suggest same-date alternatives before exact times are chosen');
  assert.equal(toolAvailabilityRequests.at(-1).items[0].pickupTime,undefined,'Date-level basket check accepts missing pickup time');
  assert.equal(toolAvailabilityRequests.at(-1).items[0].returnTime,undefined,'Date-level basket check accepts missing return time');
  Object.assign(cart.items[0],{pickupTime:"10:00",returnTime:"18:00"});
  assert.match(await priceTool.clientTools.check_basket(),/Sony FX3.*Show more replacements/);
  assert.match(await priceTool.clientTools.switch_unavailable({item:'Unavailable Camera',replacement:'Sony FX3'}),/keeping 2026-12-07 to 2026-12-09/);assert.equal(cart.items[0].start,'2026-12-07');assert.equal(cart.items[0].end,'2026-12-09');assert.equal(cart.items[0].pickupTime,'10:00');assert.equal(cart.items[0].returnTime,'18:00');
  assert.match(await priceTool.clientTools.email_checkout_cart({email:'person@example.invalid'}),/was emailed/);assert.equal(toolActions.at(-1).ref,'checkoutCarts:email');assert.equal(toolActions.at(-1).args.lines[0].listingId,'fx3');assert.match(toolActions.at(-1).args.shareKey,/^[A-Za-z0-9_-]{43}$/);
  assert.match(await priceTool.clientTools.setup_account({email:'person@example.invalid',name:'Person',phone:'07700123456'}),/Never ask.*code or password/);assert.equal(toolActions.at(-1).args.cartKey,toolActions.find(action=>action.ref==='checkoutCarts:email').args.shareKey);assert(toolRoutes.at(-1).startsWith('/account/setup?challenge='));
  assert.match(await priceTool.clientTools.reset_password({email:'person@example.invalid'}),/choose a new password/);assert.equal(toolActions.at(-1).args.purpose,'reset');

  cart.items=[{key:'ready',listingId:'fx3',title:'Sony FX3',slug:'sony-fx3',start:'2026-12-07',end:'2026-12-09',days:3,total:141}];cart.count=1;
  toolAvailabilityResponse={fx3:{ok:true,available:1}};
  const basketReview=await priceTool.clientTools.go_to_checkout();
  assert.match(basketReview,/Exact pickup and return times are selected at checkout/);
  assert.equal(toolRoutes.at(-1),'/cart','The first checkout request keeps the existing basket-review step');
  const checkoutHandoff=await priceTool.clientTools.go_to_checkout();
  assert.match(checkoutHandoff,/Choose exact pickup and return times there/);
  assert.equal(toolRoutes.at(-1),'/checkout','The confirmed second step opens checkout without requiring times in the basket');

  cart.items=[
    {key:'ready-camera',listingId:'fx3',title:'Sony FX3',slug:'sony-fx3',start:'2026-12-07',end:'2026-12-09',days:3,total:141},
    {key:'ready-lens',listingId:'lens',title:'Sony 24-70mm lens',slug:'sony-24-70',start:'2026-12-07',end:'2026-12-09',days:3,total:90},
  ];cart.count=2;
  toolAvailabilityResponse={fx3:{ok:true,available:1},lens:{ok:true,available:1}};
  const originalFetch=global.fetch;
  global.fetch=async()=>({ok:false,status:503,json:async()=>({warnings:[],upgrades:[],error:'Compatibility service unavailable'})});
  try {
    const compatibilityReview=await priceTool.clientTools.review_basket();
    assert.match(compatibilityReview,/couldn't verify kit compatibility/i,'A failed compatibility lookup must not be treated as a clean kit');
    const compatibilityCheckout=await priceTool.clientTools.go_to_checkout();
    assert.match(compatibilityCheckout,/couldn't verify kit compatibility/i,'The checkout review must disclose when the shared compatibility check failed');
  } finally {
    global.fetch=originalFetch;
  }

  // Execute the real provider's SDK callbacks through a deterministic hook harness.
  // No paid calls: verify the handover supplied to the transport and its lifecycle.
  const slots=[];let cursor=0;const sessions=[];let now=10_000;let variables={basket_count:'0',basket_items:''};
  const React={
    createContext:()=>({Provider:'provider'}),useContext:()=>null,
    useState:(initial)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef:(initial)=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback:f=>f,useMemo:f=>f(),useEffect:()=>{},
  };
  let priceAllowed=false,alignments=0;const usageEvents=[];
  let getMicrophone=async()=>({getTracks:()=>[{stop(){}}]});let getMicState=async()=> 'granted';
  const {GafferSessionProvider,formatLiveCallContext}=load('src/components/gaffer/GafferSession.tsx',{
    react:React,'react/jsx-runtime':{jsx:(_type,props)=>props},
    'convex/react':{useMutation:reference=>async args=>{if(reference==='analytics:track')usageEvents.push(args)}},'@cvx/_generated/api':{api:refs},'@/lib/session':{getSessionId:()=> 'fixture-browser'},
    'next/navigation':{usePathname:()=>'/gear'},
    '@/components/gaffer/useGafferTools':{useGafferTools:()=>({clientTools:{add_to_basket:async()=> 'Added FX3'},dynamicVariables:variables,noteCustomerMessage:message=>{priceAllowed=asksForBetterPrice(message);},noteAgentAlignment:()=>{alignments++;},noteAgentMessage:()=>{},resetSpokenFocus:()=>{},resetPriceRequest:()=>{priceAllowed=false;}})},
    '@/components/gaffer/callContext':{pageBrief:()=>({intent:'gear',mode:'sales',brief:'Gear page',opening:'Hello there'}),isSignOff:text=>text==='goodbye'},
    '@/components/gaffer/hintTiming':{createHintController:()=>({reset(){},noteTalking(){}})},
    '@/components/gaffer/micPermission':{micState:()=>getMicState(),requestMic:async()=>({ok:true})},
    '@elevenlabs/client':{Conversation:{startSession:async cfg=>{const session={cfg,updates:[],ended:false,sendContextualUpdate(text){this.updates.push(text);},async endSession(){this.ended=true;cfg.onDisconnect();}};sessions.push(session);cfg.onConnect();return session;}}},
  },{Date:{now:()=>now},navigator:{mediaDevices:{getUserMedia:()=>getMicrophone()}},localStorage:{getItem:()=>null,removeItem(){},setItem(){}},setTimeout:()=>1,clearTimeout:()=>{},console:{warn(){},error(){}}});
  assert.match(formatLiveCallContext('/gear',{basket_count:'1'}),/one settled, concise answer/i);
  const render=()=>{cursor=0;return GafferSessionProvider({children:null}).value;};
  await render().toggle();assert.equal(render().state,'live');
  const first=sessions[0];assert.equal(first.cfg.connectionType,"websocket");assert.deepEqual(first.cfg.workletPaths,{rawAudioProcessor:'/voice-worklets/rawAudioProcessor.js?v=1.12.0',audioConcatProcessor:'/voice-worklets/audioConcatProcessor.js?v=1.12.0'});first.cfg.onAudioAlignment({chars:["F"],char_start_times_ms:[0],char_durations_ms:[100]});assert.equal(alignments,1,"Current audio alignment reaches the catalog tracker");
  const contextUpdatesBeforeCustomerTurn=first.updates.length;
  first.cfg.onMessage({source:'user',message:'My name is Alex; FX3 next Friday.'});
  assert.equal(first.updates.length,contextUpdatesBeforeCustomerTurn+1,'Live page context is sent at a caller turn, not continuously while Gaffer speaks');
  assert.match(first.updates.at(-1),/one settled, concise answer/i);
  await first.cfg.clientTools.add_to_basket({item:'FX3'});
  variables={basket_count:'1',basket_items:'FX3 next Friday'};const contextUpdatesBeforeCartRender=first.updates.length;render();
  assert.equal(first.updates.length,contextUpdatesBeforeCartRender,'Basket rerenders do not inject new competing context during Gaffer speech');
  first.cfg.onMessage({source:'user',message:'Could you do a better price?'});assert.equal(priceAllowed,true);
  assert.match(first.updates.at(-1),/FX3 next Friday/,'The next customer turn receives the latest basket state');
  now+=600_000;first.cfg.onDisconnect();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sessions.length,2);assert.equal(render().state,'live');assert.deepEqual(usageEvents,[{type:'gaffer_connected',path:'/gear',sessionId:'fixture-browser'}],'Transport reconnection does not double count a conversation');
  const resumed=sessions[1];first.cfg.onAudioAlignment({chars:["X"],char_start_times_ms:[0],char_durations_ms:[100]});assert.equal(alignments,1,"Stale audio cannot refocus the new call");
  assert.equal(resumed.cfg.dynamicVariables.basket_count,'1','reconnect uses fresh basket');
  assert.match(resumed.cfg.overrides.agent.firstMessage,/carry on/);
  assert.match(resumed.updates.join(' '),/Alex/);assert.match(resumed.updates.join(' '),/Added FX3/);
  assert.equal(priceAllowed,true,'negotiation request survives reconnect');
  first.cfg.onDisconnect();assert.equal(sessions.length,2,'stale callbacks cannot restart');
  assert.match(await first.cfg.clientTools.add_to_basket({}),/no action taken/);
  await render().end();assert.equal(render().state,'idle');assert.equal(priceAllowed,false);
  await render().toggle();assert.equal(sessions.length,3);assert.equal(sessions[2].cfg.overrides.agent.firstMessage,'Hello there');
  assert.doesNotMatch(sessions[2].updates.join(' '),/Alex/,'new call does not inherit private history');
  sessions[2].cfg.onMessage({source:'user',message:'goodbye'});now+=10_000;sessions[2].cfg.onDisconnect();
  assert.equal(sessions.length,3,'intentional sign-off never reconnects');
  getMicrophone=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'})};
  await render().toggle();assert.match(render().error,/Microphone blocked/);assert.equal(render().state,'idle');
  let rejectMic;getMicrophone=()=>new Promise((resolve,reject)=>{rejectMic=reject});
  const pending=render().toggle();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(render().state,'connecting');await render().end();
  rejectMic(Object.assign(Error('denied'),{name:'NotAllowedError'}));await pending;
  assert.equal(render().state,'idle');assert.equal(render().error,null,'Cancelling preflight must not show a stale error');
  getMicrophone=async()=>({getTracks:()=>[{stop(){}}]});let resolvePermission;let permissionChecks=0;getMicState=()=>{permissionChecks++;return new Promise(resolve=>{resolvePermission=resolve})};
  const beforeRace=sessions.length;const firstClick=render().toggle();const secondClick=render().toggle();assert.equal(permissionChecks,1,'Repeated clicks share one preflight instead of starting parallel calls');resolvePermission('granted');await Promise.all([firstClick,secondClick]);assert.equal(sessions.length,beforeRace+1,'Only one provider session starts');await render().end();
  const cancelled=render().toggle();await render().end();resolvePermission('granted');await cancelled;assert.equal(sessions.length,beforeRace+1,'Ending while permission is checked cannot start a later call');
  console.log('PASS: discount boundaries, retired offer compatibility, explicit requests, authoritative checkout repricing, deposit/delivery exclusion, changed baskets, reconnect history, fresh basket, stale callbacks, deliberate reset and sign-off.');
})().catch(e=>{console.error(e);process.exitCode=1});
