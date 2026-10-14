const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const expire=h.load('convex/credits.ts').expire;
const now=Date.now(),account=h.put('accounts',{email:'new-email@example.invalid'}),other=h.put('accounts',{email:'other@example.invalid'});
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
  reads++;assert.equal(numItems,100);const key=cursor?JSON.parse(cursor):[-Infinity,''];
  const all=(h.tables.get('credits')??[]).filter(r=>r.status==='active'&&r.expiresAt<=bound&&(r.expiresAt>key[0]||r.expiresAt===key[0]&&r._id>key[1])).sort((a,b)=>a.expiresAt-b.expiresAt||a._id.localeCompare(b._id));
  const page=all.slice(0,numItems),last=page.at(-1);return {page,isDone:all.length<=numItems,continueCursor:JSON.stringify(last?[last.expiresAt,last._id]:key)};
 }};return q;
}};
const ctx={db,scheduler:{runAfter:async(delay,ref,args)=>{assert.equal(delay,0);assert.equal(ref,'credits.expire');scheduled++}}};
(async()=>{
 let expired=0;for(let i=0;i<3;i++)expired+=(await expire.handler(ctx,{})).expired;
 assert.equal(expired,234);assert.equal(reads,3);assert.equal(scheduled,2);assert.equal(reserved.status,'active');assert.equal(foreign.status,'expired');assert.equal(future.status,'active');assert.equal(h.tables.get('credit_expiry_state')[0].cursor,null);
 pending.status='cancelled';assert.equal((await expire.handler(ctx,{})).expired,1);assert.equal(reserved.status,'expired');
 assert.equal((await expire.handler(ctx,{})).expired,0,'Repeating cleanup cannot re-expire or issue credit');
 assert.equal((h.tables.get('credits')??[]).length,236);
 console.log('PASS actual expiry handler across 235 rows / 3 bounded pages with stable key cursors, account-bound reservations after email changes, foreign same-email exclusion, resume after checkout cancellation, future exclusion and idempotent repeat. Synthetic ledger only.');
})().catch(e=>{console.error(e);process.exitCode=1});
