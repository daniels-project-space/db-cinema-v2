const assert=require('node:assert/strict'),fs=require('node:fs');
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
 assert.equal(catalog.refreshQuietDeals,undefined,'The removed automatic discount job is no longer callable');
 assert(!fs.readFileSync('convex/crons.ts','utf8').includes('refresh-quiet-deals'),'No recurring quiet-deal job remains scheduled');
 console.log('PASS maintenance handlers: promo and crew seeds require admin; the retired automatic quiet-deal job is absent.');
})().catch(error=>{console.error(error);process.exitCode=1});
