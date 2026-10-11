const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
Object.assign(process.env,{DIDIT_API_KEY:'unused',DIDIT_WORKFLOW_ID:'workflow-new',DIDIT_WEBHOOK_SECRET:'unused',DIDIT_APPLICATION_ID:'unused',DIDIT_ENVIRONMENT:'sandbox'});
const bookings=h.load('convex/bookings.ts'),didit=h.load('convex/didit.ts');
const owner=h.put('accounts',{email:'legacy@example.invalid'});
const make=()=>h.put('bookings',{accountId:owner._id,guestEmail:owner.email,status:'confirmed',verificationProvider:'didit',diditSessionId:'legacy-case-123',idVerifyStatus:'processing',depositHoldAmount:0,lineItems:[]});
const b=make(),ctx={db:h.db,scheduler:{runAfter:async()=>{}}};
const actionCtx={runQuery:async(ref,args)=>ref==='accounts._byToken'?owner:bookings.verificationAccess.handler(ctx,args),runMutation:async(ref,args)=>bookings[ref.split('.').at(-1)].handler(ctx,args)};
const reportFor=row=>({session_id:row.diditSessionId,session_kind:'user',vendor_data:'dbc-booking-'+row._id,contact_details:{email:row.guestEmail},workflow_id:'workflow-original',status:'In Progress',session_url:'https://verify.didit.me/session/legacy-case-123'});
(async()=>{
 const savedFetch=global.fetch;
 try {
  let report=reportFor(b),calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>report};};
  assert.equal((await didit.bookingSession.handler(actionCtx,{bookingId:b._id,accountToken:'owner'})).url,report.session_url,'legacy case uses authenticated original workflow after configuration changes');
  assert.equal(b.diditWorkflowId,'workflow-original');assert.equal(b.diditSessionEmail,owner.email);
  const saved=JSON.stringify(b);report={...report,workflow_id:'workflow-foreign'};
  await assert.rejects(didit.bookingSession.handler(actionCtx,{bookingId:b._id,accountToken:'owner'}),/does not match/);assert.equal(JSON.stringify(b),saved);
  const race=make();report=reportFor(race);
  global.fetch=async()=>{race.diditSessionId='new-case-after-read';return {ok:true,json:async()=>report};};
  await assert.rejects(didit.bookingSession.handler(actionCtx,{bookingId:race._id,accountToken:'owner'}),/changed/);
  assert.equal(race.diditWorkflowId,undefined);assert.equal(race.diditSessionEmail,undefined);
  const malformed=make();report={...reportFor(malformed),workflow_id:''};
  global.fetch=async()=>({ok:true,json:async()=>report});
  await assert.rejects(didit.bookingSession.handler(actionCtx,{bookingId:malformed._id,accountToken:'owner'}),/does not match/);assert.equal(malformed.diditWorkflowId,undefined);
  assert.equal(await bookings.bindDiditCase.handler(ctx,{bookingId:b._id,sessionId:b.diditSessionId,email:'foreign@example.invalid',workflowId:'workflow-original'}),false);
  assert.equal(await bookings.bindDiditCase.handler(ctx,{bookingId:b._id,sessionId:b.diditSessionId,email:owner.email,workflowId:'workflow-foreign'}),false);
  assert.equal(await bookings.bindDiditCase.handler(ctx,{bookingId:b._id,sessionId:b.diditSessionId,email:owner.email,workflowId:'workflow-original'}),true);
  const callback=make();report=reportFor(callback);global.fetch=async()=>({ok:true,json:async()=>report});
  const {createHmac}=require('node:crypto'),now=Math.floor(Date.now()/1000);
  const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  const signed=e=>({body:JSON.stringify(e),timestamp:String(e.timestamp),signature:createHmac('sha256',process.env.DIDIT_WEBHOOK_SECRET).update(JSON.stringify(sort(e))).digest('hex')});
  const event={event_id:'legacy-callback-1',timestamp:now,created_at:now,webhook_type:'status.updated',application_id:'unused',environment:'sandbox',workflow_id:'workflow-foreign',session_id:callback.diditSessionId,vendor_data:'dbc-booking-'+callback._id,status:'In Progress',decision:{status:'In Progress'}};
  assert.equal(await didit.webhook.handler(actionCtx,signed(event)),false,'signed callback cannot supply the workflow for an unattested case');
  assert.equal(callback.diditWorkflowId,undefined);
  assert.equal(await didit.webhook.handler(actionCtx,signed({...event,workflow_id:'workflow-original'})),true,'legacy callback authenticates its report before binding and applying progress');
  assert.equal(callback.diditWorkflowId,'workflow-original');assert.equal(callback.diditSessionEmail,owner.email);
  assert(calls>=2);
 } finally {global.fetch=savedFetch;}
 console.log('PASS authenticated legacy workflow/contact attestation, immutable retry, foreign contact/workflow denial, malformed provider data and session replacement race.');
})().catch(e=>{console.error(e);process.exitCode=1;});
