const assert=require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const sync=load('convex/sync.ts'),availability=load('convex/availability.ts'),catalog=load('convex/catalog.ts');
const ctx={db},start=Date.UTC(2030,0,1),end=start+86400000;
process.env.ADMIN_TOKEN='fixture-source-quantity-owner';
process.env.RMV2_WEBHOOK_URL='https://fixture-manager.convex.site/dbcinema/booking-sync';process.env.RMV2_WEBHOOK_SECRET='fixture-read-service';
const row=(extra={})=>({hyggloProductId:10,masterItemId:'source-camera',masterQty:2,slug:'fixture-body',title:'Fixture physical camera',category:'Cameras',itemType:'camera-body',componentQty:1,sizeScore:1,weightKg:1,sourceImages:['https://images.example/source-camera.png'],pricing:{daily:40},depositAmount:1000,replacementCost:1000,minimumRentalDays:1,unavailableDates:[],...extra});
const getListing=slug=>db.query('listings').withIndex('by_slug',q=>q.eq('slug',slug)).first();
const apply=items=>sync.applyCatalog.handler(ctx,{items});
const stock=l=>availability.forListing.handler(ctx,{listingId:l._id,start,end});
(async()=>{
 await apply([row(),row({slug:'fixture-three',hyggloProductId:11,componentQty:3})]);
 const body=await getListing('fixture-body'),kit=await getListing('fixture-three');
 assert.equal(body.components[0].inventoryUnitId,kit.components[0].inventoryUnitId,'Both offerings share the master physical pool');
 const unit=await db.get(body.components[0].inventoryUnitId);assert.equal(unit.quantityOwned,2,'A three-body listing cannot manufacture a third body');assert.equal((await stock(kit)).available,0);assert.equal((await stock(body)).available,2);
 body.r2Images=['https://assets.example/accepted.png'];body.marketingOnly=false;body.marketingOnlySource='admin';
 const reservation=put('reservations',{inventoryUnitId:unit._id,start,end,qty:1,status:'confirmed',source:'site'});
 await apply([row({masterQty:1}),row({slug:'fixture-three',hyggloProductId:11,masterQty:1,componentQty:3})]);assert.equal(unit.quantityOwned,1,'Reduced source quantities must replace larger historical counts');assert.equal((await stock(body)).available,0);assert.equal(await db.get(reservation._id),reservation,'Catalog reductions preserve actual rental occupancy');assert.deepEqual(body.r2Images,['https://assets.example/accepted.png']);assert.equal(body.marketingOnly,false);assert.equal(body.marketingOnlySource,'admin');
 await apply([row({masterQty:0})]);assert.equal(unit.quantityOwned,0);assert.equal((await stock(body)).available,0);assert((await catalog.listListings.handler(ctx,{})).some(l=>l._id===body._id),'Zero stock remains selectable for demand logging');
 await apply([row({masterQty:5})]);assert.equal(unit.quantityOwned,5);assert.equal((await stock(body)).available,4,'Replenishment uses real source count minus existing rental');
 const untouched=JSON.stringify([...tables.get('inventory_units')]);
 for(const bad of [-1,Infinity,NaN,1.5])await assert.rejects(apply([row({masterQty:3}),row({masterItemId:'other',slug:'bad',hyggloProductId:30,masterQty:bad})]),/Invalid source/);
 await assert.rejects(apply([row({masterQty:3}),row({slug:'conflict',hyggloProductId:31,masterQty:4})]),/Conflicting quantities/);assert.equal(JSON.stringify([...tables.get('inventory_units')]),untouched,'Whole source batch is validated before writing any stock');
 await assert.rejects(apply([row({componentQty:0})]),/Invalid source/);
 unit.quantityOwned=0;
 await assert.rejects(sync.fixUnitQty.handler(ctx,{token:'wrong'}),/unauthorized/);assert.equal(unit.quantityOwned,0);
 const audit=await sync.fixUnitQty.handler(ctx,{token:process.env.ADMIN_TOKEN});assert.equal(audit.bumped,0);assert(audit.shortages.some(s=>s.listingId===body._id&&s.owned===0));assert.equal(unit.quantityOwned,0,'Even authorized maintenance cannot create stock from listing demand');
 const originalFetch=global.fetch,calls=[];
 try{
  const products=[{productId:100,name:'Fixture active camera',masterItemId:'active',prices:[{days:1,pricePerDay:40}]},{productId:101,name:'Fixture inactive camera',masterItemId:'inactive',prices:[{days:1,pricePerDay:40}]},{productId:102,name:'Fixture marketing camera',masterItemId:'marketing',prices:[{days:1,pricePerDay:40}]},{productId:103,name:'Fixture missing master',masterItemId:'absent',prices:[{days:1,pricePerDay:40}]},{productId:104,name:'Fixture unmapped listing',prices:[{days:1,pricePerDay:40}]},{productId:105,name:'Fixture missing quantity',masterItemId:'bad',prices:[{days:1,pricePerDay:40}]},{productId:106,name:'Fixture old bridge without status',masterItemId:'old',prices:[{days:1,pricePerDay:40}]}];
  const masters=[{_id:'active',qty:2,status:'active',is_marketing_only:false},{_id:'inactive',qty:4,status:'inactive',is_marketing_only:false},{_id:'marketing',qty:3,status:'active',is_marketing_only:true},{_id:'bad',status:'active',is_marketing_only:false},{_id:'old',qty:10}];
  global.fetch=async(url,options)=>{const input=JSON.parse(options.body);calls.push(input);assert.equal(url,'https://fixture-manager.convex.site/dbcinema/storefront-read');assert.equal(options.headers['x-dbcinema-sync-token'],process.env.RMV2_WEBHOOK_SECRET);return {ok:true,json:async()=>({protocolVersion:1,path:input.path,status:'success',value:input.path==='hygglo_products:list'?products:masters})}};
  let applied;await sync.syncFromRmv2.handler({runMutation:async(ref,args)=>{applied=args;return sync.applyCatalog.handler(ctx,args)}},{});
  assert.deepEqual(applied.items.map(i=>i.masterQty),[2,0,0,0,0,0,0],'Only a valid active owned master supplies units; missing data never defaults to one');assert.equal(calls[0].args.accountSlug,'dbcinema');
  const fingerprint=applied.fingerprint;assert((tables.get('rmv2_sync_state')??[]).some(s=>s.key==='catalog-payload-v2-exact-stock'&&s.cursor===fingerprint),'New semantics do not skip against the old inflation fingerprint');
  assert.equal((await sync.applyCatalog.handler(ctx,applied)).skipped,true,'Unchanged verified snapshots still avoid repeated writes');
 }finally{global.fetch=originalFetch}
 console.log('PASS actual catalog sync: exact decreases/zero/replenishment, shared master pools, no kit inflation, existing rental/images/owner tags preserved, whole-batch quantity conflicts, zero-stock demand selection, missing/inactive/marketing/old source fail closed, versioned fingerprint and protected non-inflating maintenance. Synthetic source/database; no provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
