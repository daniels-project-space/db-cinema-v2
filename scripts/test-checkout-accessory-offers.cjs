const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
setMock('./lib/shared_stock_sync',{hasFreshSharedStock:async ctx=>ctx.stockFresh!==false});
setMock('./lib/rentalInventory',{assertRentalInventory:async(ctx,lines)=>{
  const candidate=lines.at(-1);
  if(ctx.unavailable?.has(String(candidate.listingId)))throw Error('unavailable');
}});
const policy=load('shared/checkoutAccessoryOffer.ts');
const allocation=load('shared/checkoutAccessoryAllocation.ts');
const catalog=load('convex/catalog.ts');
const pricing=load('convex/lib/rentalPrice.ts');
const recommendations=load('convex/liveRecommendations.ts');

const start=Date.UTC(2027,0,1), end=Date.UTC(2027,0,1);
const camera=put('listings',{active:true,title:'Sony FX3 camera body',itemType:'camera-body',category:'Cameras',pricing:{daily:200},depositAmount:50,
  components:[{inventoryUnitId:'unit-camera',qty:1}],stockMappingStatus:'complete',inventoryFacts:{owned:true,reviewRequired:false},sourceImages:['https://images.example.test/fx3.jpg']});
const addon=(title,price,demandScore=0,type='accessory')=>put('listings',{active:true,title,itemType:type,category:'Accessories',pricing:{daily:price},depositAmount:0,
  components:[{inventoryUnitId:`unit-${title}`,qty:1}],stockMappingStatus:'complete',inventoryFacts:{owned:true,reviewRequired:false},sourceImages:[`https://images.example.test/${encodeURIComponent(title)}.jpg`],demandScore});
const addOns=[addon('SmallRig FX3 camera cage',40,5),addon('FX3 camera monitor mount',35,4),addon('FX3 camera side handle',30,3),addon('FX3 camera top handle',25,2),addon('FX3 camera cable clamp',22,1),addon('FX3 camera battery',20,0,'battery')];
const namedAccessory=addon('Universal camera cage',28,100);
const unverifiedAccessory=addon('Universal body mount',27,90);
const unrelatedAccessory=addon('Universal lens pouch',26,80);
const light50=addon('Aputure 60D light',50,0,'light');
const light150=addon('Aputure 600D light',150,0,'light');
put('listings',{active:true,title:'Sony FX3 camera and RS3 gimbal package',itemType:'camera-body',category:'Packages',pricing:{daily:250},depositAmount:100,
  components:[{inventoryUnitId:'unit-camera',qty:1},{inventoryUnitId:`unit-${namedAccessory.title}`,qty:1}],stockMappingStatus:'complete',
  inventoryFacts:{owned:true,reviewRequired:false},rentalContents:{included:['DJI RS3 Pro gimbal']}});
put('listings',{active:true,title:'Unverified Sony FX3 and gimbal package',itemType:'camera-body',category:'Packages',pricing:{daily:250},depositAmount:100,
  components:[{inventoryUnitId:'unit-camera',qty:1},{inventoryUnitId:`unit-${unverifiedAccessory.title}`,qty:1}],stockMappingStatus:'complete',
  inventoryFacts:{owned:true,reviewRequired:true},rentalContents:{included:['DJI RS3 Pro gimbal']}});
const lens=put('listings',{active:true,title:'Sony 24-70mm G Master lens',itemType:'lens',category:'Lenses',pricing:{daily:100},depositAmount:50,
  components:[{inventoryUnitId:'unit-lens',qty:1}],stockMappingStatus:'complete',inventoryFacts:{owned:true,reviewRequired:false}});
const basket=[{listingId:camera._id,start,end,pickupTime:'09:00',returnTime:'18:00'}];

assert.equal(policy.checkoutAccessoryPercent(149.99),null);
assert.equal(policy.checkoutAccessoryPercent(150),30);
assert.equal(policy.checkoutAccessoryPercent(249.99),30);
assert.equal(policy.checkoutAccessoryPercent(250),40);
assert.equal(policy.checkoutAccessoryPercent(349.99),40);
assert.equal(policy.checkoutAccessoryPercent(350),50);
assert.equal(policy.checkoutAccessoryPercent(400),50);
assert.equal(policy.checkoutAccessoryPercent(900),50);
assert.equal(policy.isCheckoutAccessory({itemType:'camera-body'}),false);
assert.equal(policy.isCheckoutAccessory({itemType:'lens'}),false);
assert.equal(policy.isCheckoutAccessory({itemType:'battery'}),false);
assert.equal(policy.isCheckoutAccessory({itemType:'accessory'}),true);
assert.equal(policy.isCheckoutAccessory({itemType:'accessory',catalogItemType:null}),false,'a derived fallback must not make an unknown catalogue listing an offerable accessory');
assert.equal(policy.checkoutAccessoryCompatible({title:'SmallRig FX3 camera cage',itemType:'accessory'},[{title:'Sony FX3 camera body',itemType:'camera-body'}]),true);
assert.equal(policy.checkoutAccessoryCompatible({title:'Canon C70 cage',itemType:'accessory'},[{title:'Sony FX3 camera body',itemType:'camera-body'}]),false);
assert.equal(policy.checkoutAccessoryCompatible({title:'Universal camera cage',itemType:'accessory'},[{title:'Sony FX3 camera body',itemType:'camera-body'}]),false,'name-only generic accessories need verified physical pairing evidence');
assert.equal(policy.checkoutAccessoryCompatible({title:'Universal lens pouch',itemType:'accessory',components:unrelatedAccessory.components},[{title:lens.title,itemType:'lens',components:lens.components}],[]),false,'model-less lens titles do not match every generic accessory');

const split=allocation.checkoutAccessoryLineAllocation([200,28],[1],[0],20,10,180);
assert.equal(split[1].discount,0,'ordinary promo/member/Encore saving must never allocate to an accessory offer');
assert.ok(split[1].accountCredit>0,'wallet credit remains tender and can pay an accessory line after base gear');
assert.equal(Math.round(split.reduce((sum,line)=>sum+line.card,0)*100),Math.round((200+28-20-10-180)*100),'funding allocations conserve the checkout total');

const {calculateRentalPrice}=pricing;
const ctx={db,stockFresh:true,scheduler:{runAfter:async()=>{}},runQuery:async(ref,args)=>{
  if(ref==='catalog.repriceLines')return catalog.repriceLines.handler({db},args);
  if(ref==='catalog.compatibilityKits')return catalog.compatibilityKits.handler({db},args);
  if(ref==='availability.forCart')return Object.fromEntries(args.items.map(line=>[String(line.listingId),{ok:ctx.accessoryUnavailable!==String(line.listingId)}]));
  if(ref==='accounts._byEmail'||ref==='accounts._byToken')return null;
  if(ref==='promo.validate')return {valid:true,discount:20,code:'PROMO'};
  if(ref==='bookings.availableCheckoutCredit')return 0;
  throw Error(`unexpected query ${ref}`);
},runAction:async()=>{throw Error('unexpected action');}};
const priceInput={items:[
  {listingId:camera._id,title:'client camera title',start,end,pickupTime:'09:00',returnTime:'18:00',qty:1,total:0,deposit:0},
  {listingId:addOns[0]._id,title:'forged accessory price',start,end,pickupTime:'09:00',returnTime:'18:00',qty:1,total:0,deposit:0,offerType:policy.CHECKOUT_ACCESSORY_OFFER},
],customer:{email:'renter@example.test'},fulfilment:'pickup',promoCode:'PROMO'};
(async()=>{
  const verifiedEvidence=await catalog.compatibilityKits.handler({db},{});
  assert.equal(policy.checkoutAccessoryCompatible(namedAccessory,[{...camera,itemType:'camera-body'}],verifiedEvidence),true,'exact shared physical components inside an owner-confirmed kit support named accessories without model text');
  assert.equal(policy.checkoutAccessoryCompatible(unverifiedAccessory,[{...camera,itemType:'camera-body'}],verifiedEvidence),false,'unverified kit mappings cannot establish accessory compatibility');
  assert.equal(policy.checkoutAccessoryCompatible(unrelatedAccessory,[{...camera,itemType:'camera-body'}],verifiedEvidence),false,'unrelated accessory components cannot match through another kit');
  assert.equal(policy.checkoutAccessoryCompatible({title:'Sony 24-70mm lens adapter',itemType:'accessory',components:[{inventoryUnitId:'unit-lens',qty:1}]},[{title:lens.title,itemType:'lens',components:lens.components}],verifiedEvidence),false,'unverified lens title overlap cannot replace a model identity or kit pairing');
  const priced=await calculateRentalPrice(ctx,priceInput);
  assert.equal(priced.items[0].total,200,'client-supplied gear total is ignored');
  assert.equal(priced.items[1].accessoryOffer.percent,30,'server uses the 30% tier for a £200 eligible basket');
  assert.equal(priced.items[1].accessoryOffer.saving,12);
  assert.equal(priced.items[1].total,28,'server recomputes accessory price from catalogue rate');
  assert.equal(priced.totalReduction,20,'promo applies only to regular basket gear');
  assert.equal(priced.subtotal,228,'checkout subtotal contains net accessory price exactly once');
  assert.equal(priced.totalBeforeCredit,208,'checkout total applies promo to base gear without double-counting accessory saving');
  const extraGear=(listing)=>({listingId:listing._id,title:listing.title,start,end,pickupTime:'09:00',returnTime:'18:00',qty:1,total:0,deposit:0});
  const pricedAt250=await calculateRentalPrice(ctx,{...priceInput,items:[priceInput.items[0],extraGear(light50),priceInput.items[1]]});
  assert.equal(pricedAt250.items[2].accessoryOffer.percent,40,'server applies 40% at the £250 tier before any ordinary promotion');
  const pricedAt350=await calculateRentalPrice(ctx,{...priceInput,items:[priceInput.items[0],extraGear(light150),priceInput.items[1]]});
  assert.equal(pricedAt350.items[2].accessoryOffer.percent,50,'server applies 50% at the £350 tier before any ordinary promotion');
  const funded=allocation.checkoutAccessoryLineAllocation(priced.items.map(item=>item.total),[1],[],priced.totalReduction,priced.membershipCreditApplied,priced.creditApplied-priced.membershipCreditApplied);
  assert.equal(Math.round(funded.reduce((sum,line)=>sum+line.card,0)*100),Math.round((priced.totalDue-priced.depositAmount)*100),'checkout allocations equal the amount that Stripe charges for rental lines');
  await assert.rejects(calculateRentalPrice(ctx,{...priceInput,items:priceInput.items.map((item,index)=>index===1?{...item,start:Date.UTC(2027,0,2),end:Date.UTC(2027,0,2)}:item)}),/does not match the equipment or rental times/);
  await assert.rejects(calculateRentalPrice(ctx,{...priceInput,items:priceInput.items.map((item,index)=>index===1?{...item,listingId:camera._id}:item)}),/no longer qualifies/);
  const unknownType = put('listings',{active:true,title:'Unknown type FX3 accessory bundle',category:'Accessories',pricing:{daily:30},depositAmount:0,
    components:[{inventoryUnitId:'unit-unknown',qty:1}],stockMappingStatus:'complete',inventoryFacts:{owned:true,reviewRequired:false},sourceImages:['https://images.example.test/unknown.jpg'],demandScore:99});
  await assert.rejects(calculateRentalPrice(ctx,{...priceInput,items:[priceInput.items[0],{...priceInput.items[1],listingId:unknownType._id}]}),/no longer qualifies/);
  const verifiedNamedPrice=await calculateRentalPrice(ctx,{...priceInput,items:[priceInput.items[0],{...priceInput.items[1],listingId:namedAccessory._id}]});
  assert.equal(verifiedNamedPrice.items[1].accessoryOffer.percent,30,'checkout applies the correct £200 basket tier to a verified physical pairing');
  await assert.rejects(calculateRentalPrice(ctx,{...priceInput,items:[priceInput.items[0],{...priceInput.items[1],listingId:unverifiedAccessory._id}]}),/does not match the equipment/);
  await assert.rejects(calculateRentalPrice(ctx,{...priceInput,items:[priceInput.items[0],...addOns.slice(0,4).map(item=>({listingId:item._id,title:item.title,start,end,pickupTime:'09:00',returnTime:'18:00',qty:1,total:0,deposit:0,offerType:policy.CHECKOUT_ACCESSORY_OFFER}))]}),/up to three/);
  ctx.accessoryUnavailable=String(addOns[0]._id);
  await assert.rejects(calculateRentalPrice(ctx,priceInput),/no longer available/);

  const offerCtx={db,stockFresh:true,unavailable:new Set([String(addOns[0]._id),String(addOns[1]._id)])};
  const queryInput={items:[{...basket[0],offerType:undefined}]};
  const live=await recommendations.checkoutAccessoryOffers.handler(offerCtx,queryInput);
  assert.equal(live.status,'ready');
  assert.equal(live.offers.length,3,'returns at most the three best accessories confirmed available now');
  assert.ok(live.offers.every(item=>item.itemType==='accessory'&&item.availabilityStatus==='checked'&&item.heroImage?.startsWith('https://')),'only live-compatible accessory listings with real photos are offered');
  assert.equal(live.offers.some(item=>item.listingId===unknownType._id),false,'missing catalogue types are excluded even when title fallback classifies them as accessory');
  assert.equal(live.offers.some(item=>item.listingId===namedAccessory._id),true,'recommendation query uses the same confirmed-kit evidence rule as checkout');
  assert.equal(live.offers.some(item=>item.listingId===unverifiedAccessory._id||item.listingId===unrelatedAccessory._id),false,'unverified and unrelated accessories stay out of live offers');
  assert.equal(live.offers.some(item=>item.listingId===addOns[5]._id),false,'battery is not classified as the accessory-only offer');
  const liveAt250=await recommendations.checkoutAccessoryOffers.handler(offerCtx,{items:[...basket,extraGear(light50)]});
  const liveAt350=await recommendations.checkoutAccessoryOffers.handler(offerCtx,{items:[...basket,extraGear(light150)]});
  assert.equal(liveAt250.percent,40,'recommendation tier matches authoritative checkout at £250');
  assert.equal(liveAt350.percent,50,'recommendation tier matches authoritative checkout at £350');
  offerCtx.stockFresh=false;
  const stale=await recommendations.checkoutAccessoryOffers.handler(offerCtx,queryInput);
  assert.equal(stale.status,'refresh_required');
  assert.equal(stale.offers.length,0,'stale inventory never produces an accessory offer');
  console.log('Checkout accessory offers: ladder, compatibility, fresh stock, three-item cap, anti-tampering, non-stacking and allocation regressions passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
