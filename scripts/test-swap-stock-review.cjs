const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='synthetic-admin';process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL='true';
setMock('./lib/rentalSwapAuthority',{swapAuthorityAvailable:()=>true});
const audit=load('convex/swapStockAudit.ts'),auth=load('convex/adminAuth.ts');
const booking=put('bookings',{}),swap=put('rental_item_swaps',{oldLine:{title:'Camera'},newLine:{title:'Lens'}}),receipt=put('swap_stock_applied_receipts',{bookingId:booking._id,swapId:swap._id,stockRisk:true,deliveryState:'acknowledged'});
let result={status:'unknown'},requests=0;
const ctx={db,runMutation:async(ref,args)=>{if(ref==='adminAuth.assertAdminInternal')return auth.assertAdminInternal.handler(ctx,args);if(ref==='swapStockAudit.prepareManualCheck')return audit.prepareManualCheck.handler(ctx,args);if(ref==='swapStockAudit.claim')return {operation:'checkConversion',args:{id:'synthetic-stock-receipt'}};if(ref==='swapStockAudit.record'){if(args.result.status==='confirmed'&&args.result.result?.stockRisk===false)await db.patch(args.id,{stockRisk:false});return;}throw Error(ref);},runQuery:async(ref,args)=>{assert.equal(ref,'swapStockAudit.manualCheckResult');return audit.manualCheckResult.handler(ctx,args);},runAction:async(ref,args)=>{assert.equal(ref,'sharedStockBridge.send');assert.equal(args.request.operation,'checkConversion');requests++;return result;}};
(async()=>{
 await assert.rejects(audit.conflicts.handler(ctx,{token:'not-admin',bookingId:booking._id}),/unauthorized/);
 await assert.rejects(audit.recheck.handler(ctx,{token:'not-admin',bookingId:booking._id,id:receipt._id}),/unauthorized/);assert.equal(requests,0);
 assert.equal((await audit.conflicts.handler(ctx,{token:'synthetic-admin',bookingId:booking._id})).length,1);
 await assert.rejects(audit.recheck.handler(ctx,{token:'synthetic-admin',bookingId:'bookings-other',id:receipt._id}),/no longer available/);assert.equal(requests,0);
 assert.equal((await audit.recheck.handler(ctx,{token:'synthetic-admin',bookingId:booking._id,id:receipt._id})).status,'review');assert.equal(receipt.stockRisk,true);
 result={status:'confirmed',result:{stockRisk:true}};assert.equal((await audit.recheck.handler(ctx,{token:'synthetic-admin',bookingId:booking._id,id:receipt._id})).status,'review');assert.equal(receipt.stockRisk,true);
 result={status:'confirmed',result:{stockRisk:false}};assert.equal((await audit.recheck.handler(ctx,{token:'synthetic-admin',bookingId:booking._id,id:receipt._id})).status,'clear');assert.equal(receipt.stockRisk,false);
 assert.equal((await audit.conflicts.handler(ctx,{token:'synthetic-admin',bookingId:booking._id})).length,0);console.log('PASS stock recheck orchestration: admin authentication, booking scope and fail-closed results; synthetic provider only.');
})().catch(error=>{console.error(error);process.exitCode=1});
