const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='credit-grant-fixture-admin';
const credits=h.load('convex/accountCredits.ts'),checkoutCredit=h.load('convex/lib/checkoutCredit.ts');
const account=h.put('accounts',{email:'owner-credit@example.invalid'}),other=h.put('accounts',{email:'other@example.invalid'}),now=Date.now();
h.put('sessions',{token:'owned-credit-token',accountId:account._id,expiresAt:now+86400000});
const ctx={db:h.db,scheduler:{runAfter:async()=>{}}},args={token:process.env.ADMIN_TOKEN,accountId:account._id,amount:10,requestId:'fixture-admin-credit-012345',confirmed:true};
(async()=>{
 await assert.rejects(credits.grantAdmin.handler(ctx,{...args,token:'wrong'}),/unauthorized/i);assert.equal((h.tables.get('credits')??[]).length,0);
 await assert.rejects(credits.grantAdmin.handler(ctx,{...args,confirmed:false}),/Review and confirm/);
 for(const amount of [0,-10,0.001,NaN,Infinity])await assert.rejects(credits.grantAdmin.handler(ctx,{...args,amount}),/positive credit amount/);
 const result=await credits.grantAdmin.handler(ctx,args);assert.equal(result.amount,10);assert.equal(result.replayed,false);const row=await h.db.get(result.creditId);assert.equal(row.expiresAt-row.createdAt,365*86400000);assert.equal(row.kind,'earned');
 const oldNow=Date.now;Date.now=()=>now+86400000;try{const retry=await credits.grantAdmin.handler(ctx,args);assert.equal(retry.creditId,result.creditId);assert.equal(retry.expiresAt,result.expiresAt);assert.equal(retry.replayed,true);}finally{Date.now=oldNow}
 assert.equal((await credits.statement.handler(ctx,{token:process.env.ADMIN_TOKEN,creditId:row._id})).amount,10);assert.equal((await credits.statement.handler(ctx,{token:'owned-credit-token',creditId:row._id})).email,account.email);h.put('sessions',{token:'other-credit-token',accountId:other._id,expiresAt:now+86400000});await assert.rejects(credits.statement.handler(ctx,{token:'other-credit-token',creditId:row._id}),/Unauthorized/);
 assert.equal(h.tables.get('credits').length,1);assert.equal(h.tables.get('credit_issues').length,1);assert.equal(h.tables.get('account_admin_changes').filter(r=>r.kind==='credit_grant').length,1);
 await assert.rejects(credits.grantAdmin.handler(ctx,{...args,amount:20}),/different particulars/);await assert.rejects(credits.grantAdmin.handler(ctx,{...args,accountId:other._id}),/different particulars/);
 assert.equal((await credits.balance.handler(ctx,{token:'owned-credit-token'})).available,10);await assert.rejects(credits.balance.handler(ctx,{token:'foreign-token'}),/Sign in/);
 const pending=h.put('bookings',{accountId:account._id,guestEmail:'previous-email@example.invalid',status:'pending_payment',creditApplied:3,creditAllocations:[{creditId:row._id,amount:3,kind:'earned'}]});
 assert.equal((await credits.balance.handler(ctx,{token:'owned-credit-token'})).available,7,'Permanent account allocations survive email changes');
 h.put('bookings',{accountId:other._id,guestEmail:account.email,status:'pending_payment',creditApplied:9,creditAllocations:[{creditId:row._id,amount:9,kind:'earned'}]});
 assert.equal((await credits.balance.handler(ctx,{token:'owned-credit-token'})).available,7,'Foreign same-email booking cannot reserve another account credit');
 pending.status='cancelled';assert.equal((await credits.balance.handler(ctx,{token:'owned-credit-token'})).available,10);
 row.expiresAt=now-1;assert.equal((await credits.balance.handler(ctx,{token:'owned-credit-token'})).available,0,'Expired credit is unavailable even before scheduled cleanup');
 console.log('PASS actual admin credit grant and balance: owner-only, explicit confirmation, exact GBP/365-day expiry, immutable same-request retry and changed-particular rejection, account-bound reservations across email changes, foreign/expired exclusion. Synthetic data only.');
})().catch(e=>{console.error(e);process.exitCode=1});
