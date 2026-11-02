const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const rollups=h.load('convex/encoreRollups.ts'),tasks=[],ctx={db:h.db,scheduler:{runAfter:async(delay,ref,args)=>tasks.push({delay,ref,args})}};
const realNow=Date.now;let now=realNow();Date.now=()=>now;
delete process.env.RMV2_WEBHOOK_URL;delete process.env.RMV2_WEBHOOK_SECRET;
(async()=>{
 await rollups.recover.handler(ctx,{});assert.equal(tasks.length,0,'empty recovery does not start a sweep');
 const records=[];
 for(let index=0;index<121;index++){const account=h.put('accounts',{email:`rollup-${index}@example.invalid`});records.push(h.put('encore_account_rollups',{accountId:account._id,generation:1,state:'ready',candidates:[],updatedAt:now-30*60000,dueAt:now-16*60000}));}
 const failedAccount=h.put('accounts',{email:'failed@example.invalid'}),failed=h.put('encore_account_rollups',{accountId:failedAccount._id,generation:1,state:'running',candidates:[],updatedAt:now-30*60000,dueAt:now-16*60000});
 await rollups.recover.handler(ctx,{});const sweep=h.tables.get('encore_rollup_sweeps')[0],initial=sweep.generation;assert.equal(tasks.length,1);
 await rollups.recover.handler(ctx,{});assert.equal(tasks.length,1,'overlapping cron does not create a second sweep');
 const first=tasks.shift();await rollups.recoverPage.handler(ctx,first.args);const count=tasks.length;await rollups.recoverPage.handler(ctx,{generation:initial});assert.equal(tasks.length,count,'stale continuation cannot schedule duplicate workers');
 assert(tasks.some(task=>task.ref==='encoreRollups.alertBacklog'));assert(tasks.some(task=>task.ref==='encoreRollups.recoverPage'&&task.delay===5000));
 let workerCount=0,continuations=0,alerts=0;
 while(tasks.length){const task=tasks.shift();if(task.delay)now+=task.delay;
  if(task.ref==='encoreRollups.recoverPage'){continuations++;await rollups.recoverPage.handler(ctx,task.args);}
  else if(task.ref==='encoreRollups.page'){workerCount++;if(task.args.accountId!==failedAccount._id)await rollups.page.handler(ctx,task.args);}
  else if(task.ref==='encoreRollups.alertBacklog'){alerts++;await rollups.alertBacklog.handler(ctx,task.args);}
 }
 assert.equal(workerCount,122,'every due account is scheduled once, including the failed worker');assert(continuations>=6,'more than 100 accounts use bounded continuation pages');
 assert(records.every(row=>row.state==='ready'&&row.dueAt>now),'one failed account does not prevent other accounts from refreshing');
 assert.equal(failed.state,'running');assert.equal(sweep.state,'idle');assert.equal(alerts,1);assert.equal((h.tables.get('admin_notifications')??[]).length,1,'material lag emits one owner notification');
 await rollups.alertBacklog.handler(ctx,{rollupId:failed._id});assert.equal(h.tables.get('admin_notifications').length,1,'repeated alerts deduplicate');
 await rollups.page.handler(ctx,{accountId:failedAccount._id,generation:failed.generation});await rollups.alertBacklog.handler(ctx,{rollupId:failed._id});assert.equal(h.tables.get('admin_notifications').length,1,'a recovered rollup does not emit a new alert');tasks.length=0;
 now+=15*60000;await rollups.recover.handler(ctx,{});const start=tasks.shift(),lost=sweep.generation;assert.equal(start.ref,'encoreRollups.recoverPage');
 now+=5*60000;await rollups.recover.handler(ctx,{});assert(sweep.generation>lost,'expired sweep lease is recovered by the existing cron');
 const queued=tasks.length;await rollups.recoverPage.handler(ctx,{generation:lost});assert.equal(tasks.length,queued,'lost worker cannot resume an obsolete generation');
 now+=86400000;tasks.length=0;await h.db.patch(sweep._id,{state:'idle',leaseUntil:0,alertDueAt:0});for(const row of [...records,failed])await h.db.patch(row._id,{state:'ready',dueAt:now+3600000,recoveryStartedAt:undefined});
 const persistentAccount=h.put('accounts',{email:'persistent@example.invalid'}),persistent=h.put('encore_account_rollups',{accountId:persistentAccount._id,generation:1,state:'ready',candidates:[],updatedAt:now,dueAt:now});
 for(let attempt=0;attempt<4;attempt++){
  await rollups.recover.handler(ctx,{});const check=tasks.shift();assert.equal(check.ref,'encoreRollups.recoverPage');await rollups.recoverPage.handler(ctx,check.args);
  const alert=tasks.find(task=>task.ref==='encoreRollups.alertBacklog');if(attempt<3)assert(!alert,'healthy retry window does not alert early');else {assert(alert,'persistent failures alert once 15 minutes overdue');await rollups.alertBacklog.handler(ctx,alert.args);}
  tasks.length=0;now+=5*60000;
 }
 assert.equal(persistent.state,'running');assert.equal(h.tables.get('admin_notifications').length,2,'a separately persistent failure produces its own daily alert');
 console.log('PASS Encore rollup recovery: bounded 122-account catch-up, single flight, 5-second pacing, isolated worker failures, alert dedup/recovery and expired-lease fencing.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{Date.now=realNow});
