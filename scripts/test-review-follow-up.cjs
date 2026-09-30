const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function load(file,extra={}) {
 const code=ts.transpileModule(fs.readFileSync(require.resolve('../'+file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const mod={exports:{}};const refs=new Proxy({},{get:(_,module)=>new Proxy({},{get:(_,fn)=>`${module}.${fn}`})});
 new Function('require','module','exports',code)(p=>extra[p]??(p==='./_generated/server'?{internalAction:x=>x,internalMutation:x=>x,internalQuery:x=>x}:p==='./_generated/api'?{internal:refs,api:refs}:p==='convex/values'?{v:new Proxy({},{get:()=>()=>0})}:{}),mod,mod.exports);return mod.exports;
}
const rules=load('convex/lib/reviewEligibility.ts');const state=load('convex/reviewFollowUpState.ts',{'./lib/reviewEligibility':rules});
let refunds=[],hold={status:'canceled',amount_received:0},providerFails=false,mailOk=true,emails=0;
class Stripe {constructor(){this.refunds={list:()=>({async *[Symbol.asyncIterator](){if(providerFails)throw Error('offline');for(const r of refunds)yield r}})};this.paymentIntents={retrieve:async()=>hold};}}
const actions=load('convex/reviewFollowUp.ts',{'./lib/reviewEligibility':rules,'stripe':{default:Stripe},'./lib/mailer':{sendMail:async()=>{emails++;return mailOk}}});
let now=1700000000000;const realNow=Date.now;Date.now=()=>now;const oldKey=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='fixture';
const base=()=>({_id:'booking',status:'returned',guestEmail:'renter@example.com',depositAmount:100,depositRefunded:true,depositRefundAmount:100,depositKept:0,stripePaymentIntentId:'pi_fixture',stripeDepositIntentId:'pi_hold',depositHoldAmount:200,depositHoldStatus:'released',returnedAt:now-86400000,lineItems:[{end:now-86400000,title:'Fixture camera'}]});
function ctxFor(b){const ctx={db:{get:async()=>b,patch:async(_,p)=>Object.assign(b,p)}};return {runQuery:async ref=>ref==='settings.get'?{googleReviewUrl:'https://example.com/review'}:[b],runMutation:(ref,args)=>ref.endsWith('recordCheck')?state.recordCheck.handler(ctx,args):state.recordSent.handler(ctx,args)};}
(async()=>{
 for(const [patch,expected] of [[{status:'active'},'not_returned'],[{depositRefunded:false},'refund_not_settled'],[{depositRefundAmount:99},'partial_refund'],[{depositKept:1},'deposit_retained'],[{depositHoldCapturedForDamage:1},'deposit_retained'],[{returnDecision:{damageKept:1}},'deposit_retained'],[{lateFeePaidFromHold:1},'deposit_retained'],[{lateFeeAmount:10,lateFeeStatus:'notice_sent'},'late_settlement_pending']]) assert.equal(rules.reviewGate({...base(),...patch}),expected);
 refunds=[{amount:10000,currency:'gbp',status:'pending'}];assert.equal(await actions.providerReviewGate(base(),new Stripe()),'refund_pending_or_failed');
 refunds=[{amount:9999,currency:'gbp',status:'succeeded'}];assert.equal(await actions.providerReviewGate(base(),new Stripe()),'refund_pending_or_failed');
 refunds=[{amount:10000,currency:'gbp',status:'succeeded'},{amount:100,currency:'gbp',status:'failed'}];assert.equal(await actions.providerReviewGate(base(),new Stripe()),'refund_pending_or_failed');
 refunds=[{amount:10000,currency:'gbp',status:'succeeded'}];hold={status:'requires_capture',amount_received:0};assert.equal(await actions.providerReviewGate(base(),new Stripe()),'hold_release_pending');
 hold={status:'succeeded',amount_received:100};assert.equal(await actions.providerReviewGate(base(),new Stripe()),'deposit_retained');hold={status:'canceled',amount_received:0};
 assert.equal(await actions.providerReviewGate({...base(),stripePaymentIntentId:undefined},new Stripe()),'refund_unverified');
 assert.equal(await actions.providerReviewGate({...base(),stripeDepositIntentId:undefined},new Stripe()),'hold_release_unverified');
 const b=base(),ctx=ctxFor(b);
 await actions.processDue.handler(ctx,{});assert.equal(emails,0);assert.equal(b.reviewFollowUpReason,'post_refund_wait');
 now+=2*86400000;refunds=[{amount:10000,currency:'gbp',status:'pending'}];await actions.processDue.handler(ctx,{});assert.equal(emails,0,'later cron still waits on provider');
 refunds=[{amount:10000,currency:'gbp',status:'succeeded'}];await Promise.all([actions.processDue.handler(ctx,{}),actions.processDue.handler(ctx,{})]);assert.equal(emails,1,'concurrent sends claim once');assert.equal(b.remindedReview,true);assert.equal(b.reviewFollowUpStatus,'sent');
 await actions.processDue.handler(ctx,{});assert.equal(emails,1,'repeated cron does not resend');
 for(const patch of [{depositRefundAmount:50},{depositKept:50},{depositRefunded:false},{lateFeePaidFromHold:10}]){const row={...base(),...patch,reviewFollowUpDueAt:now-1};await actions.processDue.handler(ctxFor(row),{});assert.equal(emails,1,'deposit deductions and pending refunds suppress all review email');}
 const stale=base(),fingerprint=rules.reviewFingerprint(stale);stale.depositKept=1;assert.equal(await state.recordCheck.handler({db:{get:async()=>stale,patch:async()=>assert.fail('stale authorization wrote')}},{bookingId:stale._id,fingerprint,claim:true}),false);
 const offline={...base(),reviewFollowUpDueAt:now-1};providerFails=true;await actions.processDue.handler(ctxFor(offline),{});assert.equal(offline.reviewFollowUpReason,'provider_unavailable');assert.equal(emails,1);providerFails=false;
 const fail={...base(),reviewFollowUpDueAt:now-1};mailOk=false;await actions.processDue.handler(ctxFor(fail),{});assert.equal(fail.reviewFollowUpStatus,'waiting');assert.equal(fail.remindedReview,false);assert.equal(emails,2);
 const dry=base();await actions.processDue.handler(ctxFor(dry),{dryRun:true});assert.equal(dry.reviewFollowUpStatus,undefined);assert.equal(emails,2);
 console.log('PASS real review queue: partial/retained/pending/failed refunds and unreleased holds blocked; later full refund sends once; stale/concurrent claims, provider outages, failed email and dry-run covered');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=realNow;if(oldKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=oldKey});
