const assert = require('node:assert/strict');
const {load} = require('./lib/rentalTestHarness.cjs');
const {sendSharedStockRequest} = load('convex/lib/sharedStockTransport.ts');
const bridge = load('convex/sharedStockBridge.ts');
const secret = 'synthetic-stock-secret-at-least-32-characters';
const config = {enabled:true,managerUrl:'https://fixture-manager.convex.site/dbcinema/booking-sync',secret};
const request = {operation:'acquire',args:{requestId:'website-request-000001',items:[{itemId:'camera-fixture',start:1000,returnAt:2000,quantity:1}]}};
const fingerprint = JSON.stringify([['camera-fixture',1000,3602000,1]]);
const body = {version:1,operation:'acquire',request:{source:'website',...request.args},result:{requestId:'claim-fixture',fingerprint,state:'prepared',replayed:false}};
(async()=>{
 let calls=[]; const fetcher=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(body),{status:200})};
 assert.deepEqual(await sendSharedStockRequest(request,{...config,enabled:false,fetcher}),{status:'offline'});
 assert.deepEqual(await bridge.send.handler({}, {request}),{status:'offline'});
 for(const managerUrl of ['http://fixture-manager.convex.site/dbcinema/booking-sync','https://fixture-manager.convex.site.evil.test/dbcinema/booking-sync','https://fixture-manager.convex.site:444/dbcinema/booking-sync','https://user@fixture-manager.convex.site/dbcinema/booking-sync','https://fixture-manager.convex.site/dbcinema/booking-sync?secret=x','https://fixture-manager.convex.site/other']) assert.deepEqual(await sendSharedStockRequest(request,{...config,managerUrl,fetcher}),{status:'offline'});
 assert.equal(calls.length,0);
 assert.deepEqual(await sendSharedStockRequest(request,{...config,fetcher}),{status:'confirmed',result:body.result});
 assert.equal(calls.length,1); assert.equal(calls[0].url,'https://fixture-manager.convex.site/dbcinema/shared-stock'); assert.equal(calls[0].options.redirect,'error'); assert.equal(calls[0].options.headers['x-shared-stock-token'],secret); assert(!calls[0].options.body.includes(secret)); assert(calls[0].options.signal instanceof AbortSignal);
 const paidRequest={operation:'acquirePaidBooking',args:{requestId:'booking_booking-fixture',bookingId:'booking-fixture',bookingRevision:7,verificationState:'pending',paymentEvidence:{status:'succeeded',paymentIntentId:'pi_fixture',paidAt:1700000000000},items:request.args.items}};
 const paidExecution={ok:true,operation:'acquirePaidBooking',outcome:'execution_started',bookingId:'booking-fixture',requestId:paidRequest.args.requestId,fingerprint:'paid-stock-fingerprint',holdsStock:true,replayed:false,executionKey:'booking_execution_booking-fixture'};
 const paidConverted={...paidExecution,outcome:'converted',holdsStock:false,replayed:true};delete paidConverted.executionKey;
 for(const paidReceipt of [paidExecution,paidConverted]) assert.deepEqual(await sendSharedStockRequest(paidRequest,{...config,fetcher:async()=>new Response(JSON.stringify(paidReceipt))}),{status:'confirmed',result:paidReceipt},'both an active claim and its converted reservation prove stock is held');
 for(const altered of [{...paidExecution,holdsStock:false},{...paidConverted,holdsStock:true},{...paidConverted,bookingId:'other-booking'},{...paidConverted,extra:'untrusted'}]) assert.equal((await sendSharedStockRequest(paidRequest,{...config,fetcher:async()=>new Response(JSON.stringify(altered))})).status,'unknown','paid stock acknowledgements require the exact outcome/occupancy pair and identity');
 const associatedAcquire={operation:'acquire',args:{...request.args,bookingId:'booking-fixture'}};
 const associatedReceipt={...body,request:{...body.request,bookingId:'booking-fixture'}};
 assert.deepEqual(await sendSharedStockRequest(associatedAcquire,{...config,fetcher:async()=>new Response(JSON.stringify(associatedReceipt))}),{status:'confirmed',result:body.result},'positive swap claims retain the parent booking identity through transport');
 assert.equal((await sendSharedStockRequest(associatedAcquire,{...config,fetcher:async()=>new Response(JSON.stringify({...associatedReceipt,request:{...associatedReceipt.request,bookingId:'different-booking'}}))})).status,'unknown','a stock claim receipt cannot be rebound to another booking');
 const extraFieldReceipt={...body,request:{...body.request,bookingId:'booking-fixture'}};
 assert.equal((await sendSharedStockRequest(request,{...config,fetcher:async()=>new Response(JSON.stringify(extraFieldReceipt))})).status,'unknown','reject acquire receipts that include fields outside Rental Manager contract');
 const staleBookingRequest={operation:'acquire',args:{...request.args,bookingId:'booking-fixture'}};
 assert.equal((await sendSharedStockRequest(staleBookingRequest,{...config,fetcher:async(_url,options)=>{assert.equal(JSON.parse(options.body).args.bookingId,'booking-fixture');return new Response('',{status:409})}})).status,'unknown','manager rejection of a stale acquire payload remains ambiguous and fail-closed');
 const checkExecution={operation:'checkExecution',args:{id:'claim-fixture',fingerprint,executionKey:'provider-execution-0001'}};
 const capacityConflict={version:1,operation:'checkExecution',error:'capacity_conflict'};
 assert.deepEqual(await sendSharedStockRequest(checkExecution,{...config,fetcher:async()=>new Response(JSON.stringify(capacityConflict),{status:409})}),{status:'capacity_conflict'},'only the manager’s explicit, operation-matched capacity conflict is classified');
 for(const altered of [
   {...capacityConflict,operation:'beginExecution'},
   {...capacityConflict,error:'stock_request_not_accepted'},
   {...capacityConflict,extra:'untrusted'},
   {...capacityConflict,version:2},
 ]) assert.deepEqual(await sendSharedStockRequest(checkExecution,{...config,fetcher:async()=>new Response(JSON.stringify(altered),{status:409})}),{status:'unknown'},'malformed or mismatched conflicts remain ambiguous');
 for(const altered of [{...body,operation:'releasePrepared'}, {...body,result:{...body.result,fingerprint:'other'}}, {...body,result:{...body.result,state:'released'}}, {...body,result:{...body.result,replayed:'false'}}, {...body,request:{...body.request,source:'hygglo'}}, {...body,request:{...body.request,requestId:'different-website-request'}}, {...body,request:{...body.request,items:[{...request.args.items[0],quantity:2}]}}, {...body,request:{...body.request,untrusted:true}}]) assert.deepEqual(await sendSharedStockRequest(request,{...config,fetcher:async()=>new Response(JSON.stringify(altered))}),{status:'unknown'});
 const zero={operation:'acquireZero',args:{requestId:'swap_0123456789abcdef',bookingId:'booking-fixture',oldItems:request.args.items,newItems:request.args.items}};
 const zeroFingerprint=JSON.stringify(['zero-capacity-v1',zero.args.bookingId,[['camera-fixture',1000,2000,1]],[['camera-fixture',1000,2000,1]]]);
 const zeroReceipt={version:1,operation:'acquireZero',request:{source:'website',...zero.args},result:{requestId:'zero-claim',fingerprint:zeroFingerprint,state:'prepared',replayed:false}};
 assert.equal((await sendSharedStockRequest(zero,{...config,fetcher:async()=>new Response(JSON.stringify(zeroReceipt))})).status,'confirmed');
 const convertedZero={...zeroReceipt,result:{...zeroReceipt.result,state:'converted',replayed:true,stockRisk:false}};
 assert.deepEqual(await sendSharedStockRequest(zero,{...config,fetcher:async()=>new Response(JSON.stringify(convertedZero))}),{status:'confirmed',result:convertedZero.result},'the original zero-delta acquisition remains replayable after conversion');
 assert.equal((await sendSharedStockRequest(zero,{...config,fetcher:async()=>new Response(JSON.stringify({...convertedZero,result:{...convertedZero.result,stockRisk:undefined}}))})).status,'unknown','a converted replay requires an explicit stock-risk result');
 assert.equal((await sendSharedStockRequest(zero,{...config,fetcher:async()=>new Response(JSON.stringify({...convertedZero,result:{...convertedZero.result,fingerprint:'other'}}))})).status,'unknown','a converted replay remains bound to its original fingerprint');
 const convertedAcquire={...body,result:{...body.result,state:'converted',replayed:true,stockRisk:true}};
 assert.deepEqual(await sendSharedStockRequest(request,{...config,fetcher:async()=>new Response(JSON.stringify(convertedAcquire))}),{status:'confirmed',result:convertedAcquire.result},'the original positive-delta acquisition remains replayable after conversion');
 for(const changed of [{bookingId:'other'}, {oldItems:[{...request.args.items[0],quantity:2}]}, {newItems:[{...request.args.items[0],quantity:2}]}])assert.equal((await sendSharedStockRequest(zero,{...config,fetcher:async()=>new Response(JSON.stringify({...zeroReceipt,request:{...zeroReceipt.request,...changed}}))})).status,'unknown');
 const conversion={operation:'checkConversion',args:{id:'claim-fixture',fingerprint,executionKey:'provider-execution-0001',receipt:{bookingId:'synthetic',windows:[{quantity:1}]}}};
 const converted={version:1,operation:'checkConversion',request:{source:'website',...conversion.args},result:{state:'converted',replayed:true,stockRisk:false}};
 assert.equal((await sendSharedStockRequest(conversion,{...config,fetcher:async()=>new Response(JSON.stringify(converted))})).status,'confirmed');
 assert.equal((await sendSharedStockRequest(conversion,{...config,fetcher:async()=>new Response(JSON.stringify({...converted,request:{...converted.request,receipt:{...conversion.args.receipt,windows:[{quantity:2}]}}}))})).status,'unknown');
 const compensated={operation:'releaseCompensated',args:{id:'claim-fixture',fingerprint,executionKey:'provider-execution-0001',evidence:{swapId:'swap-fixture',bookingId:'booking-fixture',bookingRevision:3,paymentIntentId:'pi_fixture',refundId:'re_fixture',refundStatus:'succeeded',amountPence:500,refundAttemptedAt:1000,windows:[{itemId:'camera-fixture',start:1000,end:3602000,quantity:1}]}}};
 const released={version:1,operation:'releaseCompensated',request:{source:'website',...compensated.args},result:{state:'compensated_released',replayed:false}};
 assert.equal((await sendSharedStockRequest(compensated,{...config,fetcher:async()=>new Response(JSON.stringify(released))})).status,'confirmed');
 assert.equal((await sendSharedStockRequest(compensated,{...config,fetcher:async()=>new Response(JSON.stringify({...released,request:{...released.request,evidence:{...compensated.args.evidence,refundId:'re_other'}}}))})).status,'unknown');
 const checkCompensated={operation:'checkCompensatedRelease',args:compensated.args};
 const unconfirmedRelease={version:1,operation:'checkCompensatedRelease',request:{source:'website',...checkCompensated.args},result:{state:'unconfirmed',replayed:true}};
 assert.equal((await sendSharedStockRequest(checkCompensated,{...config,fetcher:async()=>new Response(JSON.stringify(unconfirmedRelease))})).status,'unknown','An unconfirmed stock check remains ambiguous until exact release evidence is returned.');
 for(const [operation,state,args] of [['beginExecution','execution_started',{id:'claim-fixture',fingerprint,executionKey:'provider-execution-0001'}],['checkExecution','execution_started',{id:'claim-fixture',fingerprint,executionKey:'provider-execution-0001'}],['releasePrepared','released',{id:'claim-fixture',fingerprint,reason:'withdrawn_before_execution'}]]) {
  const payload={operation,args},receipt={version:1,operation,request:{...args,source:'website'},result:{state,replayed:true}};
  assert.deepEqual(await sendSharedStockRequest(payload,{...config,fetcher:async()=>new Response(JSON.stringify(receipt))}),{status:'confirmed',result:receipt.result});
  assert.deepEqual(await sendSharedStockRequest(payload,{...config,fetcher:async()=>new Response(JSON.stringify({...receipt,result:{...receipt.result,state:'prepared'}}))}),{status:'unknown'});
  for(const changed of [{id:'other-claim'},{fingerprint:'other-fingerprint'},{source:'hygglo'},operation==='beginExecution'?{executionKey:'other-execution'}:{reason:'abandoned_before_execution'}]) assert.deepEqual(await sendSharedStockRequest(payload,{...config,fetcher:async()=>new Response(JSON.stringify({...receipt,request:{...receipt.request,...changed}}))}),{status:'unknown'});
 }
 for(const response of [()=>new Response('bad'),()=>new Response('x'.repeat(16385)),()=>new Response('',{status:409}),()=>new Response('',{status:503})]) assert.deepEqual(await sendSharedStockRequest(request,{...config,fetcher:async()=>response()}),{status:'unknown'});
 for(const operation of ['acquire','beginExecution','releasePrepared']) {
  let attempts=0;
  const input=operation==='acquire'?request:operation==='beginExecution'?{operation,args:{id:'claim-fixture',fingerprint,executionKey:'provider-execution-0001'}}:{operation,args:{id:'claim-fixture',fingerprint,reason:'withdrawn_before_execution'}};
  const timeout=async(_url,options)=>{attempts++;assert(options.signal instanceof AbortSignal);throw new DOMException('timeout','TimeoutError')};
  assert.deepEqual(await sendSharedStockRequest(input,{...config,fetcher:timeout}),{status:'unknown'});assert.equal(attempts,1,'No automatic retry or fallback after an ambiguous transition');
 }
 console.log('PASS gated stock client: server-only entry, destination and response bounds, request identity, timeout uncertainty, and one attempt per transition; synthetic transport only.');
})().catch(error=>{console.error(error);process.exitCode=1});
