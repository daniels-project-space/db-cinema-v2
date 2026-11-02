const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const state=h.load('convex/membershipReconcileState.ts'),tasks=[],ctx={db:h.db,scheduler:{runAfter:async(delay,ref,args)=>tasks.push({delay,ref,args})}};
process.env.MEMBERSHIP_BOUNDED_RECONCILE_ENABLED='true';
(async()=>{
 const now=Date.now();h.put('accounts',{email:'no-sub@example.invalid'});
 for(let index=0;index<4;index++)h.put('accounts',{email:`sweep-${index}@example.invalid`,stripeSubscriptionId:`sub-${index}`});
 await state.schedule.handler(ctx,{});const row=h.tables.get('membership_reconcile_sweeps')[0],first=row.generation;
 await state.schedule.handler(ctx,{});assert.equal(tasks.length,1,'a live lease is single-flight');
 let page=await state.next.handler(ctx,{generation:first});assert.equal(page.account.stripeSubscriptionId,'sub-0');
 await state.advance.handler(ctx,{generation:first,cursor:page.cursor,done:page.done});const second=row.generation;
 assert.equal(tasks.at(-1).delay,5000);assert.equal(await state.advance.handler(ctx,{generation:first,cursor:page.cursor,done:page.done}),false,'stale workers cannot advance the cursor');
 page=await state.next.handler(ctx,{generation:second});assert.equal(page.account.stripeSubscriptionId,'sub-1');
 await state.advance.handler(ctx,{generation:second,cursor:page.cursor,done:page.done,failure:'provider_unavailable',accountId:page.account._id});
 assert(h.tables.get('admin_notifications').some(notification=>notification.accountId===page.account._id),'failed subscription is actionable');
 const oldNow=Date.now;Date.now=()=>now+31*60000;
 try{await state.schedule.handler(ctx,{})}finally{Date.now=oldNow}
 assert(row.generation>second+1,'lost worker lease is recovered without restarting the scan');
 page=await state.next.handler(ctx,{generation:row.generation});assert.equal(page.account.stripeSubscriptionId,'sub-2');
 Date.now=()=>now+62*60000;try{await state.schedule.handler(ctx,{})}finally{Date.now=oldNow}
 Date.now=()=>now+93*60000;try{await state.schedule.handler(ctx,{})}finally{Date.now=oldNow}
 assert(h.tables.get('admin_notifications').some(notification=>notification.title==='Membership check stalled'),'repeatedly stalled account is surfaced');
 page=await state.next.handler(ctx,{generation:row.generation});assert.equal(page.account.stripeSubscriptionId,'sub-3','stalled account cannot starve later subscribers');
 await state.advance.handler(ctx,{generation:row.generation,cursor:page.cursor,done:page.done});assert.equal(row.state,'ready');assert(row.dueAt>Date.now()+5*3600000);
 console.log('PASS membership sweep: indexed one-account pages, bounded continuation, stale fence, lost-lease recovery, owner alert and six-hour restart.');
})().catch(error=>{console.error(error);process.exitCode=1});
