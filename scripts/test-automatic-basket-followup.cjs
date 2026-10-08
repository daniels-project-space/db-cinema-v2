/** Real recovery mutations/worker with controlled clock, DB and delivery; no provider writes. */
const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const recovery=h.load('convex/checkoutRecovery.ts'),lib=h.load('convex/lib/checkoutRecovery.ts');
const originalNow=Date.now;let now=Date.parse('2026-10-09T12:00:00Z');Date.now=()=>now;
const owner=h.put('accounts',{email:'owner@example.invalid'}),foreign=h.put('accounts',{email:'recycled@example.invalid'});
h.put('sessions',{token:'owner',accountId:owner._id,expiresAt:now+10*86400000});
const listing=h.put('listings',{title:'Marketing cinema kit',active:true,marketingOnly:true,displayOnly:true,components:[],pricing:{daily:50}});
const lines=[{listingId:listing._id,qty:1,start:Date.parse('2026-11-01T00:00Z'),end:Date.parse('2026-11-02T00:00Z'),pickupTime:'18:00',returnTime:'09:00'}],ctx={db:h.db};
let deliveries=0;const delivered=[];h.setMock('./lib/mailer',{sendMail:async m=>{deliveries++;delivered.push(m);return true}});const mail=h.load('convex/checkoutRecoveryMail.ts');
const worker={runQuery:(ref,args)=>recovery[ref.split('.').at(-1)].handler(ctx,args),runMutation:(ref,args)=>recovery[ref.split('.').at(-1)].handler(ctx,args)};
(async()=>{
 process.env.CHECKOUT_RECOVERY_ENABLED='true';process.env.RENTAL_CHECKOUT_ENABLED='true';
 await assert.rejects(()=>recovery.sync.handler(ctx,{token:'foreign',lines}),/sign in/);
 const id=await recovery.sync.handler(ctx,{token:'owner',lines}),row=await h.db.get(id);assert.equal(row.dueAt,now+30*60000);assert.equal(row.accountId,owner._id);
 now+=29*60000;assert.equal(await recovery._claim.handler(ctx,{id}),null,'No reminder before 30 minutes');
 await recovery.sync.handler(ctx,{token:'owner',enabled:false,lines});assert.equal(row.dueAt,now+30*60000,'Old clients cannot disable populated automatic baskets');
 const due=row.dueAt;await recovery.sync.handler(ctx,{token:'owner',lines});assert.equal(row.dueAt,due,'Immediate repeats do not churn writes');
 now+=30*60000;const claim=await recovery._claim.handler(ctx,{id});assert(claim,'Marketing/unavailable inventory still receives a current-availability recovery');assert.equal(row.dueAt,claim.leaseUntil,'Leased work leaves the due prefix');
 assert.equal(await recovery._claim.handler(ctx,{id}),null,'Concurrent worker cannot claim leased email');assert(await recovery._ready.handler(ctx,claim));
 now+=60000;await recovery.sync.handler(ctx,{token:'owner',lines});assert.equal(await recovery._ready.handler(ctx,claim),false,'New activity invalidates claimed mail');
 await recovery._finish.handler(ctx,{id,leaseUntil:claim.leaseUntil,sent:true});assert.equal(row.state,'waiting','Old worker receipt cannot overwrite renewed basket');
 const changed=[{...lines[0],pickupTime:'19:00'}];await recovery.sync.handler(ctx,{token:'owner',lines:changed});assert.equal(row.lines[0].pickupTime,'19:00','Latest clock selection is saved');
 now=row.dueAt;const crashed=await recovery._claim.handler(ctx,{id});assert(crashed);now=crashed.leaseUntil+1;const reclaimed=await recovery._claim.handler(ctx,{id});assert(reclaimed,'Killed worker lease becomes recoverable');
 await recovery._finish.handler(ctx,{id,leaseUntil:crashed.leaseUntil,sent:true});assert.equal(row.leaseUntil,reclaimed.leaseUntil,'Stale completion cannot consume recovered work');
 await recovery._finish.handler(ctx,{id,leaseUntil:reclaimed.leaseUntil,sent:false});assert.equal(row.state,'waiting');assert(row.dueAt>now,'Rejected delivery retries with backoff');
 now=row.dueAt;assert.equal((await mail.processDue.handler(worker,{})).sent,1);assert.equal(deliveries,1);assert.equal(row.state,'sent');assert.equal(delivered[0].to,'owner@example.invalid');assert(delivered[0].html.includes('/plan?recovery='+id));assert(!delivered[0].html.includes('You asked us'));assert(!delivered[0].html.includes('checkbox'));if(process.env.DBC_EMAIL_RENDER_DIR){require('node:fs').mkdirSync(process.env.DBC_EMAIL_RENDER_DIR,{recursive:true});require('node:fs').writeFileSync(require('node:path').join(process.env.DBC_EMAIL_RENDER_DIR,'basket-followup.html'),delivered[0].html)}
 await recovery.sync.handler(ctx,{token:'owner',lines:[{...changed[0],pickupTime:'21:00'}]});assert.equal(row.lines[0].pickupTime,'21:00','Already sent recovery links still show the latest selected clocks');assert.equal(row.state,'sent');now+=3600000;assert.equal((await mail.processDue.handler(worker,{})).sent,0,'Same recovered basket never sends twice');
 await recovery.sync.handler(ctx,{token:'owner',lines:[]});assert.equal(row.state,'stopped','Empty basket stops its record');
 const secondLines=[{...lines[0],end:Date.parse('2026-11-03T00:00Z')}];const second=await recovery.sync.handler(ctx,{token:'owner',lines:secondLines});now+=30*60000;assert.equal(await recovery._claim.handler(ctx,{id:second}),null,'Account frequency cap survives a new basket');
 now+=86400000;process.env.RENTAL_CHECKOUT_ENABLED='false';assert.deepEqual(await recovery._due.handler(ctx,{}),[]);assert.equal(await recovery._claim.handler(ctx,{id:second}),null,'Paused checkout never emits reminders');process.env.RENTAL_CHECKOUT_ENABLED='true';
 // Permanent account ownership suppresses paid kits after an account email change.
 await h.db.patch(owner._id,{email:'changed@example.invalid'});
 const booking=h.put('bookings',{accountId:owner._id,guestEmail:'recycled@example.invalid',status:'confirmed',lineItems:secondLines});
 assert.equal(await recovery._claim.handler(ctx,{id:second}),null);assert.equal((await h.db.get(second)).state,'stopped','Paid linked rental stops recovery despite email change');
 h.put('sessions',{token:'foreign-owner',accountId:foreign._id,expiresAt:now+86400000});
 const recycledId=await recovery.sync.handler(ctx,{token:'foreign-owner',lines:secondLines});assert(recycledId,'A foreign linked rental does not suppress the reused mailbox account');
 const foreignId=await recovery.sync.handler(ctx,{token:'owner',lines:[{...lines[0],end:Date.parse('2026-11-04T00:00Z')}]});
 await lib.stopMatchingRecovery(ctx,foreign.email,secondLines,booking._id);assert.equal((await h.db.get(recycledId)).state,'waiting','Permanent booking owner never targets reused guest email');
 await h.db.patch(owner._id,{blockedAt:now});now+=30*60000;assert.equal(await recovery._claim.handler(ctx,{id:foreignId}),null);assert.equal((await h.db.get(foreignId)).state,'stopped','Blocked accounts cannot receive recovery');
 const restoreOwner=h.put('accounts',{email:'restore@example.invalid'});h.put('sessions',{token:'restore',accountId:restoreOwner._id,expiresAt:now+86400000});
 const mixed=[{...lines[0],qty:2},{...lines[0],start:Date.parse('2026-11-05T00:00Z'),end:Date.parse('2026-11-08T00:00Z'),pickupTime:'20:00',returnTime:'12:00'}];
 const mixedId=await recovery.sync.handler(ctx,{token:'restore',lines:mixed});
 const resumed=await recovery.resume.handler(ctx,{token:'restore',id:mixedId});assert.deepEqual(resumed.lines,mixed);assert.equal(resumed.cartLines[0].days,2);assert.equal(resumed.cartLines[1].days,4);assert.equal(resumed.cartLines[1].pickupTime,'20:00');assert.equal(resumed.cartLines[1].returnTime,'12:00');
 const expanded=h.load('shared/kitCart.ts').expandKitCart(resumed.cartLines);assert.equal(expanded.length,3);assert.equal(expanded[2].start,'2026-11-05');assert.equal(expanded[2].end,'2026-11-08');assert.equal(expanded[2].total,180);assert.equal(expanded[2].pickupTime,'20:00');assert.equal(expanded[2].returnTime,'12:00');
 assert.equal(await recovery.resume.handler(ctx,{token:'restore',id:'malformed'}),null,'Invalid links get a safe unavailable response');
 assert.equal(await recovery.resume.handler(ctx,{token:'foreign-owner',id:mixedId}),null,'Recovery is private to its permanent owner');
 const limited=h.put('accounts',{email:'limited@example.invalid'});h.put('sessions',{token:'limited',accountId:limited._id,expiresAt:now+86400000});for(let i=0;i<60;i++)await recovery.sync.handler(ctx,{token:'limited',lines});await assert.rejects(()=>recovery.sync.handler(ctx,{token:'limited',lines}),/Please wait/,'Repeated identical saves are rate-limited, not just new baskets');
 console.log('PASS automatic 30-minute basket recovery: auth, activity, throttling, clock persistence, unavailable inventory, leasing/crash recovery, stale fencing, delivery retry, sent dedup, clearing, daily cap, pause gates and permanent account ownership; mixed-period quantities, current quotes and exact clock restoration; malformed/private links and repeated-call rate limiting. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=originalNow});
