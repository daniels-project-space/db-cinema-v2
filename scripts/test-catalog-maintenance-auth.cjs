const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='synthetic-admin-token';
const sync=load('convex/sync.ts');
const row=put('listings',{title:'Sony FX3 Camera',slug:'fixture-camera',category:'Cameras',itemType:'camera-body',components:[],specs:{}});
const ctx={db};
(async()=>{
 const missing=spawnSync(process.execPath,[path.join(__dirname,'vision-cat.mjs'),'ignored-argument'],{env:{...process.env,ADMIN_TOKEN:'',apply:'1'},encoding:'utf8'});
 assert.notEqual(missing.status,0);assert.match(missing.stderr,/ADMIN_TOKEN is required/);
 for(const [name,args] of [['setItemTypes',{updates:[{id:row._id,itemType:'drone'}]}],['reclassify',{}],['recategorize',{}],['respec',{}]]){
  const before=JSON.stringify(row);
  await assert.rejects(sync[name].handler(ctx,{...args,token:'wrong'}));
  assert.equal(JSON.stringify(row),before,`${name} must not mutate listings without authorization`);
  const result=await sync[name].handler(ctx,{...args,token:process.env.ADMIN_TOKEN});
  assert(result && typeof result==='object',`${name} remains usable by an authorized operator`);
 }
 const admin=load('convex/adminAuth.ts');let requests=0;
 const previousFetch=global.fetch;
 process.env.RMV2_WEBHOOK_URL='https://fixture.convex.site/dbcinema/booking-sync';process.env.RMV2_WEBHOOK_SECRET='synthetic-secret';
 global.fetch=async()=>{requests++;return {ok:true,json:async()=>({protocolVersion:1,status:'success',path:'items:listForReconcile',value:[]})}};
 const camera=put('listings',{title:'Sony FX3 Camera',itemType:'camera-body',components:[]});
 const actionCtx={runQuery:async()=>[camera],runMutation:async(ref,args)=>ref==='adminAuth.assertAdminInternal'?admin.assertAdminInternal.handler(ctx,args):sync.suppressByIds.handler(ctx,args)};
 try{
  await assert.rejects(sync.reconcileCameras.handler(actionCtx,{apply:true,token:'wrong'}),/unauthorized/);
  await assert.rejects(sync.reconcileCameras.handler(actionCtx,{apply:false,token:'wrong'}),/unauthorized/);
  assert.equal(requests,0);assert.equal(camera.suppressed,undefined);
  assert.equal((await sync.reconcileCameras.handler(actionCtx,{apply:false,token:process.env.ADMIN_TOKEN})).phantomCount,1);
  assert.equal(camera.suppressed,undefined,'Authorized preview remains read-only');
  await sync.reconcileCameras.handler(actionCtx,{apply:true,token:process.env.ADMIN_TOKEN});
  assert.equal(camera.suppressed,true,'Authorized reconcile can still apply');
 }finally{global.fetch=previousFetch}
 console.log('PASS catalogue maintenance: four mutation handlers and reconcile writes reject unauthorized use; authorized operations and read-only preview work.');
})().catch(error=>{console.error(error);process.exitCode=1});
