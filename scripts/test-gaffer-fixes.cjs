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
// These values satisfy the checkout activation boundary; no provider call is made.
Object.assign(process.env, {
  RENTAL_CHECKOUT_ENABLED: 'true', DIDIT_API_KEY: 'test', DIDIT_WORKFLOW_ID: 'test', DIDIT_WEBHOOK_SECRET: 'test', DIDIT_APPLICATION_ID: 'test', DIDIT_ENVIRONMENT: 'sandbox',
  STRIPE_WEBHOOK_SECRET: 'test', STRIPE_SECRET_KEY: 'test', STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID: 'test',
  INVOICE_SECRET: 'test', APP_URL: 'https://example.invalid', BUSINESS_LEGAL_NAME: 'Test supplier',
  BUSINESS_INVOICE_ADDRESS: 'Test address', RESEND_API_KEY: 'test',
});
class StripeStub {
  static lastCheckout;
  paymentMethodConfigurations = { retrieve: async () => ({ active: true, card: { display_preference: { value: 'on' } }, apple_pay: { display_preference: { value: 'off' } }, google_pay: { display_preference: { value: 'off' } }, link: { display_preference: { value: 'off' } } }) };
  checkout = { sessions: { create: async (params) => { StripeStub.lastCheckout=params; return {id:'cs_test_booking',url:'https://checkout.stripe.test/session'}; } } };
}
const serverMocks = { './_generated/server': registered, './_generated/api': { api: refs, internal: refs }, '../_generated/api': { api: refs, internal: refs }, './adminAuth': {}, stripe: StripeStub };
const { validate } = load('convex/promo.ts', serverMocks);
const { start, priceQuote } = load('convex/checkout.ts', serverMocks);
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
        if(ref==='settings:get') return {acceptingOrders:true};
        if(ref==='catalog:repriceLines') return prices.map((total,i)=>({title:`Real item ${i}`,total,deposit:1000}));
        if(ref==='availability:forListing') return {available:10};
        if(ref==='accounts:_byToken') return {_id:'acct-1',email:'owner@example.invalid',membershipActive:false};
        if(ref==='accounts:_byEmail') return args.email==='owner@example.invalid'?{_id:'acct-1',email:args.email,membershipActive:false}:null;
        if(ref==='bookings:availableCheckoutCredit') return args.kind==='refund'?0:availableCredit;
        if(ref==='repeatRentals:candidate') return null;
        if(ref==='promo:validate') return validate.handler({},args);
        throw Error(`Unexpected query ${ref}`);
      },
      runAction: async (ref,args) => { assert.equal(ref,'delivery:quote'); assert.equal(args.postcode,deliveryPostcode.replace(/\s/g,'').toUpperCase()); assert.equal(args.listingIds.length,prices.length); return {ok:true,fee:quotedFee}; },
      runMutation: async (ref,args) => { assert.equal(ref,'bookings:createPending'); pending=args; throw stop; },
    };
    const args={items:prices.map((_,i)=>({listingId:`listing${i}`,title:submittedTitle??`Item ${i}`,start:0,end:0,qty,total:submittedTotal,deposit:0,...(i?{offerType:'tripod50'}:{})})),token,customer:{email:customerEmail,name:'Test Renter',billingAddress:'123 Test Street, London'},fulfilment,address,deliveryPostcode,deliveryFee,promoCode:code,pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Test Renter',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS}};
    if (!expectedError || expectedTotalOverride !== undefined) {
      const quote = await priceQuote.handler(ctx,{items:args.items,token,customerEmail,fulfilment,address,deliveryPostcode,promoCode:code});
      args.expectedTotalDue = expectedTotalOverride ?? quote.totalDue;
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
  assert.equal(order.expectedTotalDue,395,'the quoted total includes account credit but keeps the £25 refundable payment');
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
    lineItems:[],subtotal:200,depositAmount:25,total:225,expectedTotalDue:225,
    creditAccountId:'acct-1',currency:'GBP',
  }),/available credit changed/);
  assert.equal(inserted,false);

  // Cross the real booking and Stripe boundaries with inert adapters: verify the
  // payment amount and return URLs cannot be supplied by the browser.
  let savedBooking;
  const checkoutCtx = {
    runQuery: async (ref) => {
      if(ref==='accounts:_byEmail') return null; // Guest fixture has no stored account.
      if(ref==='settings:get') return {acceptingOrders:true};
      if(ref==='catalog:repriceLines') return [{title:'Real camera',total:200,deposit:1000,dailyRate:40}];
      if(ref==='availability:forListing') return {available:1};
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
    fulfilment:'pickup',deliveryFee:0,expectedTotalDue:225,pickupTime:'10:00',returnTime:'18:00',
    agreement:{name:'Test Renter',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS},
    origin:'https://attacker.invalid',
  });
  assert.equal(checkoutResult.url,'https://checkout.stripe.test/session');
  assert.equal(savedBooking.lineItems[0].title,'Real camera');
  assert.equal(savedBooking.depositHoldAmount,50);
  assert.equal(savedBooking.depositAmount,25);
  assert.equal(StripeStub.lastCheckout.line_items[0].price_data.unit_amount,20000);
  assert.equal(StripeStub.lastCheckout.line_items[1].price_data.unit_amount,2500);
  assert.equal(StripeStub.lastCheckout.success_url,'https://example.invalid/checkout/success?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(StripeStub.lastCheckout.cancel_url,'https://example.invalid/cart');
  const ordinaryQuery=checkoutCtx.runQuery;
  checkoutCtx.runQuery=async(ref,args)=>ref==='promo:validate'?{valid:true,discount:10,code:'TEN'}:ordinaryQuery(ref,args);
  await start.handler(checkoutCtx,{items:[{listingId:'camera-1',title:'Camera',start:0,end:0,qty:1,total:1,deposit:0}],customer:{email:'test@example.invalid',name:'Test Renter',billingAddress:'123 Test Street, London'},fulfilment:'pickup',deliveryFee:0,expectedTotalDue:215,promoCode:'TEN',pickupTime:'10:00',returnTime:'18:00',agreement:{name:'Test Renter',securityHoldConsent:true,laterChargeConsent:true,documents:AGREEMENTS}});
  assert.equal(StripeStub.lastCheckout.line_items[0].price_data.unit_amount,19000,'nonmember discount reduces rental only');
  assert.equal(StripeStub.lastCheckout.line_items[1].price_data.unit_amount,2500,'nonmember/referral checkout protects the full upfront security line');
  assert.equal(StripeStub.lastCheckout.discounts,undefined,'no global coupon may discount security');


  const memory=createCallMemory();
  memory.add('user','My name is Alex. I need the FX3 next Friday.');
  memory.add('tool','Added FX3; dates confirmed; enquiry saved.');
  memory.add('user','Could you do a better price?');
  assert.match(memory.context(),/Alex/);assert.match(memory.context(),/enquiry saved/);assert.match(memory.context(),/do not repeat completed basket changes/);
  memory.clear();assert.equal(memory.context(),'');
  const cart={items:[],count:2,subtotal:550,eligibleSubtotal:500,promo:null,close(){},setPromo(code){this.promo=code;}};
  const {useGafferTools}=load('src/components/gaffer/useGafferTools.ts',{
    react:{useRef:current=>({current}),useCallback:f=>f,useMemo:f=>f(),useEffect:()=>{}},
    'next/navigation':{useRouter:()=>({push(){}})},'convex/react':{useQuery:()=>[],useConvex:()=>({query:async(ref,args)=>{
      if(ref==='voiceCatalog:search')return {matches:[{id:'fx3',title:'Sony FX3',daily:47}]};
      if(ref==='availability:forListing')return {available:1};
      return args.code==='better15'?{valid:true,discount:75}:validate.handler({},args);
    }})},
    '@cvx/_generated/api':{api:refs},'@cvx/lib/gafferDiscount':{GAFFER_PRICE_CODE:'gaffer10'},
    '@/components/cart/CartProvider':{useCart:()=>cart},'@/components/account/AccountProvider':{useAccount:()=>({})},
    '@/lib/pricing':{},'@/lib/voiceDates':{londonToday:()=> '2026-09-13',resolveDate:()=>({ok:true,date:'2026-09-14'}),inclusiveDays:()=>1},'@/lib/dates':{dayMs:()=>0},
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
  assert.match(delayedBrowse,/not finished loading on screen/);assert.doesNotMatch(delayedBrowse,/On screen now/);

  // Execute the real provider's SDK callbacks through a deterministic hook harness.
  // No paid calls: verify the handover supplied to the transport and its lifecycle.
  const slots=[];let cursor=0;const sessions=[];let now=10_000;let variables={basket_count:'0',basket_items:''};
  const React={
    createContext:()=>({Provider:'provider'}),useContext:()=>null,
    useState:(initial)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef:(initial)=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback:f=>f,useMemo:f=>f(),useEffect:()=>{},
  };
  let priceAllowed=false,alignments=0;
  const {GafferSessionProvider}=load('src/components/gaffer/GafferSession.tsx',{
    react:React,'react/jsx-runtime':{jsx:(_type,props)=>props},
    'next/navigation':{usePathname:()=>'/gear'},
    '@/components/gaffer/useGafferTools':{useGafferTools:()=>({clientTools:{add_to_basket:async()=> 'Added FX3'},dynamicVariables:variables,noteCustomerMessage:message=>{priceAllowed=asksForBetterPrice(message);},noteAgentAlignment:()=>{alignments++;},noteAgentMessage:()=>{},resetSpokenFocus:()=>{},resetPriceRequest:()=>{priceAllowed=false;}})},
    '@/components/gaffer/callContext':{pageBrief:()=>({intent:'gear',mode:'sales',brief:'Gear page',opening:'Hello there'}),isSignOff:text=>text==='goodbye'},
    '@/components/gaffer/hintTiming':{createHintController:()=>({reset(){},noteTalking(){}})},
    '@/components/gaffer/micPermission':{micState:async()=> 'granted',requestMic:async()=>({ok:true})},
    '@elevenlabs/client':{Conversation:{startSession:async cfg=>{const session={cfg,updates:[],ended:false,sendContextualUpdate(text){this.updates.push(text);},async endSession(){this.ended=true;cfg.onDisconnect();}};sessions.push(session);cfg.onConnect();return session;}}},
  },{Date:{now:()=>now},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},localStorage:{getItem:()=>null,removeItem(){},setItem(){}},setTimeout:()=>1,clearTimeout:()=>{},console:{warn(){},error(){}}});
  const render=()=>{cursor=0;return GafferSessionProvider({children:null}).value;};
  await render().toggle();assert.equal(render().state,'live');
  const first=sessions[0];assert.equal(first.cfg.connectionType,"websocket");first.cfg.onAudioAlignment({chars:["F"],char_start_times_ms:[0],char_durations_ms:[100]});assert.equal(alignments,1,"Current audio alignment reaches the catalog tracker");
  first.cfg.onMessage({source:'user',message:'My name is Alex; FX3 next Friday.'});
  await first.cfg.clientTools.add_to_basket({item:'FX3'});
  first.cfg.onMessage({source:'user',message:'Could you do a better price?'});assert.equal(priceAllowed,true);
  variables={basket_count:'1',basket_items:'FX3 next Friday'};render();
  now+=600_000;first.cfg.onDisconnect();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sessions.length,2);assert.equal(render().state,'live');
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
  console.log('PASS: discount boundaries, retired offer compatibility, explicit requests, authoritative checkout repricing, deposit/delivery exclusion, changed baskets, reconnect history, fresh basket, stale callbacks, deliberate reset and sign-off.');
})().catch(e=>{console.error(e);process.exitCode=1});
