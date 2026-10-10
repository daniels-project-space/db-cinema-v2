/** Actual account-bound review picker pages; no live accounts or provider writes. */
const assert = require('node:assert/strict');
const {load,db,put} = require('./lib/rentalTestHarness.cjs');
const prize = load('convex/reviewPrize.ts');
(async()=>{
 const owner=put('accounts',{email:'current@example.invalid'}),reused=put('accounts',{email:'previous@example.invalid'});
 for(const [account,token] of [[owner,'owner'],[reused,'reused']])put('sessions',{accountId:account._id,token,expiresAt:Date.now()+60000});
 const base={status:'returned',lineItems:[{title:'Camera'}],depositAmount:0,depositHoldAmount:0,actualReturnedAt:Date.now()};
 const expected=[];
 for(let i=0;i<237;i++)expected.push(put('bookings',{...base,_id:`bookings-review-${String(i).padStart(3,'0')}`,_creationTime:Math.floor(i/3),...(i%2?{accountId:owner._id,guestEmail:reused.email}:{guestEmail:owner.email})}));
 const foreign=put('bookings',{...base,accountId:reused._id,guestEmail:owner.email,_creationTime:1000});
 const unsettled=put('bookings',{...base,accountId:owner._id,depositAmount:50,depositRefunded:false,_creationTime:1001});
 // Older eligible history must remain reachable through a large ineligible prefix.
 for(let i=0;i<125;i++)put('bookings',{...base,accountId:owner._id,status:'active',_creationTime:2000+i});
 expected.sort((a,b)=>b._creationTime-a._creationTime||b._id.localeCompare(a._id));
 let reads=0;const measured={...db,query(table){const q=db.query(table),iterator=q[Symbol.asyncIterator];q[Symbol.asyncIterator]=async function*(){for await(const row of iterator.call(this)){if(table==='bookings')reads++;yield row;}};return q;}};
 const ctx={db:measured},page=(token,cursor=null,opts={})=>prize.rentalsPage.handler(ctx,{token,paginationOpts:{numItems:17,cursor,...opts}});
 let cursor=null,previous=0;const seen=[],pages=[];
 do{const r=await page('owner',cursor);pages.push(r);seen.push(...r.page.map(b=>b._id));assert(reads-previous<=103,'Indexed page reads remain bounded even through rejected history');previous=reads;assert(pages.length<30);if(r.isDone)break;assert.notEqual(r.continueCursor,cursor);cursor=r.continueCursor;}while(true);
 assert.equal(pages[0].page.length,0,'Ineligible prefix has a real advancing page, not a false empty history');
 assert.deepEqual(seen,expected.map(b=>b._id));assert.equal(new Set(seen).size,237);assert(!seen.includes(foreign._id));assert(!seen.includes(unsettled._id));
 const borrowed=await page('reused',pages[0].continueCursor);assert(!borrowed.page.some(b=>seen.includes(b._id)),'Cursor cannot confer rental ownership');
 await assert.rejects(()=>page('invalid'),/sign in/);
 for(const n of [0,-1,1.5])await assert.rejects(()=>page('owner',null,{numItems:n}),/Invalid rental page size/);
 const selected=expected[0];assert.equal((await prize.rental.handler(ctx,{token:'owner',bookingId:selected._id}))._id,selected._id);
 await assert.rejects(()=>prize.rental.handler(ctx,{token:'reused',bookingId:selected._id}),/not available to your account/);
 assert.equal(await prize.rental.handler(ctx,{token:'owner',bookingId:unsettled._id}),null,'Selected unreturned/unsettled history cannot bypass eligibility');
 const recent=await prize.mine.handler(ctx,{token:'owner'});assert(recent.bookings.length<=20);assert.equal(recent.bookingsHasMore,true);
 assert.deepEqual((await prize.mine.handler(ctx,{token:'owner',includeBookings:false})).bookings,[],'New UI avoids duplicate picker reads in the entry query');
 console.log('PASS real story picker: all237 permanent/legacy rentals, changed/reused email, bounded reads through125 rejected rows, empty advancing pages, tied timestamps, borrowed cursors, auth/page bounds, exact selected rental and unsettled rejection. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
