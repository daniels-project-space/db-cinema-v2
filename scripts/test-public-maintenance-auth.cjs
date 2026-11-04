const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='synthetic-admin-token';
const promo=load('convex/promo.ts'),operators=load('convex/operators.ts'),catalog=load('convex/catalog.ts');
const ctx={db};
(async()=>{
 await assert.rejects(promo.seed.handler(ctx,{token:'wrong'}),/unauthorized/);
 assert.equal((await db.query('promo_codes').collect()).length,0);
 assert.equal((await promo.seed.handler(ctx,{token:process.env.ADMIN_TOKEN})).seeded,true);
 assert.equal((await promo.seed.handler(ctx,{token:process.env.ADMIN_TOKEN})).seeded,false);
 await assert.rejects(operators.seed.handler(ctx,{token:'wrong'}),/unauthorized/);
 assert.equal((await db.query('operators').collect()).length,0);
 assert((await operators.seed.handler(ctx,{token:process.env.ADMIN_TOKEN})).added>0);
 const unit=put('inventory_units',{active:true,quantityOwned:1});
 const listing=put('listings',{title:'Unique synthetic alpha',slug:'fixture',category:'Cameras',active:true,demandScore:0,components:[{inventoryUnitId:unit._id,qty:1}]});
 const result=await catalog.refreshQuietDeals.handler(ctx,{});
 assert.equal(result.discounted,1);assert.equal(listing.quietDeal,10);
 console.log('PASS actual maintenance handlers: promo and crew seeds require admin; internal quiet-deal calculation remains functional.');
})().catch(error=>{console.error(error);process.exitCode=1});
