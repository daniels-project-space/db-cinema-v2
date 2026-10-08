const assert=require('node:assert/strict');
const {load,put,db}=require('./lib/rentalTestHarness.cjs');
const ctx={db};
Object.assign(process.env,{DIDIT_API_KEY:'unused',DIDIT_WORKFLOW_ID:'workflow-1',DIDIT_WEBHOOK_SECRET:'unused',DIDIT_APPLICATION_ID:'application-1',DIDIT_ENVIRONMENT:'sandbox',INVOICE_SECRET:'progress-fixture-only'});
const {refreshProgress}=load('convex/didit.ts');
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
  assert.equal((await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'})).status,'updated');
  const saved=mutations.find(([ref])=>ref==='bookings.setDiditResult')[1];
  assert.equal(saved.status,'manual_review');assert.deepEqual(saved.checks,{identity:'approved',selfie:'review',address:'review'});
  assert.equal(saved.sessionId,booking.diditSessionId);
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
  await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'});assert.equal(mutations.find(([ref])=>ref==='bookings.setDiditResult')[1].status,'manual_review','approved features still require an attested person');
  provider.id_verifications=[{status:'Approved',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}];mutations=[];
  await refreshProgress.handler(actionCtx,{bookingId:'booking-1',accountToken:'owner'});assert.equal(mutations.find(([ref])=>ref==='bookings.setDiditResult')[1].status,'verified');
 }finally{global.fetch=previousFetch;}
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
