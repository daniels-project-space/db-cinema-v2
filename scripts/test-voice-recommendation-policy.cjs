const assert=require('node:assert/strict');
const {load,setMock,put,db}=require('./lib/rentalTestHarness.cjs');
const gafferVoiceQuoteTools=require('./lib/gafferVoiceQuoteTools.cjs');
const {LIVE_FX3_BODY_KIT}=require('./lib/gafferLiveCatalogueFixtures.cjs');
for(const [name,file] of Object.entries({'@/lib/pricing':'src/lib/pricing.ts','@/lib/dates':'src/lib/dates.ts','@/lib/voiceDates':'src/lib/voiceDates.ts'}))setMock(name,load(file));
const listing=data=>put('listings',{active:true,category:'Lenses',stockMappingStatus:'complete',pricing:{daily:20},r2Images:['https://example.invalid/item.jpg'],...data});
const camera=listing({slug:'fx3',title:'Sony FX3 and 24–70mm GM lens',category:'Cameras',itemType:'camera-body',specs:{mount:'E',coverage:'ff',includesLens:true,lensFocal:'24-70'},components:[{inventoryUnitId:'body',qty:1},{inventoryUnitId:'gm',qty:1}]});
const djiOne=listing({slug:'dji-mic-1',title:'DJI Mic 1 Wireless Set',category:'Audio',itemType:'wireless-mic',minimumRentalDays:2,inventoryFacts:{owned:true,contents:['1 × DJI Mic 1 wireless set']},components:[{inventoryUnitId:'dji1',qty:1}]});
const gm=listing({slug:'gm',title:'Sony 24-70mm GM lens',itemType:'lens',demandScore:999,specs:{mount:'E',coverage:'ff',lensFocal:'24-70',tier:'premium',lensClass:'af'},components:[{inventoryUnitId:'gm',qty:1}]});
const wide=listing({slug:'wide',title:'Sony 16-35mm GM lens',itemType:'lens',demandScore:100,specs:{mount:'E',coverage:'ff',lensFocal:'16-35',tier:'premium',lensClass:'af'},components:[{inventoryUnitId:'wide',qty:1}]});
listing({...wide,_id:'wide-alias',components:wide.components});
listing({slug:'wrong',title:'Sony 16-35mm RF lens',itemType:'lens',demandScore:1000,specs:{mount:'RF',coverage:'ff'},components:[{inventoryUnitId:'wrong',qty:1}]});
const recommend=load('convex/voiceCatalog.ts').recommend;
const cart={items:[{key:'fx3-line',listingId:camera._id,title:camera.title,start:'2026-11-20',end:'2026-11-21'}],count:1,subtotal:20,depositTotal:100,close(){},open(){},has(id){return this.items.some(i=>i.listingId===id)}};
let stockCalls=[],recommendArgs;
const convex={query:async(name,args)=>{
 if(name==='voiceCatalog.search'){const item=/dji/i.test(args.q)?djiOne:camera;return{matches:[{id:item._id,slug:item.slug,title:item.title,daily:20,minDays:item.minimumRentalDays??1}]};}
 if(name==='voiceCatalog.recommend'){recommendArgs=args;return recommend.handler({db},args)}
 if(name==='availability.forListing'){stockCalls.push(args);return{available:1}}
 if(name==='availability.forCart')return{[camera._id]:{ok:true}};
 if(name==='cartReplacements.forCart')return{};
 throw Error('Unexpected query '+name);
}};
setMock('@cvx/lib/gafferDiscount',load('convex/lib/gafferDiscount.ts'));
setMock('react',{useRef:current=>({current}),useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:()=>{}});
setMock('next/navigation',{useRouter:()=>({push(){}})});
setMock('convex/react',{useConvex:()=>convex,useQuery:(name)=>name==='settings.get'?{assessmentSecurityEnabled:true}:name==='catalog.listListings'?[camera,gm,wide]:{}});
setMock('@/components/cart/CartProvider',{useCart:()=>cart});
setMock('@/components/account/AccountProvider',{useAccount:()=>({})});
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
 const bodyKit=listing({slug:'fx3-cage-kit',title:'Sony FX 3 Body Kit with Cage',itemType:'camera-body',category:'Cameras',pricing:{daily:47}});
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
 assert(!searched.matches.some(item=>[otherModel._id,comparison._id].includes(item.id)),'FX30 and comparison advertising cannot pass an FX3 identity check');
 assert(!searched.matches.some(item=>unavailableListings.some(row=>row._id===item.id)),'Gaffer search must exclude marketing, display-only, unowned, and unmapped stock');
 const browsed=await load('convex/voiceCatalog.ts').browse.handler({db},{q:'Sony cameras',limit:100});
 assert(!browsed.items.some(item=>unavailableListings.some(row=>row.title===item.title)),'Gaffer browse must use the same safe catalogue gate as exact search');
 const voiceRecommendations=await recommend.handler({db},{q:'Sony camera',category:'Cameras',limit:12});
 assert(![...voiceRecommendations.standalone,...voiceRecommendations.bundles].some(item=>unavailableListings.some(row=>row._id===item.id)),'voice recommendations must not surface non-rentable catalogue rows');
 assert.equal((await search.handler({db},{q:'two FX3',limit:3})).matches[0].id,pair._id,'two requested bodies prefer the documented two-body configuration');
 const {equipmentRequest}=load('shared/equipmentIdentity.ts');
 assert.equal(equipmentRequest('24-70mm lens').quantity,1);assert.equal(equipmentRequest('DJI Mic 2').quantity,1);assert.equal(equipmentRequest('4x complete mic kits').quantity,4);
 let tools=useGafferTools();
 const unconfirmed=await tools.clientTools.find_gear({item:'FX3',start:'2026-11-20',end:'2026-11-21'});
 assert.match(unconfirmed,/choose pickup and return dates and times/);assert(!unconfirmed.includes('1 free'));assert.equal(stockCalls.length,0);
 assert.match(await tools.clientTools.check_basket(),/Choose pickup and return times/);
 assert.match(tools.dynamicVariables.basket_availability,/availability unconfirmed/);
 assert.match(await tools.clientTools.go_to_checkout(),/Choose pickup and return times/);
 const selected=await recommend.handler({db},{q:'Sony lens',category:'Lenses',cartListingIds:[camera._id],limit:6});
 const choices=[...selected.standalone,...selected.bundles];
 assert.equal(choices.length,1);assert.equal(choices[0].id,wide._id,'voice recommendations exclude bundled GM, aliases and incompatible mounts');
 await tools.clientTools.recommend_gear({item:'Sony lens',category:'Lenses'});
 assert.deepEqual(recommendArgs.cartListingIds,[camera._id],'real voice hook sends its actual basket context');
 cart.items[0].pickupTime='10:00';cart.items[0].returnTime='17:00';
 tools=useGafferTools();
 assert.match(await tools.clientTools.find_gear({item:'FX3',start:'2026-11-20',end:'2026-11-21'}),/1 free/);
 assert.equal(stockCalls.length,1);assert.equal(stockCalls[0].pickupTime,'10:00');assert.equal(stockCalls[0].returnTime,'17:00');
 assert.match(await tools.clientTools.check_basket(),/available/);
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
 }}});
 for(const [alias,file]of Object.entries({'@/lib/membership':'src/lib/membership.ts','@/lib/mount':'src/lib/mount.ts','@/lib/compat':'src/lib/compat.ts','@/lib/kitRank':'src/lib/kitRank.ts'}))setMock(alias,load(file));
 setMock('@/lib/ai',{generateBotObject:async()=>{throw Error('Phone quote must not make another model call')}});
 setMock('@/lib/gaffer',load('src/lib/gaffer.ts'));
 process.env.VOICE_WEBHOOK_SECRET='isolated-voice-fixture';
 const voice=load('src/app/api/voice/route.ts');
 const webhook=async(args,name='check_availability')=>(await voice.POST({url:'https://fixture.invalid/api/voice',headers:new Headers({'x-voice-secret':process.env.VOICE_WEBHOOK_SECRET}),json:async()=>({name,args})})).json();
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
 assert.equal(stockCalls.length,stockReadsBeforeMinimum,'the phone assistant does not assert stock for an invalid one-day period');
 assert.match(spoken.result,/2-day minimum/);
 assert.match(spoken.result,/haven't checked stock for that longer period/);
 spoken=await webhook({item:'FX 3',start:'2026-11-03',end:'2026-11-06',pickup_time:'10:00',return_time:'10:00'},'get_price');
 assert.equal(spoken.enquiry.days,3);assert.equal(spoken.enquiry.total,132,'phone uses the current live listing day-three rate, not daily × calendar days');
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
