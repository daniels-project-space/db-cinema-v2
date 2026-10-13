const assert=require('node:assert/strict');const {load}=require('./lib/rentalTestHarness.cjs');
const policy=load('shared/rentalSecurity.ts');const {calculateRentalPrice}=load('convex/lib/rentalPrice.ts');
for(const [value,amount]of [[0,0],[500,0],[999.99,0],[1000,50],[1000.01,50],[3999.99,50],[4000,100],[100000,100]]){
 assert.equal(policy.refundableDepositFor(value),amount);
 for(const protection of ['verify','deposit'])assert.deepEqual(policy.securityForPolicy(policy.REFUNDABLE_DEPOSIT_POLICY_VERSION,protection,value),{deposit:amount,hold:0});
}
for(const value of [-1,NaN,Infinity,Number.MAX_VALUE])assert.throws(()=>policy.refundableDepositFor(value));
assert.deepEqual(policy.securityForPolicy(policy.SECURITY_POLICY_VERSION,'verify',4000),{deposit:0,hold:0},'Old saved-card bookings retain their signed policy');
assert.deepEqual(policy.securityForPolicy(policy.LEGACY_TEN_PERCENT_HOLD_POLICY,'verify',2500),{deposit:62.5,hold:250});
const previous=process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED;
const args={items:[{listingId:'fixture-a',title:'Client title',start:Date.UTC(2027,1,1),end:Date.UTC(2027,1,1),qty:1,total:1,deposit:1},{listingId:'fixture-b',title:'Client title',start:Date.UTC(2027,1,1),end:Date.UTC(2027,1,1),qty:1,total:1,deposit:1}],customer:{email:''},fulfilment:'pickup'};
(async()=>{try{for(const enabled of [undefined,'false','true'])for(const value of [999.99,1000,3999.99,4000]){if(enabled===undefined)delete process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED;else process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED=enabled;const ctx={runQuery:async(ref)=>{assert.equal(ref,'catalog.repriceLines');return args.items.map(()=>({title:'Canonical fixture',total:20,deposit:value/2,dailyRate:20}))}};const q=await calculateRentalPrice(ctx,args);const canonicalValue=2*Math.round(value/2*100)/100;assert.equal(q.replacementSum,canonicalValue,"Each authoritative equipment unit is penny-rounded before aggregation");const cash=enabled==='true'?policy.refundableDepositFor(canonicalValue):0;assert.equal(q.depositAmount,cash,'Combined authoritative listing values determine deposit, never browser amount');assert.equal(q.depositHoldAmount,0);assert.equal(q.securityPolicyVersion,enabled==='true'?policy.REFUNDABLE_DEPOSIT_POLICY_VERSION:policy.SECURITY_POLICY_VERSION);assert.equal(q.totalDue,40+cash);assert.equal(q.savedCardLimit,policy.savedCardChargeLimit(canonicalValue));assert.equal(q.securityWaiverReason,undefined);}console.log('PASS real quote: authoritative combined equipment thresholds, no hold, deposit in total, unchanged historic policy, explicit rollout gate.');}finally{if(previous===undefined)delete process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED;else process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED=previous}})().catch(e=>{console.error(e);process.exitCode=1});
const {refundableDepositPlan}=load('shared/returnSettlement.ts');
assert.deepEqual(refundableDepositPlan({deposit:50,capturedSecurity:50,assessedDamage:0}),{damageFromDeposit:0,damageFromHold:0,depositRefund:50,holdRelease:0,availableSecurity:50,damageAfterDeposit:0});
assert.deepEqual(refundableDepositPlan({deposit:100,capturedSecurity:100,assessedDamage:20}),{damageFromDeposit:20,damageFromHold:0,depositRefund:80,holdRelease:0,availableSecurity:100,damageAfterDeposit:0});
assert.equal(refundableDepositPlan({deposit:50,capturedSecurity:50,assessedDamage:150}).damageAfterDeposit,100);
assert.equal(refundableDepositPlan({deposit:100,capturedSecurity:100,assessedDamage:150,keptDeposit:25}).depositRefund,75);
assert.throws(()=>refundableDepositPlan({deposit:100,capturedSecurity:50,assessedDamage:0}),/fully accounted/);
assert.throws(()=>refundableDepositPlan({deposit:100,capturedSecurity:100,assessedDamage:20,keptDeposit:21}),/evidenced damage/);
assert.throws(()=>refundableDepositPlan({deposit:50,capturedSecurity:50,assessedDamage:100,keptDeposit:51}),/within the paid deposit/);
