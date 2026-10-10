const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');
Object.assign(process.env, {DIDIT_API_KEY:'unused', DIDIT_WORKFLOW_ID:'workflow-contact', DIDIT_WEBHOOK_SECRET:'unused', DIDIT_APPLICATION_ID:'unused', DIDIT_ENVIRONMENT:'sandbox'});
const bookings = h.load('convex/bookings.ts'), didit = h.load('convex/didit.ts');
const owner = h.put('accounts', {email:'current@example.invalid'});
const foreign = h.put('accounts', {email:'old@example.invalid'});
const b = h.put('bookings', {accountId:owner._id, guestEmail:foreign.email, status:'confirmed', verificationProvider:'didit', idVerifyStatus:'required', depositHoldAmount:0, lineItems:[]});
const ctx = {db:h.db, scheduler:{runAfter:async()=>{}}};
const actionCtx = {
 runQuery:async(ref,args)=>ref==='accounts._byToken'?owner:bookings.verificationAccess.handler(ctx,args),
 runAction:async()=>{},
 runMutation:async(ref,args)=>bookings.setDiditSession.handler(ctx,args),
};
(async()=>{
 const savedFetch=global.fetch; let body;
 try {
  global.fetch=async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({session_id:'contact-session-1',workflow_id:'workflow-contact',url:'https://verify.didit.me/session/contact-session-1'})};};
  await didit.bookingSession.handler(actionCtx,{bookingId:b._id,accountToken:'owner'});
  assert.equal(body.contact_details.email,owner.email,'new provider case must use permanent owner current email, not a reused old booking address');
  assert.equal(b.diditSessionEmail,owner.email,'provider contact must be persisted with the case');
  assert.equal(b.diditWorkflowId,'workflow-contact','provider workflow is bound to the case');
  assert.equal(body.contact_details.send_notification_emails,false);
  owner.email='later@example.invalid';
  process.env.DIDIT_WORKFLOW_ID='workflow-next';
  const {createHmac}=require('node:crypto');
  const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value;
  const signed=event=>({body:JSON.stringify(event),timestamp:String(event.timestamp),signature:createHmac('sha256',process.env.DIDIT_WEBHOOK_SECRET).update(JSON.stringify(sort(event))).digest('hex')});
  const now=Math.floor(Date.now()/1000);
  const event={event_id:'case-workflow-event',webhook_type:'status.updated',timestamp:now,created_at:now,application_id:'unused',environment:'sandbox',workflow_id:'workflow-contact',session_id:b.diditSessionId,vendor_data:'dbc-booking-'+b._id,status:'In Progress',decision:{status:'In Progress'}};
  let writes=0;
  const webhookCtx={...actionCtx,runMutation:async(ref,args)=>{assert.equal(ref,'bookings.setDiditResult');writes++;return bookings.setDiditResult.handler(ctx,args);}};
  assert.equal(await didit.webhook.handler(webhookCtx,signed(event)),true,'signed original workflow callback works after configured workflow changes');
  assert.equal(writes,1);
  for(const changed of [{workflow_id:'workflow-next'},{environment:'live'},{application_id:'another-app'},{session_id:'foreign-session'}]) {
   assert.equal(await didit.webhook.handler(webhookCtx,signed({...event,...changed})),false);
   assert.equal(writes,1,'wrong workflow/environment/application/session cannot mutate verification');
  }
  const report={session_id:b.diditSessionId,workflow_id:'workflow-contact',session_kind:'user',vendor_data:'dbc-booking-'+b._id,contact_details:{email:'current@example.invalid'},status:'In Progress',session_url:'https://verify.didit.me/session/contact-session-1'};
  global.fetch=async()=>({ok:true,json:async()=>report});
  assert.equal((await didit.bookingSession.handler(actionCtx,{bookingId:b._id,accountToken:'owner'})).url,report.session_url,'reopening validates immutable provider contact despite another account email change');
  const access=await bookings.verificationAccess.handler(ctx,{bookingId:b._id});
  assert.equal(access.verificationContactEmail,owner.email);
  assert.equal(access.diditSessionEmail,'current@example.invalid');
  const refreshCtx={...actionCtx,runMutation:async(ref,args)=>ref==='bookings.claimDiditProgressRefresh'?bookings.claimDiditProgressRefresh.handler(ctx,args):true};
  assert.equal((await didit.refreshProgress.handler(refreshCtx,{bookingId:b._id,accountToken:'owner'})).status,'unchanged','live progress validates the original workflow/contact and preserves the already applied callback');
  report.contact_details.email=owner.email;
  b.diditReconciledAt=0;
  await assert.rejects(didit.refreshProgress.handler(refreshCtx,{bookingId:b._id,accountToken:'owner'}),/does not match/);
  report.contact_details.email='current@example.invalid';
  await assert.rejects(didit.bookingSession.handler({...actionCtx,runQuery:async(ref,args)=>ref==='accounts._byToken'?foreign:bookings.verificationAccess.handler(ctx,args)},{bookingId:b._id,accountToken:'foreign'}),/sign in/);
  const archives=h.load('convex/verificationArchive.ts');
  await archives.queueVerificationArchive(ctx,b,true);
  const archive=(h.tables.get('verification_archives')??[]).find(a=>a.bookingId===b._id);
  assert.equal(archive.accountId,owner._id);assert.equal(archive.email,'current@example.invalid','document download must validate the same immutable contact');
  b.guestEmail=undefined;
  const candidates=await bookings.diditReconcileCandidates.handler(ctx,{});
  assert.equal(candidates.find(c=>c.bookingId===b._id).email,'current@example.invalid','account-bound case remains recoverable without a legacy guest email');
  assert.equal(candidates.find(c=>c.bookingId===b._id).workflowId,'workflow-contact');
  const old=h.put('bookings',{guestEmail:'legacy@example.invalid',status:'confirmed',verificationProvider:'didit',diditSessionId:'legacy-session-1'});
  assert.equal((await bookings.diditReconcileCandidates.handler(ctx,{})).find(c=>c.bookingId===old._id).email,old.guestEmail,'existing cases retain legacy contact');
  assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:b._id,sessionId:b.diditSessionId,previousSessionId:b.diditSessionId,sessionEmail:owner.email}),false,'retries cannot rewrite immutable session contact');
  assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:b._id,sessionId:b.diditSessionId,previousSessionId:b.diditSessionId,sessionWorkflowId:'workflow-next'}),false,'retries cannot replace the original case workflow');
  assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:b._id,sessionId:'replacement-session',previousSessionId:b.diditSessionId,sessionEmail:'current@example.invalid'}),false,'account email changes during provider creation reject stale contact transactionally');
  assert.equal(b.diditSessionId,'contact-session-1');
  b.idVerifyStatus='requires_input';
  report.status='Expired';
  global.fetch=async(_url,options)=>options?.method==='POST'?{ok:true,json:async()=>{body=JSON.parse(options.body);return {session_id:'contact-session-2',workflow_id:'workflow-next',url:'https://verify.didit.me/session/contact-session-2'};}}:{ok:true,json:async()=>report};
  await didit.bookingSession.handler(actionCtx,{bookingId:b._id,accountToken:'owner'});
  assert.equal(body.contact_details.email,owner.email,'renewal uses latest permanent owner contact');
  assert.equal(b.diditSessionEmail,owner.email);assert.equal(b.diditSessionId,'contact-session-2');
  assert.equal(b.diditWorkflowId,'workflow-next');assert.equal(archive.workflowId,'workflow-contact','retained old archive keeps its workflow');
  assert.equal(archive.email,'current@example.invalid','old retained archive keeps its original case contact');
  const missing=h.put('bookings',{accountId:'accounts-missing',guestEmail:foreign.email,status:'confirmed',verificationProvider:'didit',idVerifyStatus:'required',depositHoldAmount:0});
  assert.equal((await bookings.verificationAccess.handler(ctx,{bookingId:missing._id})).verificationContactEmail,null);
  assert.equal(await bookings.setDiditSession.handler(ctx,{bookingId:missing._id,sessionId:'missing-owner-session',sessionEmail:foreign.email}),false,'missing permanent owner cannot fall back to reused guest address');
 } finally {global.fetch=savedFetch;}
 console.log('PASS permanent-owner current contact for new Didit case; immutable reopen/recovery/archive contact; foreign denial and legacy compatibility.');
})().catch(e=>{console.error(e);process.exitCode=1;});
