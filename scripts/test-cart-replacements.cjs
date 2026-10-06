const assert = require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const availability=load('convex/availability.ts'),replacements=load('convex/cartReplacements.ts'),{assertRentalInventory}=load('convex/lib/rentalInventory.ts'),{marketingRedirect}=load('convex/lib/marketingInventory.ts');
const ctx={db},start=Date.UTC(2030,1,1),end=start+2*86400000;
const unit=name=>put('inventory_units',{name,quantityOwned:1});
const listing=(title,u,extra={})=>put('listings',{title,slug:title.toLowerCase().replaceAll(' ','-'),category:'Cameras',itemType:'camera-body',active:true,components:[{inventoryUnitId:u._id,qty:1}],pricing:{daily:40},depositAmount:1000,...extra});
const lines=l=>[{key:'source',listingId:l._id,start,end}];
(async()=>{
 const phantom=listing('Sony FX6 camera kit',unit('fake')),fx3=listing('Sony FX3 camera kit',unit('FX3')),a7=listing('Sony A7 V camera kit',unit('A7V'));
 const activeMarketing=await availability.forCart.handler(ctx,{items:lines(phantom)});assert.equal(activeMarketing[phantom._id].ok,false);assert.equal(activeMarketing[phantom._id].available,0);
 await assert.rejects(assertRentalInventory(ctx,[{...lines(phantom)[0],qty:1}]),/no longer available/);
 assert(!marketingRedirect({title:'Sony FX3 camera body'}));assert(!marketingRedirect({title:'Battery for Sony FX6',itemType:'battery'}));assert(!marketingRedirect({title:'Sony A7 IV compatible cage',itemType:'accessory'}));
 const booking=put('bookings',{lineItems:[{...lines(phantom)[0],qty:1,title:phantom.title}],status:'pending_payment'});
 await assert.rejects(load('convex/bookings.ts').placeHolds.handler(ctx,{bookingId:booking._id,ttlMs:60000}),/unavailable/);assert.equal((tables.get('reservations')??[]).length,0);
 const opts=await replacements.forCart.handler(ctx,{items:lines(phantom)});assert.equal(opts.source.length,2);assert.equal(opts.source[0].listingId,fx3._id);assert(opts.source.every(c=>c.days===3&&c.total>0));
 // Every unavailable line remains represented, including deleted/inactive/empty mappings.
 const dead=listing('Retired body',unit('dead'),{active:false}),empty=listing('Missing inventory',unit('unused'),{components:[]});
 for(const l of [dead,empty,{_id:'listings:missing'}])assert.equal((await availability.forCart.handler(ctx,{items:lines(l)}))[l._id].ok,false);
 // Live blocks, holds, shared kit capacity, and an expired hold.
 await db.patch(fx3._id,{unavailableDates:['2030-02-02']});assert.equal((await replacements.forCart.handler(ctx,{items:lines(phantom)})).source[0].listingId,a7._id);assert.equal((await availability.forCart.handler(ctx,{items:lines(fx3)}))[fx3._id].ok,false);await db.patch(fx3._id,{unavailableDates:[]});
 const held=put('reservations',{inventoryUnitId:fx3.components[0].inventoryUnitId,start,end,qty:1,status:'hold',holdExpiresAt:Date.now()+60000});assert(!(await replacements.forCart.handler(ctx,{items:lines(phantom)})).source.some(c=>c.listingId===fx3._id));await db.patch(held._id,{holdExpiresAt:Date.now()-1});assert.equal((await replacements.forCart.handler(ctx,{items:lines(phantom)})).source[0].listingId,fx3._id);
 const competing=listing('Another FX3 kit',await db.get(fx3.components[0].inventoryUnitId));const basket=[...lines(phantom),{key:'keep',listingId:competing._id,start,end}];assert(!(await replacements.forCart.handler(ctx,{items:basket})).source.some(c=>c.listingId===fx3._id));
 await db.patch(a7._id,{minimumRentalDays:4});assert.equal((await replacements.forCart.handler(ctx,{items:basket})).source.length,0);await db.patch(a7._id,{minimumRentalDays:1});
 // Fresh recheck removes a choice when a reservation wins the race.
 put('reservations',{inventoryUnitId:fx3.components[0].inventoryUnitId,start,end,qty:1,status:'confirmed'});assert(!(await replacements.forCart.handler(ctx,{items:lines(phantom)})).source.some(c=>c.listingId===fx3._id));
 // Do not substitute a known incompatible body into a kit with E glass.
 await db.patch(a7._id,{specs:{mount:'EF'}});const glass=listing('Sony lens',unit('lens'),{category:'Lenses',itemType:'lens',specs:{mount:'E'}});assert.equal((await replacements.forCart.handler(ctx,{items:[...lines(phantom),{key:'lens',listingId:glass._id,start,end}]})).source.length,0);
 console.log('Cart replacement handlers: marketing and missing lines blocked; ranked maximum two, exact period/pricing, date blocks, expired/live holds, retained shared inventory, minimum duration, stock races, and mount compatibility pass.');
})().catch(e=>{console.error(e);process.exitCode=1});
