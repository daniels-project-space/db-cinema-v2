const assert=require('node:assert/strict');
const {load,put,db,tables}=require('./lib/rentalTestHarness.cjs');
const ctx={db};
Object.assign(process.env,{DIDIT_API_KEY:'unused',DIDIT_WORKFLOW_ID:'workflow-1',DIDIT_WEBHOOK_SECRET:'unused',DIDIT_APPLICATION_ID:'application-1',DIDIT_ENVIRONMENT:'sandbox',INVOICE_SECRET:'progress-fixture-only'});
const {refreshProgress,refreshForGaffer}=load('convex/didit.ts');
const {claimDiditProgressRefresh}=load('convex/bookings.ts');
const {rentalStageLabel}=load('shared/rentalReadiness.ts');
const {rentalProgress}=load('shared/rentalProgress.ts');
(async()=>{
 const booking={status:'confirmed',verificationProvider:'didit',diditSessionId:'session-12345',guestEmail:'renter@example.test',accountId:'account-1',stripeCheckoutSessionId:'cs_bound'};
 const account={_id:'account-1',email:booking.guestEmail};
 let mutations=[],gets=0,claim=true;
 const provider={session_id:booking.diditSessionId,session_kind:'user',vendor_data:'dbc-booking-booking-1',contact_details:{email:booking.guestEmail},workflow_id:'workflow-1',status:'In Review',id_verifications:[{status:'Approved'}],liveness_checks:[{status:'Approved'}],face_matches:[{status:'In Review'}],poa_verifications:[{status:'In Review'}]};
 const actionCtx={runQuery:async ref=>ref==='bookings.verificationAccess'?booking:account,runMutation:async(ref,a)=>{mutations.push([ref,a]);return ref==='bookings.claimDiditProgressRefresh'?claim:true;}};
 const previousFetch=global.fetch;
 try{
  global.fetch=async()=>{gets++;return{ok:true,json:async()=>provider}};
  const gafferCtx={...actionCtx,runQuery:async(ref,args)=>{assert.equal(ref,'chat._gafferVerificationAccess');assert.deepEqual(args,{accountId:'account-1',bookingId:'booking-1'});return booking;}};
  assert.equal((await refreshForGaffer.handler(gafferCtx,{accountId:'account-1',bookingId:'booking-1'})).status,'updated');
  const deniedCtx={...gafferCtx,runQuery:async()=>null};
  const beforeDenied=gets;
  await assert.rejects(refreshForGaffer.handler(deniedCtx,{accountId:'other',bookingId:'booking-1'}),/unavailable/);assert.equal(gets,beforeDenied);
  mutations=[];global.fetch=async()=>{throw Error('provider unavailable')};
  await assert.rejects(refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'}),/Could not check the current verification decision/);
  assert.deepEqual(mutations.filter(([ref])=>ref==='bookings.flagDiditProcessingFailure'),[['bookings.flagDiditProcessingFailure',{bookingId:'booking-1',sessionId:booking.diditSessionId}]],'authenticated refresh failure alerts the owner for the bound session');
  mutations=[];
  await assert.rejects(refreshForGaffer.handler(gafferCtx,{accountId:'account-1',bookingId:'booking-1'}),/Could not check the current verification decision/);
  assert.equal(mutations.filter(([ref])=>ref==='bookings.flagDiditProcessingFailure').length,1,'Gaffer refresh failure uses the same owner alert');
  const alertDown={...actionCtx,runMutation:async(ref,args)=>{mutations.push([ref,args]);if(ref==='bookings.flagDiditProcessingFailure')throw Error('alert unavailable');return true;}};
  const previousError=console.error;console.error=()=>{};
  try { await assert.rejects(refreshProgress.handler(alertDown,{bookingId:'booking-1',accountToken:'owner'}),/Could not check the current verification decision/,'alert failure must not hide the original provider failure'); }
  finally { console.error=previousError; }
  global.fetch=async()=>{gets++;return{ok:true,json:async()=>provider}};
  mutations=[];gets=0;
  assert.equal((await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'})).status,'updated');
  const saved=mutations.find(([ref])=>ref==='bookings.setDiditResult')[1];
  assert.equal(saved.status,'manual_review');assert.deepEqual(saved.checks,{identity:'approved',selfie:'review',address:'review'});
  assert.equal(saved.sessionId,booking.diditSessionId);
  assert.equal(saved.expectedEventId,null);assert.equal(saved.expectedEventAt,null);assert.equal(saved.expectedManualDecisionAt,null);
  const concurrent=put('bookings',{_id:'booking-1',verificationProvider:'didit',status:'confirmed',diditSessionId:booking.diditSessionId,diditEventId:'webhook-arrived',diditEventAt:Date.now()});
  assert.equal(await load('convex/bookings.ts').setDiditResult.handler(ctx,saved),true);
  assert.equal(concurrent.diditEventId,'webhook-arrived','a provider progress read cannot overwrite a newer webhook');
  assert.equal(rentalStageLabel({...booking,idVerifyStatus:saved.status}),'Verification under review');
  mutations=[];gets=0;claim=false;
  assert.equal((await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'})).status,'unchanged');assert.equal(gets,0);assert(!mutations.some(([ref])=>ref==='bookings.setDiditResult'));claim=true;
  const foreign={...actionCtx,runQuery:async ref=>ref==='bookings.verificationAccess'?booking:{_id:'someone-else',email:'other@example.test'}};
  await assert.rejects(refreshProgress.handler(foreign,{bookingId:'booking-1',accountToken:'other'}),/Sign in/);assert.equal(gets,0);
  await assert.rejects(refreshProgress.handler(actionCtx,{bookingId:'booking-1',checkoutSessionId:'cs_unrelated'}),/Sign in/);assert.equal(gets,0);
  await refreshProgress.handler(actionCtx,{bookingId:'booking-1',checkoutSessionId:'cs_bound'});assert.equal(gets,1);
  for(const [field,bad]of[['session_id','wrong-session'],['vendor_data','dbc-booking-other'],['contact_details',{email:'foreign@example.test'}],['workflow_id','wrong-workflow']]){
   const original=provider[field];provider[field]=bad;mutations=[];
   await assert.rejects(refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'}),/does not match/);assert(!mutations.some(([ref])=>ref==='bookings.setDiditResult'));provider[field]=original;
  }
  provider.status='Approved';provider.face_matches=[{status:'Approved'}];provider.poa_verifications=[];mutations=[];
  await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'});assert.equal(mutations.find(([ref])=>ref==='bookings.setDiditResult')[1].status,'manual_review','top-level approval cannot bypass missing address');
  provider.poa_verifications=[{status:'Approved'}];mutations=[];
  await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'});assert.equal(mutations.find(([ref])=>ref==='bookings.setDiditResult')[1].status,'verified','Didit approval is not blocked by unavailable cross-account matching');
  provider.id_verifications=[{status:'Approved',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}];mutations=[];
  await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'});assert.equal(mutations.find(([ref])=>ref==='bookings.setDiditResult')[1].status,'verified');
  const approvedResult=mutations.find(([ref])=>ref==='bookings.setDiditResult')[1];Object.assign(booking,{idVerifyStatus:'verified',verificationChecks:approvedResult.checks,verificationNote:approvedResult.note,documentExpiresAt:approvedResult.documentExpiresAt,renterPersonKey:approvedResult.personKey,identityRiskNotice:'The overlapping allocation needs attention'});mutations=[];
  assert.equal((await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'})).status,'updated');assert(mutations.some(([ref])=>ref==='bookings.setDiditResult'),'An unchanged provider decision still re-evaluates an existing advisory');
  provider.id_verifications=[{status:'Approved'}];booking.identityRiskNotice='Didit approved the identity, but cross-account identity matching is unavailable.';booking.renterPersonKey=undefined;mutations=[];
  assert.equal((await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'})).status,'unchanged');assert(!mutations.some(([ref])=>ref==='bookings.setDiditResult'),'An unchanged missing-key advisory does not repeatedly write');
  provider.id_verifications=[{status:'Approved',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}];mutations=[];assert.equal((await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'})).status,'updated');assert(mutations.some(([ref])=>ref==='bookings.setDiditResult'),'A newly available key re-evaluates and can clear the advisory');
 }finally{global.fetch=previousFetch;}
 const owner=put('accounts',{email:'alert-owner@example.invalid'});
 const alertBooking=put('bookings',{accountId:owner._id,status:'confirmed',verificationProvider:'didit',diditSessionId:'alert-session',guestEmail:owner.email});
 const scheduled=[],alertCtx={db,scheduler:{runAfter:async(...args)=>scheduled.push(args)}};
 const bookingHandlers=load('convex/bookings.ts');
 const refreshCtx={runQuery:async ref=>ref==='bookings.verificationAccess'?alertBooking:owner,runMutation:async(ref,args)=>{
  if(ref==='bookings.claimDiditProgressRefresh')return bookingHandlers.claimDiditProgressRefresh.handler(alertCtx,args);
  if(ref==='bookings.flagDiditProcessingFailure')return bookingHandlers.flagDiditProcessingFailure.handler(alertCtx,args);
  throw Error('Unexpected mutation');
 }};
 global.fetch=async()=>{throw Error('synthetic provider outage')};
 try {await assert.rejects(refreshProgress.handler(refreshCtx,{bookingId:alertBooking._id,accountToken:'owner'}),/Could not check the current verification decision/);}
 finally {global.fetch=previousFetch;}
 const incident=(tables.get('admin_notifications')??[]).find(row=>row.bookingId===alertBooking._id&&row.kind==='verification_failure');
 assert.ok(incident,'a real authorized refresh failure creates a durable owner incident');
 assert.match(incident.body,/verification processing could not complete/i);
 assert(!JSON.stringify(incident).includes('synthetic provider outage'),'provider details are not exposed in alerts');
 const row=put('bookings',{_id:'claimed-booking',status:'confirmed',diditSessionId:'claimed-session'});
 assert.equal(await claimDiditProgressRefresh.handler(ctx,{bookingId:row._id,sessionId:row.diditSessionId}),true);
 assert.equal(await claimDiditProgressRefresh.handler(ctx,{bookingId:row._id,sessionId:row.diditSessionId}),false,'concurrent replay throttled');
 assert.equal(await claimDiditProgressRefresh.handler(ctx,{bookingId:row._id,sessionId:'changed-session'}),false);
 await ctx.db.patch(row._id,{status:'cancelled',diditReconciledAt:0});assert.equal(await claimDiditProgressRefresh.handler(ctx,{bookingId:row._id,sessionId:row.diditSessionId}),false);
 const ready={status:'confirmed',idVerifyStatus:'verified',depositHoldAmount:100,depositHoldStatus:'held',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'}};
 assert.equal(rentalStageLabel({...ready,idVerifyStatus:'processing'}),'Awaiting verification');
 assert.equal(rentalStageLabel({...ready,verificationChecks:{...ready.verificationChecks,address:'review'}}),'Awaiting verification');
 assert.equal(rentalStageLabel({...ready,verificationArchiveReady:false}),'Saving verification documents');
 assert.equal(rentalStageLabel({...ready,requiresDroneLicence:true,droneLicenceStatus:'review'}),'Awaiting drone licence');
 assert.equal(rentalStageLabel({...ready,verificationExpiresAt:Date.now()-1}),'Awaiting verification');
 assert.equal(rentalStageLabel({...ready,depositHoldExpiresAt:Date.now()-1}),'Awaiting card authorisation');
 assert.equal(rentalStageLabel(ready),'Verification approved');
 assert.equal(rentalProgress(ready).index,1,'verified reservation cannot imply collected/on-rental');
 assert.equal(rentalProgress({...ready,status:'active'}).index,2);
 console.log('PASS Didit progress: authenticated bound provider decisions, feature checks, missing address, per-booking concurrency limit, archive/drone/expiry readiness and paid-versus-handover labels. No financial calls.');
})().catch(e=>{console.error(e);process.exit(1)});
