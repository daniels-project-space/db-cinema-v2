const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const expire=h.load('convex/credits.ts').expire;
const realNow=Date.now,now=realNow();let clock=now;Date.now=()=>clock;
const account=h.put('accounts',{email:'new-email@example.invalid'}),other=h.put('accounts',{email:'other@example.invalid'});
const rows=Array.from({length:235},(_,i)=>h.put('credits',{accountId:account._id,amount:10,remaining:10,status:'active',createdAt:now-400*86400000,expiresAt:now-1000+i}));
const reserved=rows[50],foreign=rows[150],future=h.put('credits',{accountId:account._id,status:'active',expiresAt:now+86400000});
const pending=h.put('bookings',{accountId:account._id,guestEmail:'old-email@example.invalid',status:'pending_payment',creditApplied:1,creditAllocations:[{creditId:reserved._id,amount:1,kind:'earned'}],_creationTime:now-2000});
h.put('bookings',{accountId:other._id,guestEmail:account.email,status:'pending_payment',creditApplied:1,creditAllocations:[{creditId:foreign._id,amount:1,kind:'earned'}],_creationTime:now-2000});
// Opaque, stable index-key cursor: deleted/patched rows must not shift the next
// page. This models key pagination, rather than the harness's offset fixture.
let reads=0,scheduled=0;
const db={...h.db,query(table){
 if(table!=='credits')return h.db.query(table);
 let bound=Infinity;const q={withIndex(name,fn){assert.equal(name,'by_status_expiry');fn({eq(k,v){assert.equal(k,'status');assert.equal(v,'active');return this},lte(k,v){assert.equal(k,'expiresAt');bound=v;return this}});return q},async paginate({numItems,cursor}){
  reads++;assert.equal(numItems,100);const decoded=cursor?JSON.parse(cursor):null;if(decoded)assert.equal(decoded.bound,bound,'Native cursor must retain its original index range despite wall-clock advance');const key=decoded?.key??[-Infinity,''];
  const all=(h.tables.get('credits')??[]).filter(r=>r.status==='active'&&r.expiresAt<=bound&&(r.expiresAt>key[0]||r.expiresAt===key[0]&&r._id>key[1])).sort((a,b)=>a.expiresAt-b.expiresAt||a._id.localeCompare(b._id));
  const page=all.slice(0,numItems),last=page.at(-1);return {page,isDone:all.length<=numItems,continueCursor:JSON.stringify({bound,key:last?[last.expiresAt,last._id]:key})};
 }};return q;
}};
const ctx={db,scheduler:{runAfter:async(delay,ref,args)=>{assert.equal(delay,0);assert.equal(ref,'credits.expire');scheduled++}}};
(async()=>{
 let expired=(await expire.handler(ctx,{})).expired;
 const newlyDue=h.put('credits',{accountId:account._id,amount:3,remaining:3,status:'active',createdAt:now-86400000,expiresAt:now+1});
 for(let i=1;i<3;i++){clock=now+i*1000;expired+=(await expire.handler(ctx,{})).expired;}
 assert.equal(newlyDue.status,'active','A credit becoming due during a sweep belongs to the next sweep, not a changed cursor range');
 assert.equal(expired,234);assert.equal(reads,3);assert.equal(scheduled,2);assert.equal(reserved.status,'active');assert.equal(foreign.status,'expired');assert.equal(future.status,'active');assert.equal(h.tables.get('credit_expiry_state')[0].cursor,null);assert.equal(h.tables.get('credit_expiry_state')[0].cutoffAt,undefined);
 pending.status='cancelled';assert.equal((await expire.handler(ctx,{})).expired,2);assert.equal(newlyDue.status,'expired');assert.equal(reserved.status,'expired');
 assert.equal((await expire.handler(ctx,{})).expired,0,'Repeating cleanup cannot re-expire or issue credit');
 assert.equal((h.tables.get('credits')??[]).length,237);
 const legacy=h.tables.get('credit_expiry_state')[0];legacy.cursor='old-unbound-cursor';legacy.cutoffAt=undefined;assert.equal((await expire.handler(ctx,{})).expired,0,'An old checkpoint without a cutoff is safely restarted, never reused');
 console.log('PASS actual expiry handler across 235 rows / 3 bounded pages with stable key cursors, account-bound reservations after email changes, foreign same-email exclusion, resume after checkout cancellation, future exclusion and idempotent repeat. Frozen cutoff across advancing clocks and safe old-checkpoint restart. Synthetic ledger only.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=realNow});
