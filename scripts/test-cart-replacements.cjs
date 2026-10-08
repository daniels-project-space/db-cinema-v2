const assert = require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const availability=load('convex/availability.ts'),replacements=load('convex/cartReplacements.ts'),{assertRentalInventory}=load('convex/lib/rentalInventory.ts'),{marketingRedirect}=load('convex/lib/marketingInventory.ts');
const ctx={db},start=Date.UTC(2030,1,1),end=start+2*86400000;
const unit=name=>put('inventory_units',{name,quantityOwned:1});
const listing=(title,u,extra={})=>put('listings',{title,slug:title.toLowerCase().replaceAll(' ','-'),category:'Cameras',itemType:'camera-body',active:true,components:[{inventoryUnitId:u._id,qty:1}],pricing:{daily:40},depositAmount:1000,...extra});
const lines=l=>[{key:'source',listingId:l._id,start,end}];
(async()=>{
 const phantom=listing('Sony FX6 camera kit',unit('fake')),fx3=listing('Sony FX3 camera kit',unit('FX3')),a7=listing('Sony A7 V camera kit',unit('A7V'));
 const catalog=load('convex/catalog.ts');
 await db.patch(phantom._id,{suppressed:true});
 const marketingDetail=await catalog.getListingBySlug.handler(ctx,{slug:phantom.slug});
 assert.equal(marketingDetail.marketingOnly,true);
 assert.equal(marketingDetail.displayOnly,false,'Legacy suppressed marketing listings must offer date selection and cart demand logging');
 await db.patch(phantom._id,{suppressed:false});
 const ordinaryDisplay=listing('Reference accessory',unit('reference'),{suppressed:true});
 assert.equal((await catalog.getListingBySlug.handler(ctx,{slug:ordinaryDisplay.slug})).displayOnly,true,'Unrelated reference-only listings keep their existing flow');
 await load('convex/analytics.ts').track.handler(ctx,{type:'add_to_cart',listingId:phantom._id,title:phantom.title,path:phantom.slug,sessionId:'marketing-demand-fixture',qty:1});
 const demandEvents=await db.query('events').collect();
 assert(demandEvents.some(e=>e.type==='add_to_cart'&&e.listingId===phantom._id&&e.qty===1),'Marketing additions retain real first-party demand records');
 const activeMarketing=await availability.forCart.handler(ctx,{items:lines(phantom)});assert.equal(activeMarketing[phantom._id].ok,false);assert.equal(activeMarketing[phantom._id].available,0);
 await assert.rejects(assertRentalInventory(ctx,[{...lines(phantom)[0],qty:1}]),/no longer available/);
 assert.equal(marketingRedirect({title:'Sony FX 3 Cinema Camera Full Frame Mirrorless 4k Sony fx3 (same sensor as a7siii',itemType:'camera-body'}),undefined);
for(const title of ['Cannon r5 c cinema camera','Sigma art 24-70mm f2.8 lens','Sigma 14–24mm f/2.8 lens','2x Aputure 300 d ii lights','Aputure 600X PRO','Aputure pro Lighting LED light set 2x 300d ii + 1x 600 d pro'])assert(marketingRedirect({title}),title);
 for(const title of ['Nanlite forza 300 Lighting Kit (aputure 300d)','Nanlite 500 bi Color LED light (like Aputure 600x)','2x Nanlite 500 bi color + 1x 300 Light with Aputure dmx control'])assert(!marketingRedirect({title,itemType:'light'}),title);
 assert(!marketingRedirect({title:'DZOFilm Vespid 3-Lens Set'}));
 assert(!marketingRedirect({title:'Sony FX3 camera body'}));assert(!marketingRedirect({title:'Battery for Sony FX6',itemType:'battery'}));assert(!marketingRedirect({title:'Sony A7 IV compatible cage',itemType:'accessory'}));
 const booking=put('bookings',{lineItems:[{...lines(phantom)[0],qty:1,title:phantom.title}],status:'pending_payment'});
 await assert.rejects(load('convex/bookings.ts').placeHolds.handler(ctx,{bookingId:booking._id,ttlMs:60000}),/no longer available/);assert.equal((tables.get('reservations')??[]).length,0);
 const opts=await replacements.forCart.handler(ctx,{items:lines(phantom)});assert.equal(opts.source.length,2);assert.equal(opts.source[0].listingId,fx3._id);assert(opts.source.every(c=>c.days===3&&c.total>0));
 // Every unavailable line remains represented, including deleted/inactive/empty mappings.
 const dead=listing('Retired body',unit('dead'),{active:false}),empty=listing('Missing inventory',unit('unused'),{components:[]});
 for(const l of [dead,empty,{_id:'listings:missing'}])assert.equal((await availability.forCart.handler(ctx,{items:lines(l)}))[l._id].ok,false);
 // Live blocks, holds, shared kit capacity, and an expired hold.
 await db.patch(fx3._id,{unavailableDates:['2030-02-02']});assert.equal((await replacements.forCart.handler(ctx,{items:lines(phantom)})).source[0].listingId,a7._id);assert.equal((await availability.forCart.handler(ctx,{items:lines(fx3)}))[fx3._id].ok,false);await db.patch(fx3._id,{unavailableDates:[]});
 const held=put('reservations',{inventoryUnitId:fx3.components[0].inventoryUnitId,start,end,qty:1,status:'hold',holdExpiresAt:Date.now()+60000});assert(!(await replacements.forCart.handler(ctx,{items:lines(phantom)})).source.some(c=>c.listingId===fx3._id));await db.patch(held._id,{holdExpiresAt:Date.now()-1});assert.equal((await replacements.forCart.handler(ctx,{items:lines(phantom)})).source[0].listingId,fx3._id);
 const competing=listing('Another FX3 kit',await db.get(fx3.components[0].inventoryUnitId));const basket=[...lines(phantom),{key:'keep',listingId:competing._id,start,end}];assert(!(await replacements.forCart.handler(ctx,{items:basket})).source.some(c=>c.listingId===fx3._id));
 await db.patch(a7._id,{minimumRentalDays:4});assert.equal((await replacements.forCart.handler(ctx,{items:basket})).source.length,0);await db.patch(a7._id,{minimumRentalDays:1});
 const extra=listing('Another available camera',unit('extra-body'));
 const expanded=await replacements.forCart.handler(ctx,{items:lines(phantom),limit:8});assert(expanded.source.length>2,'Show more returns additional genuinely available replacements');assert.equal((await replacements.forCart.handler(ctx,{items:lines(phantom)})).source.length,2,'Initial result stays at two');await db.patch(extra._id,{active:false});
 // Fresh recheck removes a choice when a reservation wins the race.
 put('reservations',{inventoryUnitId:fx3.components[0].inventoryUnitId,start,end,qty:1,status:'confirmed'});assert(!(await replacements.forCart.handler(ctx,{items:lines(phantom)})).source.some(c=>c.listingId===fx3._id));
 // Do not substitute a known incompatible body into a kit with E glass.
 await db.patch(a7._id,{specs:{mount:'EF'}});const glass=listing('Sony lens',unit('lens'),{category:'Lenses',itemType:'lens',specs:{mount:'E'}});assert.equal((await replacements.forCart.handler(ctx,{items:[...lines(phantom),{key:'lens',listingId:glass._id,start,end}]})).source.length,0);
 // Independent periods sharing one physical pool must not inherit a shortage
 // on another cart line or during the gap between their requested dates.
 const periodUnit=unit('Period-specific camera'),firstPeriod=listing('Early camera hire',periodUnit),laterPeriod=listing('Later camera hire',periodUnit);
 const day=86400000,early={listingId:firstPeriod._id,start,end:start},late={listingId:laterPeriod._id,start:start+10*day,end:start+10*day};
 const laterHold=put('reservations',{inventoryUnitId:periodUnit._id,start:late.start,end:late.end,qty:1,status:'confirmed'});
 let periods=await availability.forCart.handler(ctx,{items:[early,late]});
 assert.deepEqual(periods[firstPeriod._id],{available:1,demanded:1,ok:true},'A later occupied date must not mark the earlier hire unavailable');
 assert.deepEqual(periods[laterPeriod._id],{available:0,demanded:1,ok:false});
 await db.patch(laterHold._id,{start:start+5*day,end:start+5*day,qty:2});
 periods=await availability.forCart.handler(ctx,{items:[early,late]});
 assert(Object.values(periods).every(p=>p.ok&&p.available===1),'Even an overbooked gap outside both hires cannot block their selected dates');
 const overlapping={...late,start:early.start,end:early.end};
 periods=await availability.forCart.handler(ctx,{items:[early,overlapping]});
 assert(Object.values(periods).every(p=>!p.ok),'Overlapping shared basket demand still blocks both conflicting hires');
 await assertRentalInventory(ctx,[{...early,qty:1},{...late,qty:1}]);
 await assert.rejects(assertRentalInventory(ctx,[{...early,qty:1},{...overlapping,qty:1}]),/already reserved/);
 console.log('Cart replacement handlers: marketing and missing lines blocked; ranked maximum two, exact period/pricing, date blocks, expired/live holds, retained shared inventory, minimum duration, stock races, and mount compatibility pass.');
})().catch(e=>{console.error(e);process.exitCode=1});
