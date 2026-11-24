const assert=require('node:assert/strict');
const RealDate=Date;
global.Date=class extends RealDate {
 constructor(...args){super(...(args.length?args:['2026-11-01T12:00:00Z']));}
 static now(){return new RealDate('2026-11-01T12:00:00Z').getTime();}
};
const {load,setMock,put,db}=require('./lib/rentalTestHarness.cjs');
const gafferVoiceQuoteTools=require('./lib/gafferVoiceQuoteTools.cjs');
const {LIVE_FX3_BODY_KIT}=require('./lib/gafferLiveCatalogueFixtures.cjs');
for(const [name,file] of Object.entries({'@/lib/pricing':'src/lib/pricing.ts','@/lib/dates':'src/lib/dates.ts','@/lib/voiceDates':'src/lib/voiceDates.ts'}))setMock(name,load(file));
const {quote}=load('src/lib/pricing.ts');
const canonicalVoicePricing=item=>item.pricing?Object.fromEntries(quote(item.pricing,1).ladder.map(tier=>[tier.days===1?'daily':`day${tier.days}`,tier.perDay])):undefined;
const {rentalPricingDays}=load('shared/rentalDuration.ts');
const {weekendDays}=load('shared/membership.ts');
const rentalBenefits=load('shared/rentalBenefits.ts');
const listing=data=>put('listings',{active:true,category:'Lenses',stockMappingStatus:'complete',pricing:{daily:20},r2Images:['https://example.invalid/item.jpg'],...data});
const camera=listing({slug:'fx3',title:'Sony FX3 and 24–70mm GM lens',category:'Cameras',itemType:'camera-body',specs:{mount:'E',coverage:'ff',includesLens:true,lensFocal:'24-70'},components:[{inventoryUnitId:'body',qty:1},{inventoryUnitId:'gm',qty:1}]});
const djiOne=listing({slug:'dji-mic-1',title:'DJI Mic 1 Wireless Set',category:'Audio',itemType:'wireless-mic',minimumRentalDays:2,inventoryFacts:{owned:true,contents:['1 × DJI Mic 1 wireless set']},components:[{inventoryUnitId:'dji1',qty:1}]});
const gm=listing({slug:'gm',title:'Sony 24-70mm GM lens',itemType:'lens',demandScore:999,specs:{mount:'E',coverage:'ff',lensFocal:'24-70',tier:'premium',lensClass:'af'},components:[{inventoryUnitId:'gm',qty:1}]});
const wide=listing({slug:'wide',title:'Sony 16-35mm GM lens',itemType:'lens',demandScore:100,specs:{mount:'E',coverage:'ff',lensFocal:'16-35',tier:'premium',lensClass:'af'},components:[{inventoryUnitId:'wide',qty:1}]});
listing({...wide,_id:'wide-alias',components:wide.components});
listing({slug:'wrong',title:'Sony 16-35mm RF lens',itemType:'lens',demandScore:1000,specs:{mount:'RF',coverage:'ff'},components:[{inventoryUnitId:'wrong',qty:1}]});
const recommend=load('convex/voiceCatalog.ts').recommend;
const cart={items:[{key:'fx3-line',listingId:camera._id,title:camera.title,start:'2026-11-20',end:'2026-11-22',days:3,perDay:20,total:60,deposit:50}],membership:null,promo:null,count:1,subtotal:60,depositTotal:100,close(){},open(){},has(id){return this.items.some(i=>i.listingId===id)}};
let stockCalls=[],cartStockCalls=[],recommendArgs,cartStockMode='available',listingStockMode='available',priceQuoteMode='available',removed=[],added=[],cartShareCalls=[],accountSetupCalls=[],priceQuoteCalls=[],priceQuoteBenefits=[],accountState={};
cart.remove=key=>removed.push(key);
cart.add=line=>added.push(line);
const convex={query:async(name,args)=>{
 if(name==='voiceCatalog.search'){const item=/dji/i.test(args.q)?djiOne:/16\s*-?\s*35|wide/i.test(args.q)?wide:camera;const pricing=canonicalVoicePricing(item);return{matches:[{id:item._id,slug:item.slug,title:item.title,daily:pricing?.daily,pricing,deal:item.quietDeal,minDays:item.minimumRentalDays??1}]};}
 if(name==='voiceCatalog.byCategory')return[{id:wide._id,title:wide.title,daily:wide.pricing.daily}];
 if(name==='voiceCatalog.recommend'){recommendArgs=args;return recommend.handler({db},args)}
 if(name==='availability.forListing'){stockCalls.push(args);if(listingStockMode==='missing')return {};return{available:1}}
 if(name==='availability.forCart'){cartStockCalls.push(args);if(cartStockMode==='error')throw Error('fixture outage');if(cartStockMode==='missing')return {};return Object.fromEntries((args.items??[]).map(item=>[String(item.listingId),{ok:cartStockMode!=='unavailable'&&!(cartStockMode==='existing-unavailable'&&String(item.listingId)===String(camera._id)),available:cartStockMode==='unavailable'||(cartStockMode==='existing-unavailable'&&String(item.listingId)===String(camera._id))?0:1,demanded:1}]));}
 if(name==='cartReplacements.forCart')return{};
 throw Error('Unexpected query '+name);
}};
convex.action=async(name,args)=>{
 if(name==='checkout.priceQuote'){
  priceQuoteCalls.push(args);
  if(priceQuoteMode==='error')throw Error('synthetic quote outage');
  const items=await Promise.all(args.items.map(async item=>{
   const listing=await db.get(item.listingId);if(!listing)throw Error('Listing missing');
   const days=rentalPricingDays(item.start,item.end,item.pickupTime,item.returnTime);
   return {...item,title:listing.title,total:quote(listing.pricing,days).total,deposit:listing.depositAmount??0};
  }));
  const subtotal=items.reduce((sum,item)=>sum+item.total,0);
  let weekendSavingPence=0;
  for(const item of items){
   if(weekendDays(item.start,item.end)>0){
    const listing=await db.get(item.listingId),days=rentalPricingDays(item.start,item.end,item.pickupTime,item.returnTime);
    weekendSavingPence+=Math.max(0,quote(listing.pricing,days).total-quote(listing.pricing,Math.max(1,days-1)).total)*100;
   }
  }
  const account=args.token==='member-token'?{
   membershipActive:true,membershipTier:'pro',membershipStatus:'active',membershipPaidThrough:Date.now()+30*86400000,
   stripeSubscriptionId:'sub-fixture',firstRentalPaidAt:Date.now()-86400000,firstCleanRentalCompletedAt:Date.now()-86400000,loyaltyEligible:true,loyaltyPercent:10,
  }:null;
  const candidates=account?rentalBenefits.memberRentalBenefitCandidates({account,subtotalPence:Math.round(subtotal*100),weekendSavingPence}):[];
  if(args.promoCode)candidates.push({kind:'promo',savingPence:1000,label:'Test promo'});
  const benefit=rentalBenefits.bestBenefit(candidates);
  priceQuoteBenefits.push(benefit.kind);
  const totalReduction=benefit.savingPence/100;
  return {items:items.map(item=>({title:item.title,total:item.total})),subtotal,totalReduction,membershipFee:args.selectedMembership?49:0,benefitKind:benefit.kind,combinedTotalDue:subtotal-totalReduction+(args.selectedMembership?49:0)};
 }
 if(name==='checkoutCarts.email'){
  cartShareCalls.push(args);
  return {shareKey:args.shareKey,url:`https://example.invalid/cart/quote/${args.shareKey}`};
 }
 if(name==='accountCodes.request'){
  accountSetupCalls.push(args);
  return {challenge:'fixture-challenge'};
 }
 throw Error('Unexpected action '+name);
};
const leadHandler=load('convex/voice.ts').lead,leadJobs=[];let leadFails=false;
const saveLead=async(name,args)=>{if(name!=='voice.lead')throw Error('Unexpected mutation '+name);if(leadFails)throw Error('synthetic limit');return leadHandler.handler({db,scheduler:{runAfter:async(...job)=>leadJobs.push(job)}},args)};
convex.mutation=saveLead;
setMock('@cvx/lib/gafferDiscount',load('convex/lib/gafferDiscount.ts'));
setMock('react',{useRef:current=>({current}),useState:initial=>[initial,()=>{}],useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:()=>{}});
setMock('next/navigation',{useRouter:()=>({push(){}})});
setMock('convex/react',{useConvex:()=>convex,useQuery:(name)=>name==='settings.get'?{assessmentSecurityEnabled:true}:name==='catalog.listListings'?[camera,gm,wide]:{}});
setMock('@/components/cart/CartProvider',{useCart:()=>cart});
setMock('@/components/account/AccountProvider',{useAccount:()=>accountState});
setMock('@/components/account/useCreditBalance',{useCreditBalance:()=>undefined});
setMock('@/components/gaffer/GafferFocus',{useGafferFocus:()=>({focus(){},suggest:async()=>false,suggestedIds:[],focusedId:null}),scrollToId:async()=>false});
const {useGafferTools}=load('src/components/gaffer/useGafferTools.ts');
(async()=>{
 const legacyTools={
  get_price:{type:'webhook',name:'get_price',description:'price',response_timeout_secs:20,api_schema:{url:'https://example.invalid/price?key=private',method:'POST',content_type:'application/json',request_body_schema:{type:'object',properties:{item:{type:'string'},days:{type:'integer'}},required:['item']}}},
  check_availability:{type:'webhook',name:'check_availability',description:'stock',response_timeout_secs:20,api_schema:{url:'https://example.invalid/stock?key=private',method:'POST',content_type:'application/json',request_body_schema:{type:'object',properties:{item:{type:'string'},start:{type:'string'},end:{type:'string'}},required:['item','start']}}},
  check_stock:{type:'webhook',name:'check_stock',api_schema:{url:'https://example.invalid/stock',method:'POST',request_body_schema:{type:'object',properties:{item:{type:'string'}},required:['item']}}},
 };
 const originalIds=['tool-price','tool-availability','tool-stock'];
 const originalToolConfigs=structuredClone(legacyTools);
 const agentRecord={conversation_config:{agent:{prompt:{tool_ids:originalIds,tools:[{name:'get_price',tool_id:originalIds[0]},{name:'check_availability',tool_id:originalIds[1]},{name:'check_stock',tool_id:originalIds[2]}]}}}};
 const calls=[];
 const fakeFetch=async(url,options={})=>{
  const pathname=new URL(url).pathname,method=options.method??'GET';calls.push({pathname,method});
  if(pathname==='/v1/convai/agents/test-agent')return{ok:true,status:200,json:async()=>structuredClone(agentRecord)};
  const match=pathname.match(/^\/v1\/convai\/tools\/(tool-price|tool-availability|tool-stock)$/);
  assert(match,`unexpected provider path ${pathname}`);
  const name=match[1]==='tool-price'?'get_price':match[1]==='tool-availability'?'check_availability':'check_stock';
  if(method==='PATCH')legacyTools[name]=JSON.parse(options.body).tool_config;
  return{ok:true,status:200,json:async()=>({id:match[1],tool_config:structuredClone(legacyTools[name])})};
 };
 const plan=await gafferVoiceQuoteTools.syncAgentQuoteTools({agentId:'test-agent',apiKey:'fixture',fetchImpl:fakeFetch});
 assert.equal(plan.applied,false);assert.equal(plan.updates.length,2);assert.deepEqual(plan.toolIds,originalIds);
 assert.equal(calls.some(call=>call.method==='PATCH'),false,'the default schema plan must not modify the provider');
 const applied=await gafferVoiceQuoteTools.syncAgentQuoteTools({agentId:'test-agent',apiKey:'fixture',fetchImpl:fakeFetch,apply:true});
 assert.equal(applied.applied,true);assert.deepEqual(applied.toolIds,originalIds);
 for(const name of ['get_price','check_availability']){
  const config=legacyTools[name],schema=config.api_schema.request_body_schema;
  assert.equal(schema.properties.requests,undefined,'ElevenLabs webhook schemas must not contain unsupported arrays');
  for(let index=2;index<=8;index++){
   assert.equal(schema.properties[`item_${index}`].type,'string','the phone tool must accept every distinct item in the complete request');
   assert.equal(schema.properties[`quantity_${index}`].type,'integer');
   assert.equal(schema.properties[`quantityIsListingUnits_${index}`].type,'boolean');
   assert.equal(schema.properties[`allowAlternatives_${index}`].type,'boolean');
  }
  assert.equal(schema.properties.allowOptionalAddOns.type,'boolean');
  assert.equal(schema.properties.quantityIsListingUnits.type,'boolean');
  assert.match(schema.properties.allowOptionalAddOns.description,/clear shoot context/i);
  assert.match(schema.properties.allowOptionalAddOns.description,/camera-only\/no-extras/i);
  assert.match(schema.properties.allowAlternatives.description,/explicitly accepts alternatives/i,'voice quote schema requires caller consent before a substitution');
  assert.match(config.description,/complete request in one call/i,'the phone tool must check the full request together');
  assert.match(config.description,/item_2 through item_8/i,'the phone tool must expose all scalar item slots');
  assert.match(config.description,/explicitly accepts alternatives/i,'the phone agent instructions default to the exact requested item');
  assert.equal(schema.properties.pickup_time.type,'string');assert.equal(schema.properties.return_time.type,'string');
  assert(schema.properties.item,'the existing single-item parameter must remain supported');
  assert.equal(config.api_schema.url,`https://example.invalid/${name==='get_price'?'price':'stock'}?key=private`,'webhook auth and target must be preserved');
 }
 assert.deepEqual(legacyTools.get_price.api_schema.request_body_schema.required,['item']);
 assert.deepEqual(legacyTools.check_availability.api_schema.request_body_schema.required,['item','start']);
 const rollbackTools=structuredClone(originalToolConfigs);let failAvailabilityPatch=true;
 const rollbackFetch=async(url,options={})=>{
  const pathname=new URL(url).pathname,method=options.method??'GET';
  if(pathname==='/v1/convai/agents/test-agent')return{ok:true,status:200,json:async()=>structuredClone(agentRecord)};
  const match=pathname.match(/^\/v1\/convai\/tools\/(tool-price|tool-availability|tool-stock)$/);assert(match);
  const name=match[1]==='tool-price'?'get_price':match[1]==='tool-availability'?'check_availability':'check_stock';
  if(method==='PATCH'&&match[1]==='tool-availability'&&failAvailabilityPatch){failAvailabilityPatch=false;return{ok:false,status:422,json:async()=>({detail:[{loc:['body','tool_config','webhook','api_schema','request_body_schema','properties','example','array'],msg:'Extra inputs are not permitted'}]})};}
  if(method==='PATCH')rollbackTools[name]=JSON.parse(options.body).tool_config;
  return{ok:true,status:200,json:async()=>({id:match[1],tool_config:structuredClone(rollbackTools[name])})};
 };
 await assert.rejects(()=>gafferVoiceQuoteTools.syncAgentQuoteTools({agentId:'test-agent',apiKey:'fixture',fetchImpl:rollbackFetch,apply:true}),/rolled back.*Extra inputs are not permitted/);
 assert.deepEqual(rollbackTools.get_price.api_schema.request_body_schema.required,['item'],'a partial provider update must restore the first tool');
 assert.deepEqual(rollbackTools.check_availability.api_schema.request_body_schema.required,['item','start'],'the failed second tool remains untouched');
 const bodyOnly=listing({slug:'body-only',title:'Sony FX 3 Camera Body',itemType:'camera-body',category:'Cameras',pricing:{daily:47}});
 bodyOnly.reviewedImageUrls=['https://images.example.test/sony-fx3-reviewed.jpg'];
 bodyOnly.r2Images=['https://images.example.test/sony-fx3-stale.jpg'];
 bodyOnly.sourceImages=['https://images.example.test/sony-fx3-original.jpg'];
 const bodyKit=listing({slug:'fx3-cage-kit',title:'Sony FX 3 Body Kit with Cage',itemType:'camera-body',category:'Cameras',pricing:{daily:47}});
 bodyKit.reviewedImageUrls=[];
 const otherModel=listing({slug:'fx30',title:'Sony FX30 Body',itemType:'camera-body',category:'Cameras'});
 const comparison=listing({slug:'a7-compare',title:'Sony A7 III (like Sony FX3)',itemType:'camera-body',category:'Cameras'});
 const search=load('convex/voiceCatalog.ts').search;
 const unavailableListings=[
  listing({slug:'fx3-marketing',title:'Sony FX 3 Body marketing listing',itemType:'camera-body',category:'Cameras',marketingOnly:true}),
  listing({slug:'fx3-display',title:'Sony FX 3 Body display listing',itemType:'camera-body',category:'Cameras',displayOnly:true}),
  listing({slug:'fx3-unowned',title:'Sony FX 3 Body not owned',itemType:'camera-body',category:'Cameras',inventoryFacts:{owned:false}}),
  listing({slug:'fx3-unmapped',title:'Sony FX 3 Body unmapped stock',itemType:'camera-body',category:'Cameras',stockMappingStatus:'needs_review'}),
 ];
 const pair=listing({slug:'pair',title:'Two Sony FX3 Bodies',itemType:'camera-body',category:'Cameras',inventoryFacts:{owned:true,contents:['2 × Sony FX3']},pricing:{daily:92,day3:75},components:[{inventoryUnitId:'body',qty:2}]});
 const a7v=listing({slug:'a7v',title:'Sony A7 V camera body',itemType:'camera-body',category:'Cameras'});
 assert.equal((await search.handler({db},{q:'a75',limit:3})).matches[0].id,a7v._id,'spoken A75 alias must retain the actual A7 V generation');
 const searched=await search.handler({db},{q:'Sony FX 3',limit:8});
 assert.equal(searched.matches[0].id,bodyOnly._id,'spaced model finds the body before a lens package');
 assert.equal(searched.matches.find(item=>item.id===bodyOnly._id)?.heroImage,'https://images.example.test/sony-fx3-reviewed.jpg','voice search uses the canonical reviewed product photo, not a stale R2/source image');
 assert.equal(searched.matches.find(item=>item.id===bodyKit._id)?.heroImage,null,'an explicitly cleared reviewed gallery does not leak an old imported thumbnail');
 assert(!searched.matches.some(item=>[otherModel._id,comparison._id].includes(item.id)),'FX30 and comparison advertising cannot pass an FX3 identity check');
 assert(!searched.matches.some(item=>unavailableListings.some(row=>row._id===item.id)),'Gaffer search must exclude marketing, display-only, unowned, and unmapped stock');
 const browsed=await load('convex/voiceCatalog.ts').browse.handler({db},{q:'Sony cameras',limit:100});
 assert(!browsed.items.some(item=>unavailableListings.some(row=>row.title===item.title)),'Gaffer browse must use the same safe catalogue gate as exact search');
 assert.equal(browsed.items.find(item=>item.id===bodyOnly._id)?.heroImage,'https://images.example.test/sony-fx3-reviewed.jpg','voice browse returns the canonical reviewed photo');
 const voiceRecommendations=await recommend.handler({db},{q:'Sony camera',category:'Cameras',limit:12});
 assert(![...voiceRecommendations.standalone,...voiceRecommendations.bundles].some(item=>unavailableListings.some(row=>row._id===item.id)),'voice recommendations must not surface non-rentable catalogue rows');
 assert.equal([...voiceRecommendations.standalone,...voiceRecommendations.bundles].find(item=>item.id===bodyOnly._id)?.heroImage,'https://images.example.test/sony-fx3-reviewed.jpg','voice recommendations return the same canonical reviewed photo');
 assert.equal((await search.handler({db},{q:'two FX3',limit:3})).matches[0].id,pair._id,'two requested bodies prefer the documented two-body configuration');
 const {equipmentRequest}=load('shared/equipmentIdentity.ts');
 assert.equal(equipmentRequest('24-70mm lens').quantity,1);assert.equal(equipmentRequest('DJI Mic 2').quantity,1);assert.equal(equipmentRequest('4x complete mic kits').quantity,4);
 let tools=useGafferTools();
 assert.match(await tools.clientTools.log_enquiry({kind:'inquiry',name:'Web caller',message:'Synthetic question'}),/Logged it/);
 leadFails=true;assert.match(await tools.clientTools.log_enquiry({kind:'inquiry',name:'Web caller',message:'Synthetic question'}),/Couldn't file/);leadFails=false;
 const unconfirmed=await tools.clientTools.find_gear({item:'FX3',start:'2026-11-20',end:'2026-11-21'});
 assert.match(unconfirmed,/1 free for those dates; final stock is rechecked at checkout/,'the browser voice path may check real dates before exact checkout times');
 assert(!/confirmed availability|available on 20 November/i.test(unconfirmed),'a date-only result must not claim exact-time availability');
 assert.equal(stockCalls.length,0);
 assert.equal(cartStockCalls.at(-1).items.at(-1).pickupTime,undefined,'date-only browser voice checks must not invent pickup times');
 assert.equal(cartStockCalls.at(-1).items.at(-1).returnTime,undefined,'date-only browser voice checks must not invent return times');
 const inheritedAvailability=await tools.clientTools.find_gear({item:'FX3'});
 assert.match(inheritedAvailability,/For 2026-11-20 to 2026-11-22/,'availability without explicit dates inherits the one unambiguous basket window');
 assert.equal(cartStockCalls.at(-1).items.at(-1).start,Date.UTC(2026,10,20),'availability must not silently switch an existing basket to tomorrow');
 assert.match(await tools.clientTools.check_basket(),/All 1 line looks available for the selected dates/,'date-only basket checks can report dates without claiming exact times');
 assert.match(tools.dynamicVariables.basket_availability,/final availability check pending/);
 assert.match(await tools.clientTools.go_to_checkout(),/Exact pickup and return times are selected at checkout/);
 const inheritedAdd=await tools.clientTools.add_to_basket({item:'Sony 16-35mm lens'});
 assert.match(inheritedAdd,/I used the same dates already in the basket/);
 assert.equal(priceQuoteCalls.at(-1).items.length,2,'an inherited-date voice add reprices the complete proposed basket');
 assert.equal(priceQuoteCalls.at(-1).items[0].listingId,camera._id);
 assert.equal(priceQuoteCalls.at(-1).items[0].start,Date.UTC(2026,10,20));
 assert.equal(priceQuoteCalls.at(-1).items[0].end,Date.UTC(2026,10,22));
 assert.equal(priceQuoteCalls.at(-1).items[1].listingId,wide._id);
 assert.equal(priceQuoteCalls.at(-1).items[1].start,Date.UTC(2026,10,20));
 assert.equal(priceQuoteCalls.at(-1).items[1].end,Date.UTC(2026,10,22));
 assert.equal(added.at(-1).start,'2026-11-20','a selected item inherits the basket window rather than an invented date');
 assert.equal(added.at(-1).end,'2026-11-22');
 assert.equal(added.at(-1).pickupTime,undefined,'adding an item still leaves exact pickup time for checkout');
 assert.equal(added.at(-1).returnTime,undefined,'adding an item still leaves exact return time for checkout');
 const existingItems=cart.items,existingCount=cart.count,stockCallsBeforeMissingDates=cartStockCalls.length,directStockBeforeMissingDates=stockCalls.length,addedBeforeMissingDates=added.length;
 cart.items=[];cart.count=0;tools=useGafferTools();
 for(const partial of [{start:'2026-11-20'},{end:'2026-11-21'}]){
  assert.match(await tools.clientTools.browse_for({item:'FX3',...partial}),/dates to check availability/,'browse asks for the missing date');
  assert.match(await tools.clientTools.find_gear({item:'FX3',...partial}),/dates should I check/,'find asks for the missing date');
  assert.match(await tools.clientTools.suggest_alternatives({item:'FX3',...partial}),/hire dates should I check/,'alternatives ask for the missing date');
  assert.match(await tools.clientTools.add_to_basket({item:'FX3',...partial}),/both the first and return dates/,'a partial date never becomes a draft or same-day booking');
 }
 assert.equal(cartStockCalls.length,stockCallsBeforeMissingDates,'partial-date tools never query shared stock');
 assert.equal(stockCalls.length,directStockBeforeMissingDates,'partial-date tools never query listing stock');
 assert.equal(added.length,addedBeforeMissingDates,'partial dates never enter the payable cart');
 assert.match(await tools.clientTools.browse_for({item:'FX3'}),/Tell me the hire dates to check availability/);
 assert.match(await tools.clientTools.find_gear({item:'FX3'}),/What dates should I check/);
 assert.match(await tools.clientTools.suggest_alternatives({item:'FX3'}),/What hire dates should I check/);
 const staged=await tools.clientTools.add_to_basket({item:'FX3'});
 assert.match(staged,/proposed kit/);
 assert.match(staged,/haven't checked availability or quoted a price/);
 assert.equal(cart.items.length,0,'catalog-only additions never enter CartProvider');
 assert.equal(added.length,addedBeforeMissingDates,'catalog-only additions never become a payable line');
 assert.equal(cartStockCalls.length,stockCallsBeforeMissingDates,'catalog-only additions never query shared stock');
 assert.equal(stockCalls.length,directStockBeforeMissingDates,'catalog-only additions never query listing stock');
 const stagedEmail=await tools.clientTools.email_checkout_cart({email:'renter@example.invalid'});
 assert.match(stagedEmail,/private kit link was emailed/);
 assert.match(stagedEmail,/before checking price or availability/);
 assert.equal(cartShareCalls.length,1,'a staged catalog kit uses the existing private-cart email action');
 assert.equal(cartShareCalls[0].lines.length,1);
 assert.equal(cartShareCalls[0].lines[0].listingId,camera._id);
 assert.equal(Object.hasOwn(cartShareCalls[0].lines[0],'start'),false,'undated share omits start rather than inventing a timestamp');
 assert.equal(Object.hasOwn(cartShareCalls[0].lines[0],'end'),false,'undated share omits end rather than inventing a timestamp');
 assert.equal(stockCalls.length,directStockBeforeMissingDates,'emailing an undated kit does not check stock');
 assert.equal(cartStockCalls.length,stockCallsBeforeMissingDates,'emailing an undated kit does not check shared stock');
 assert.match(await tools.clientTools.setup_account({email:'renter@example.invalid',name:'Fixture Renter',phone:'+441234567890'}),/saved kit will reopen/);
 assert.equal(accountSetupCalls.at(-1).cartKey,cartShareCalls[0].shareKey,'account setup reconnects to the same emailed undated kit');
 assert.equal(cart.items.length,0,'account setup does not insert staged lines into the payable cart');
 tools=useGafferTools();
 const exactWindow={start:'2026-11-20',end:'2026-11-21'};
 const expectedStart=Date.UTC(2026,10,20),expectedEnd=Date.UTC(2026,10,21);
 const assertExactWindow=()=>{
  const candidate=cartStockCalls.at(-1).items.at(-1);
  assert.equal(candidate.start,expectedStart,'stock checks use the renter-selected start date');
  assert.equal(candidate.end,expectedEnd,'stock checks use the renter-selected return date');
 };
 await tools.clientTools.browse_for({item:'FX3',...exactWindow});assertExactWindow();
 await tools.clientTools.find_gear({item:'FX3',...exactWindow});assertExactWindow();
 await tools.clientTools.suggest_alternatives({item:'FX3',...exactWindow});assertExactWindow();
 await tools.clientTools.add_to_basket({item:'FX3',...exactWindow});assertExactWindow();
 assert.equal(added.at(-1).start,exactWindow.start,'the exact quote enters the payable cart with the selected start');
 assert.equal(added.at(-1).end,exactWindow.end,'the exact quote enters the payable cart with the selected return date');
 cart.items=[];cart.count=0;tools=useGafferTools();
 cart.items=existingItems;cart.count=existingCount;tools=useGafferTools();
 cart.items=[...existingItems,{...existingItems[0],key:'different-window',start:'2026-11-23',end:'2026-11-24'}];cart.count=2;tools=useGafferTools();
 const stockCallsBeforeMixedWindow=cartStockCalls.length,addedBeforeMixedWindow=added.length;
 assert.match(await tools.clientTools.find_gear({item:'FX3'}),/What dates should I check/,'multiple basket windows are ambiguous for date-level availability');
 assert.match(await tools.clientTools.add_to_basket({item:'Sony 16-35mm lens'}),/proposed kit/,'an added line with ambiguous basket windows stays undated instead of choosing one window');
 assert.equal(cartStockCalls.length,stockCallsBeforeMixedWindow,'ambiguous basket dates never trigger a guessed inventory lookup');
 assert.equal(added.length,addedBeforeMixedWindow,'ambiguous basket dates never add a line');
 cart.items=existingItems;cart.count=existingCount;tools=useGafferTools();
 const selected=await recommend.handler({db},{q:'Sony lens',category:'Lenses',cartListingIds:[camera._id],limit:6});
 const choices=[...selected.standalone,...selected.bundles];
 assert.equal(choices.length,1);assert.equal(choices[0].id,wide._id,'voice recommendations exclude bundled GM, aliases and incompatible mounts');
 await tools.clientTools.recommend_gear({item:'Sony lens',category:'Lenses'});
 assert.deepEqual(recommendArgs.cartListingIds,[camera._id],'real voice hook sends its actual basket context');
 cart.items[0].pickupTime='10:00';cart.items[0].returnTime='17:00';
 tools=useGafferTools();
 assert.match(await tools.clientTools.find_gear({item:'FX3',start:'2026-11-20',end:'2026-11-21'}),/1 free/);
 assert.equal(stockCalls.length,0);
 assert.equal(cartStockCalls.at(-1).items[0].pickupTime,'10:00');
 assert.equal(cartStockCalls.at(-1).items[0].returnTime,'17:00');
 cartStockMode='missing';
 const unknownStock=await tools.clientTools.find_gear({item:'FX3',start:'2026-11-20',end:'2026-11-21'});
 assert.match(unknownStock,/could not confirm stock/);
 assert.doesNotMatch(unknownStock,/booked out|free/,'An incomplete listing response is not invented as booked or available');
 cartStockMode='available';
 assert.match(await tools.clientTools.check_basket(),/available/);
 assert.match(tools.dynamicVariables.basket_availability,/availability unconfirmed/,'The model never infers stock from missing replacement rows');
 for(const mode of ['error','missing']){
   cartStockMode=mode;
   assert.match(await tools.clientTools.check_basket(),/could not be confirmed/);
   assert.match(await tools.clientTools.remove_unavailable(),/nothing was removed/);
   const uncertainCheckout=await tools.clientTools.go_to_checkout();
   assert.match(uncertainCheckout,/Full breakdown is on screen|Taking them to checkout/);
   assert.match(uncertainCheckout,/stock (?:is rechecked for those times|and the final price are rechecked) before payment/);
   assert.doesNotMatch(uncertainCheckout,/availability looks clear/i,'a failed date check must not be presented as available');
   assert.match(await tools.clientTools.review_basket(),/could not be confirmed/);
   assert.deepEqual(removed,[],'A failed or incomplete stock check cannot remove basket items');
 }
 cartStockMode='unavailable';
 assert.match(await tools.clientTools.remove_unavailable(),/Took/);
 assert.deepEqual(removed,['fx3-line'],'Only a confirmed unavailable line can be removed');
 cartStockMode='available';removed=[];
 cart.items[0].end='2026-11-21';
 cart.items[0].pickupTime='10:00';cart.items[0].returnTime='10:00';
 tools=useGafferTools();
 const stockCallsBeforeMinimum=stockCalls.length;
 const minimumAvailability=await tools.clientTools.find_gear({item:'DJI Mic 1',start:'2026-11-20',end:'2026-11-21'});
 assert.match(minimumAvailability,/2-day minimum/);
 assert.match(minimumAvailability,/dates cover 1 day/,'an exact 24-hour window remains one billable day');
 assert.equal(stockCalls.length,stockCallsBeforeMinimum,'Gaffer must not report one-day stock for a two-day-minimum listing');
 const minimumBasket=await tools.clientTools.add_to_basket({item:'DJI Mic 1',start:'2026-11-20',end:'2026-11-21'});
 assert.match(minimumBasket,/2-day minimum/);
 assert.match(minimumBasket,/haven't added it or changed your dates/);
 assert.equal(cart.items.some(item=>item.listingId===djiOne._id),false,'Gaffer must not silently extend a one-day rental to satisfy a listing minimum');
 cart.items[0].end='2026-11-22';
 cart.items[0].pickupTime=undefined;cart.items[0].returnTime=undefined;
 djiOne.pricing={daily:100,day3:60};djiOne.quietDeal=10;
 const pricedSearch=await search.handler({db},{q:'DJI Mic 1',limit:10});
 const pricedListing=pricedSearch.matches.find(item=>item.id===String(djiOne._id));
 assert.equal(pricedListing.daily,100);assert.equal(pricedListing.pricing.day3,90,'Voice catalogue applies the shared 10% three-day discount instead of an explicit conflicting Rental Manager rate');assert.equal(pricedListing.deal,undefined,'Voice catalogue ignores legacy automatic-deal data');
 const actualQuote=await tools.clientTools.add_to_basket({item:'DJI Mic 1',start:'2026-11-20',end:'2026-11-22'});
 assert.match(actualQuote,/complete basket rental subtotal after current pricing and any valid promo is £324\.00/,'speech reports the complete basket subtotal using the same three-day discount policy as checkout');
 assert.equal(priceQuoteCalls.at(-1).items.length,2,'the read-only quote contains all existing dated items plus the candidate');
 assert.equal(added.at(-1).total,270);assert.equal(added.at(-1).perDay,90);
 camera.pricing={daily:100};
 cart.promo='TENOFF';
 accountState={token:'member-token',me:{email:'member@example.invalid'}};
 tools=useGafferTools();
 const memberQuote=await tools.clientTools.add_to_basket({item:'DJI Mic 1',start:'2026-11-23',end:'2026-11-25'});
 assert.match(memberQuote,/complete basket rental subtotal after current pricing and any valid promo is £470\.00/,'speech reports whole-basket pricing when the existing weekend benefit beats the candidate-only Encore discount');
 assert.equal(added.at(-1).total,270,'the cart line retains the server-repriced base line value, not a basket-level discount');assert.equal(added.at(-1).perDay,90);
 assert.equal(priceQuoteCalls.at(-1).token,'member-token');
 assert.equal(priceQuoteCalls.at(-1).customerEmail,'member@example.invalid');
 assert.equal(priceQuoteCalls.at(-1).useAccountCredit,false,'credit stays off until the renter explicitly selects it at checkout');
 assert.equal(priceQuoteCalls.at(-1).items.length,2);
 assert.equal(priceQuoteCalls.at(-1).items[0].listingId,camera._id);
 assert.equal(priceQuoteCalls.at(-1).items[1].listingId,djiOne._id);
 assert.equal(priceQuoteCalls.at(-1).promoCode,'TENOFF','the complete quote carries the current promo');
 assert.equal(priceQuoteCalls.at(-1).selectedMembership,undefined,'an active member is not assigned a new membership');
 assert.equal(priceQuoteBenefits.at(-1),'weekend','checkout selects the best basket-wide benefit');
 const memberOnlyAccount={membershipActive:true,membershipTier:'pro',membershipStatus:'active',membershipPaidThrough:Date.now()+30*86400000,stripeSubscriptionId:'sub-fixture',firstRentalPaidAt:Date.now()-86400000,firstCleanRentalCompletedAt:Date.now()-86400000,loyaltyEligible:true,loyaltyPercent:10};
 assert.equal(rentalBenefits.bestBenefit(rentalBenefits.memberRentalBenefitCandidates({account:memberOnlyAccount,subtotalPence:18000,weekendSavingPence:0})).kind,'loyalty','candidate-only pricing would select Encore instead');
 const paidBeforeFirstRental={...memberOnlyAccount,firstRentalPaidAt:Date.now(),firstCleanRentalCompletedAt:undefined,loyaltyEligible:false,loyaltyPercent:0};
 assert.equal(rentalBenefits.memberRentalBenefitCandidates({account:paidBeforeFirstRental,subtotalPence:18000,weekendSavingPence:500}).find(candidate=>candidate.kind==='weekend').savingPence,0,'a paid subscription and first paid booking before a clean return grant no recurring rental perk');
 assert.doesNotMatch(memberQuote,/member@example\.invalid|member-token/,'the voice response does not expose account identifiers');
 accountState={};
 cart.items=[];cart.count=0;cart.promo='GUEST10';cart.membership={tier:'plus',intro:'none'};
 tools=useGafferTools();
 const guestQuote=await tools.clientTools.add_to_basket({item:'DJI Mic 1',start:'2026-11-20',end:'2026-11-22'});
 assert.match(guestQuote,/complete basket rental subtotal after current pricing and any valid promo is £260\.00/,'guest remains on public pricing while valid promo and selected membership context are quoted');
 assert.equal(added.at(-1).total,270);
 assert.equal(priceQuoteCalls.at(-1).token,undefined,'guest quote does not send an account token');
 assert.equal(priceQuoteCalls.at(-1).customerEmail,'');
 assert.equal(priceQuoteCalls.at(-1).promoCode,'GUEST10');
 assert.deepEqual(priceQuoteCalls.at(-1).selectedMembership,{tier:'plus',intro:'none'});
 assert.equal(priceQuoteCalls.at(-1).useAccountCredit,false);
 assert.equal(priceQuoteBenefits.at(-1),'promo','guest pricing only uses its explicit promo, not member-only benefits');
 const beforeQuoteFailure=added.length;priceQuoteMode='error';
 assert.match(await tools.clientTools.add_to_basket({item:'DJI Mic 1',start:'2026-11-20',end:'2026-11-22'}),/couldn't confirm the complete basket price/);
 assert.equal(added.length,beforeQuoteFailure,'a quote outage leaves the basket unchanged');
 priceQuoteMode='available';
 const addedBeforeMissingPrice=added.length;
 djiOne.pricing=undefined;
 assert.match(await tools.clientTools.add_to_basket({item:'DJI Mic 1',start:'2026-11-20',end:'2026-11-22'}),/couldn't confirm the current rental price/);
 assert.equal(added.length,addedBeforeMissingPrice,'Missing authoritative pricing never adds a zero-priced item');
 djiOne.pricing={daily:20};djiOne.quietDeal=undefined;
 setMock('@/lib/site',load('src/lib/site.ts'));
 setMock('@/lib/ratelimit',{rateLimit:async()=>({allowed:true})});
 let providerFailure=false, failedPool=null;
 const liveFx3Quote=listing({...LIVE_FX3_BODY_KIT,pricing:{...LIVE_FX3_BODY_KIT.pricing},inventoryFacts:{...LIVE_FX3_BODY_KIT.inventoryFacts,contents:[...LIVE_FX3_BODY_KIT.inventoryFacts.contents],optionalContents:[...LIVE_FX3_BODY_KIT.inventoryFacts.optionalContents]},components:[{inventoryUnitId:'body',qty:1}]});
 const mic=listing({slug:'rode-pro',title:'Rode Wireless Mic Pro set',itemType:'wireless-mic',category:'Audio',inventoryFacts:{owned:true,contents:['1 × Rode Wireless Mic Pro set']},pricing:{daily:26,day3:20},components:[{inventoryUnitId:'mic-pool',qty:1}]});
 const lens=listing({slug:'sony-24-70',title:'Sony FE 24-70mm GM Lens',itemType:'lens',category:'Lenses',inventoryFacts:{owned:true,contents:['1 × Sony FE 24-70mm GM Lens']},pricing:{daily:18,day3:14},components:[{inventoryUnitId:'lens-pool',qty:1}]});
 lens.specs={mount:'Sony E',filterThreadMm:82};
 const filter=listing({slug:'82mm-vnd',title:'82mm Variable ND Filter',itemType:'nd-filter',category:'Accessories',inventoryFacts:{owned:true,contents:['1 × 82mm Variable ND Filter']},pricing:{daily:12,day3:9},components:[{inventoryUnitId:'filter-pool',qty:1}]});
 filter.specs={filterThreadMm:82};
 const quoteListings=[liveFx3Quote,pair,mic,djiOne,lens,filter];
 let phoneRecommendationReads=0;
 setMock('convex/browser',{ConvexHttpClient:class{async query(name,args){
   if(name==='settings.get')return{};
   if(name==='liveRecommendations.options'){phoneRecommendationReads++;return{groups:Object.fromEntries(args.groups.map(group=>{const candidate=group.types.includes('lens')?lens:group.types.includes('nd-filter')?filter:null;return[group.key,{options:candidate?[{_id:candidate._id,listingId:candidate._id,slug:candidate.slug,title:candidate.title,itemType:candidate.itemType,pricing:candidate.pricing,specs:candidate.specs,inventoryFacts:candidate.inventoryFacts,available:true,automaticEligible:true}]:[]}]}))};}
   if(name==='voiceCatalog.search'){const item=/dji/i.test(args.q)?djiOne:/rode|mic/i.test(args.q)?mic:liveFx3Quote;return{matches:[{id:item._id,slug:item.slug,title:item.title,daily:item.pricing.daily,minDays:item.minimumRentalDays??1}]};}
   if(name==='catalog.getListingBySlug')return quoteListings.find(item=>item.slug===args.slug)??null;
   if(name==='catalog.byItemType')return quoteListings.filter(item=>args.types.includes(item.itemType));
   if(['catalog.listListings','catalog.listingsByIds'].includes(name))return quoteListings;
   if(name==='availability.forListing'){if(providerFailure)throw Error('controlled outage');stockCalls.push(args);return{available:1}};
   if(name==='availability.forTimeSlots'){
     if(providerFailure)throw Error('controlled outage');
     const target=quoteListings.find(item=>item._id===args.listingId), pool=target.components[0].inventoryUnitId;
     if(pool===failedPool)throw Error('controlled pool outage');
     const used=(args.items??[]).reduce((sum,item)=>{const listing=quoteListings.find(row=>row._id===item.listingId);return sum+(listing?.components??[]).filter(component=>component.inventoryUnitId===pool).reduce((n,component)=>n+component.qty*(item.qty??1),0)},0);
     return{available:Math.max(0,(pool==='body'?2:1)-used)};
   }
   if(name==='availability.forCheckoutTimeSlots'){
     const totals=new Map();
     for(const item of args.items){const listing=quoteListings.find(row=>row._id===item.listingId);for(const component of listing?.components??[])totals.set(component.inventoryUnitId,(totals.get(component.inventoryUnitId)??0)+component.qty*(item.qty??1));}
     const fits=[...totals].every(([pool,qty])=>qty<=(pool==='body'?2:1));
     return{validPairs:fits?[{pickupTime:'10:00',returnTime:'18:00'}]:[]};
   }
   if(name==='availability.forCart')return Object.fromEntries(args.items.map(item=>[item.listingId,{ok:true,available:1,demanded:item.qty}]));
   throw Error(name);
 } async mutation(name,args){return saveLead(name,args)}}});
 for(const [alias,file]of Object.entries({'@/lib/membership':'src/lib/membership.ts','@/lib/mount':'src/lib/mount.ts','@/lib/compat':'src/lib/compat.ts','@/lib/kitRank':'src/lib/kitRank.ts'}))setMock(alias,load(file));
 setMock('@/lib/ai',{generateBotObject:async()=>{throw Error('Phone quote must not make another model call')}});
 setMock('@/lib/gaffer',load('src/lib/gaffer.ts'));
 process.env.VOICE_WEBHOOK_SECRET='isolated-voice-fixture';
 process.env.NEXT_PUBLIC_CONVEX_URL='https://fixture.convex.cloud';
 const voice=load('src/app/api/voice/route.ts');
 assert.equal((await voice.GET()).status,200,'voice webhook health is healthy only when its server dependencies are configured');
 const configuredSecret=process.env.VOICE_WEBHOOK_SECRET,configuredConvexUrl=process.env.NEXT_PUBLIC_CONVEX_URL;
 delete process.env.VOICE_WEBHOOK_SECRET;
 assert.equal((await voice.GET()).status,503,'voice webhook health fails closed when the shared secret is missing');
 process.env.VOICE_WEBHOOK_SECRET=configuredSecret;
 delete process.env.NEXT_PUBLIC_CONVEX_URL;
 assert.equal((await voice.GET()).status,503,'voice webhook health fails closed when Convex is not configured');
 process.env.NEXT_PUBLIC_CONVEX_URL=configuredConvexUrl;
 delete process.env.NEXT_PUBLIC_CONVEX_URL;
 const missingConvex=await voice.POST({url:'https://fixture.invalid/api/voice',headers:new Headers({'x-voice-secret':process.env.VOICE_WEBHOOK_SECRET}),json:async()=>({name:'check_availability',args:{item:'FX3'}})});
 assert.equal(missingConvex.status,503,'a voice tool call reports missing Convex config as unavailable before constructing the client');
 process.env.NEXT_PUBLIC_CONVEX_URL=configuredConvexUrl;
 const webhook=async(args,name='check_availability')=>(await voice.POST({url:'https://fixture.invalid/api/voice',headers:new Headers({'x-voice-secret':process.env.VOICE_WEBHOOK_SECRET}),json:async()=>({name,args})})).json();
 const phoneLead=await webhook({name:'Phone caller',message:'Synthetic callback'},'request_callback');assert.equal(phoneLead.lead_saved,true);assert.equal(phoneLead.needs,'contact');
 leadFails=true;const failedPhoneLead=await webhook({name:'Phone caller',message:'Synthetic callback'},'request_callback');assert.equal(failedPhoneLead.lead_saved,false);assert.match(failedPhoneLead.result,/couldn't save/i);leadFails=false;
 assert.equal(leadJobs.length,2,'Both actual caller paths save a lead; failed calls do not claim success');
 const before=stockCalls.length;
 let spoken=await webhook({item:'FX3',start:'2026-11-20',end:'2026-11-21'});
 assert.equal(spoken.enquiry.complete,true,'a date-only phone query checks exact quantity against a compatible time window');
 assert.equal(spoken.enquiry.availabilityWindow.suggested,true);
 assert.match(spoken.result,/possible window .*pickup at 10:00 and return at 18:00/i);
 assert.match(spoken.result,/hire estimate is £94 for 2 days/i);
 assert.match(spoken.result,/confirm availability once you choose them/i);
 assert(!/available on 20 November/i.test(spoken.result),'date-only phone enquiries must not claim availability at times the caller has not selected');
 assert.equal(spoken.enquiry.recommendedAddOn,undefined,'an ordinary price or availability question does not automatically add another item');
 assert.equal(phoneRecommendationReads,0,'a price-only call does not run the optional add-on lookup');
 assert.equal(spoken.enquiry.total,94,'the price-only response quotes the requested camera alone');
 spoken=await webhook({item:'FX3',start:'2026-11-20',end:'2026-11-21',allowOptionalAddOns:true});
 assert.equal(spoken.enquiry.recommendedAddOn?.listingId,lens._id,'the phone tool can return the same live-checked lens suggestion');
 assert.equal(phoneRecommendationReads,1);
 assert.equal(spoken.enquiry.total,94,'the optional lens does not change the requested camera total');
 assert.equal(spoken.enquiry.recommendedAddOn.total,36);
 assert.match(spoken.result,/Optional compatible lens: Sony FE 24-70mm GM Lens fits the camera's mount and is available for £36/);
 assert.equal(spoken.items.some(item=>item.title===lens.title),false,'an optional suggestion is not misreported as requested gear');
 spoken=await webhook({item:'FX3',start:'2026-11-20',end:'2026-11-21',allowOptionalAddOns:false});
 assert.equal(spoken.enquiry.recommendedAddOn,undefined,'the voice tool respects an explicit add-on opt-out');
 assert.equal(phoneRecommendationReads,1,'an opted-out caller does not trigger the lens lookup');
 spoken=await webhook({item:'FX3 camera body only, no lens',start:'2026-11-20',end:'2026-11-21'},'get_price');
 assert.equal(spoken.enquiry.recommendedAddOn,undefined,'explicit wording in the caller item suppresses the optional lens');
 assert.equal(phoneRecommendationReads,1,'raw item wording is checked before normalization strips an explicit restriction');
 assert.equal(stockCalls.length,before,"date-only stock uses the shared time-window availability query");
 spoken=await webhook({item:'FX 3',start:'2026-11-03',end:'2026-11-03',pickup_time:'10:00',return_time:'18:00',allowOptionalAddOns:false},'get_price');
 assert.equal(spoken.enquiry.requests[0].lines[0].listingId,liveFx3Quote._id,'the phone quote selects the same live FX3 listing used by the email quote');
 assert.equal(spoken.enquiry.requests[0].lines[0].slug,LIVE_FX3_BODY_KIT.slug);
 assert.equal(spoken.enquiry.complete,true);assert.equal(spoken.enquiry.total,47);
 assert.equal(spoken.enquiry.recommendedAddOn,undefined);
 assert.match(spoken.result,/Sony FX3 camera body/);
 assert.equal(spoken.result,'I found one Sony FX3 camera body for 3 November, with 10:00 pickup and 18:00 return. Gear hire is £47 for the day. Would you like to book it? We’ll check the stock again at checkout.','phone quotes use a concise, natural confirmation for the exact camera-only request');
 assert(!/a7 III|gimbal|24-70/i.test(spoken.result),'the phone quote must not substitute a bundle for the requested body');
 spoken=await webhook({item:'FX3 camera body only, no lens',start:'2026-11-01',end:'2026-11-01',pickup_time:'10:00',return_time:'18:00',allowOptionalAddOns:false},'get_price');
 assert.equal(spoken.enquiry.equipmentTotal,47);
 assert.equal(spoken.enquiry.sameDayFee,4.7,'London pickup today receives the 10% fee');
 assert.equal(spoken.enquiry.total,51.7,'the phone quote total includes today’s fee');
 assert.match(spoken.result,/£47\.00 equipment \+ £4\.70 same-day fee = £51\.70/,'the spoken quote itemizes today’s surcharge');
 spoken=await webhook({item:'FX3 camera body only, no lens',start:'2026-11-02',end:'2026-11-02',pickup_time:'10:00',return_time:'18:00',allowOptionalAddOns:false},'get_price');
 assert.equal(spoken.enquiry.sameDayFee,0,'a London pickup tomorrow has no same-day fee');
 assert.equal(spoken.enquiry.total,47);
 const ownedBodyFacts=liveFx3Quote.inventoryFacts;
 liveFx3Quote.inventoryFacts={owned:false};
 spoken=await webhook({item:'FX3 camera body only, no lens',start:'2026-11-03',end:'2026-11-03',pickup_time:'10:00',return_time:'18:00',allowOptionalAddOns:false},'get_price');
 assert.equal(spoken.enquiry.requests[0].lines.length,0,'a cage kit cannot fulfill a strict body-only request when the bare body is not owned');
 assert.equal(spoken.enquiry.complete,false);
 assert.equal(spoken.enquiry.total,null);
 liveFx3Quote.inventoryFacts=ownedBodyFacts;
 spoken=await webhook({item:'Sony FE 24-70mm GM Lens',start:'2026-11-03',end:'2026-11-03',pickup_time:'10:00',return_time:'18:00',allowOptionalAddOns:true},'get_price');
 assert.equal(spoken.enquiry.requests[0].lines[0].listingId,lens._id);
 assert.equal(spoken.enquiry.recommendedAddOn?.listingId,filter._id,'phone recommends a live compatible ND filter for a requested lens');
 assert.equal(spoken.enquiry.total,18,'the filter remains separate from the requested lens total');
 assert.match(spoken.result,/Optional compatible ND filter: 82mm Variable ND Filter matches the lens's filter thread and is available for £12/);
 spoken=await webhook({item:'FX3',start:'2026-11-20',end:'2026-11-21',pickup_time:'10:00',return_time:'17:00'});
 assert.equal(spoken.enquiry.complete,true);assert.equal(spoken.enquiry.days,2);assert.equal(spoken.enquiry.total,94);assert(!/security|deposit|card hold/i.test(spoken.result),'a rental quote must not include refundable money');
 assert.equal(stockCalls.at(-1).pickupTime,'10:00');assert.equal(stockCalls.at(-1).returnTime,'17:00');
 spoken=await webhook({item:'FX 3',start:'2026-11-03',end:'2026-11-04',pickup_time:'17:00',return_time:'09:00'},'get_price');
 assert.equal(spoken.enquiry.days,1);assert.equal(spoken.enquiry.total,47,'overnight under 24h uses the same daily charge as email');
 const stockReadsBeforeMinimum=stockCalls.length;
 spoken=await webhook({item:'DJI Mic 1',start:'2026-11-03',end:'2026-11-04',pickup_time:'17:00',return_time:'09:00'},'get_price');
 assert.equal(spoken.enquiry.days,1,'an overnight period under 24 hours is one rental day even when calendar dates differ');
 assert.equal(spoken.enquiry.requests[0].minimumRentalOffer.minimumDays,2);
 assert.equal(spoken.enquiry.total,null,'the requested one-day quote must not be stretched to the listing minimum');
 assert(stockCalls.length>stockReadsBeforeMinimum,'the phone assistant checks a valid longer period');
 assert.equal(stockCalls.at(-1).end,Date.parse('2026-11-05T00:00:00Z'),'the overnight proposal adds a day while preserving the return time');
 assert.equal(spoken.enquiry.requests[0].minimumRentalOffer.availability,'available');
 assert.match(spoken.result,/2-day minimum/);
 assert.match(spoken.result,/available with return at 09:00 on 5 November 2026/);
 assert.match(spoken.result,/Would that later return work for you/);
 spoken=await webhook({item:'FX 3',start:'2026-11-03',end:'2026-11-06',pickup_time:'10:00',return_time:'10:00'},'get_price');
 assert.equal(spoken.enquiry.days,3);assert.equal(spoken.enquiry.total,127,'phone applies the canonical 10% three-day discount and rounds the rental total up once');
 spoken=await webhook({item:'two FX3',start:'2026-11-03',end:'2026-11-03',pickup_time:'10:00',return_time:'18:00'},'get_price');
 assert.equal(spoken.enquiry.requests[0].quantity,2);assert.equal(spoken.enquiry.requests[0].lines[0].quantity,1);assert.equal(spoken.enquiry.total,92,'two cameras are one documented two-body package');
 const window={start:'2026-11-03',end:'2026-11-03',pickup_time:'10:00',return_time:'18:00'};
 spoken=await webhook({...window,item:'4 wireless microphone kits'},'get_price');
 assert.equal(spoken.enquiry.requests[0].fulfilled,1,'the real available microphone kit remains usable');
 assert(spoken.enquiry.requests[0].lines.every(line=>/mic/i.test(line.title)),'microphone requests can only be fulfilled by microphone listings');
 assert(!/camera|fx3/i.test(spoken.result),'unrelated equipment must never fulfil a microphone request');
 assert.equal(spoken.enquiry.complete,false,'one microphone kit cannot fulfil four requested kits');
 assert.match(spoken.result,/1 of 4 wireless microphone kits/,'verified shortfall is stated as a concrete quantity');
 assert(!/quantities still need confirmation/.test(spoken.result));
 spoken=await webhook({...window,requests:[{subject:'FX3',quantity:1},{subject:'Rode Wireless Mic Pro set',quantity:1}]},'get_price');
 assert.equal(spoken.enquiry.complete,true);assert.equal(spoken.enquiry.requests.length,2);assert.equal(spoken.enquiry.total,73,'both distinct requirements share one verified basket and real prices');
 spoken=await webhook({...window,item:'FX3',quantity:1,item_2:'Rode Wireless Mic Pro set',quantity_2:1,quantityIsListingUnits_2:true,allowAlternatives_2:false},'get_price');
 assert.equal(spoken.enquiry.complete,true);assert.equal(spoken.enquiry.requests.length,2);assert.equal(spoken.enquiry.total,73,'the local scalar-slot route combines distinct items against one shared basket');
 assert.match(spoken.result,/Sony FX3 camera body/);assert.match(spoken.result,/Rode Wireless Mic Pro set/);assert.match(spoken.result,/gear hire is £73/i,'the caller hears one concise combined gear-only total for the verified list');
 spoken=await webhook({...window,item:'FX3',quantity:1,quantityIsListingUnits:false},'get_price');
 assert.equal(spoken.needs,'quantity','the first item must preserve an explicit unit-versus-kit clarification');
 spoken=await webhook({...window,item:'FX3',quantity:1,item_2:'Rode Wireless Mic Pro set',quantity_2:1,quantity_3:1},'get_price');
 assert.equal(spoken.needs,'items','a quantity for an omitted second item cannot be silently dropped');
 spoken=await webhook({...window,item:'FX3',quantity:1,item_2:'Rode Wireless Mic Pro set',quantity_2:1,quantityIsListingUnits_2:'yes'},'get_price');
 assert.equal(spoken.needs,'quantity','listing-unit clarification must be a boolean');
 spoken=await webhook({...window,requests:[{subject:'Rode Wireless Mic Pro set',quantity:1},{subject:'Rode Wireless Mic Pro set',quantity:1}]},'get_price');
 assert.equal(spoken.enquiry.complete,false);assert.deepEqual(spoken.enquiry.requests.map(request=>request.fulfilled),[1,0],'one physical microphone set cannot satisfy two separate requests');
 spoken=await webhook({...window,requests:[{subject:'FX3'},{subject:'Rode Wireless Mic Pro set'}],requirementsComplete:false},'get_price');
 assert.equal(spoken.enquiry.complete,false,'unparsed requirements cannot become a whole-enquiry assurance');
 spoken=await webhook({...window,item:'FX3 and a microphone'},'get_price');assert.equal(spoken.needs,'configuration','combined free text must not drop the second item');
 spoken=await webhook({item:'FX3',start:'2026-11-03',pickup_time:'10:00',return_time:'18:00'});assert.equal(spoken.needs,'dates','a return date is required before asserting stock');
 failedPool='mic-pool';
 spoken=await webhook({...window,requests:[{subject:'FX3',quantity:1},{subject:'Rode Wireless Mic Pro set',quantity:1}]},'get_price');
 assert.equal(spoken.enquiry.stockVerified,true,'the successfully checked items remain verified');
 assert.match(spoken.result,/I can supply 1 Sony FX3 camera body/);assert.match(spoken.result,/I couldn't verify stock for Rode Wireless Mic Pro set/);assert.match(spoken.result,/Confirmed gear hire is £47/);assert.match(spoken.result,/I can recheck the stock if you like/);assert(!/0 of 1/.test(spoken.result));
 failedPool=null;providerFailure=true;
 spoken=await webhook({item:'FX3',start:'2026-11-20',end:'2026-11-21',pickup_time:'10:00',return_time:'17:00'});
 assert.equal(spoken.needs,'availability');assert(!spoken.result.includes('already booked'));
 console.log('PASS Gaffer browser and phone quote paths: shared multi-item basket checks, one-day minimum enforcement, exact 24-hour billing, BOM context, alias deduplication, mount fit, incomplete-time gate and exact clock forwarding. Controlled catalogue transport; no call, messages or financial execution.');
})().catch(error=>{console.error(error);process.exitCode=1});
