/** Late-fee bank challenges: owner-only access, provider reconciliation, and 30-day cutoff. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const refs = new Proxy({}, {get: (_, group) => new Proxy({}, {get: (_, name) => `${String(group)}:${String(name)}`})});
const registered = {action:x=>x,internalAction:x=>x,query:x=>x,internalQuery:x=>x,mutation:x=>x,internalMutation:x=>x};
const intents = new Map();
const canceled = [];
class FakeStripe {
  paymentIntents = {
    retrieve: async id => intents.get(id),
    cancel: async id => {canceled.push(id);return {...intents.get(id),status:'canceled'};},
  };
}
function load(file) {
  const filename = path.resolve(root,file);
  const source = ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},
  }).outputText;
  const mod = {exports:{}};
  const mocks = {'./_generated/server':registered,'./_generated/api':{internal:refs,api:refs},stripe:FakeStripe};
  new Function('require','module','exports',source)((name)=>{
    if(name in mocks)return mocks[name];
    if(name.startsWith('.')){
      let target=path.resolve(path.dirname(filename),name);
      if(!path.extname(target)&&fs.existsSync(`${target}.ts`))target+='.ts';
      if(target.endsWith('.ts'))return load(path.relative(root,target));
      return require(target);
    }
    return require(name);
  },mod,mod.exports);
  return mod.exports;
}

process.env.STRIPE_SECRET_KEY='sk_test_inert';
process.env.LATE_FEE_AUTOCOLLECT_ENABLED='true';
const {resume,sync,reconcilePending}=load('convex/lateFees.ts');
const {_byToken,me}=load('convex/accounts.ts');
const {settleAuthenticatedLateCharge}=load('convex/bookings.ts');

(async()=>{
  const now=Date.now();
  const booking={status:'returned',guestEmail:'renter@example.invalid',lateFeeAmount:80,
    lateFeeStatus:'requires_action',lateFeeIntentId:'pi_late',lateFeePaidFromHold:30,
    lateFeePaidFromCard:0,actualReturnedAt:now-10*86400000};
  const intent={id:'pi_late',status:'requires_action',client_secret:'pi_late_secret_test',amount_received:0,
    metadata:{bookingId:'booking-1',purpose:'late_rental_time_separate_charge'}};
  intents.set(intent.id,intent);
  const mutations=[];
  let owner=true;
  const ctx={
    runQuery:async ref=>{
      if(ref==='accounts:_byToken')return owner?{email:'renter@example.invalid'}:{email:'someone-else@example.invalid'};
      if(ref==='bookings:lateFeeContext')return booking;
      if(ref==='bookings:pendingLateAuthentications')return ['booking-1'];
      throw Error(`Unexpected query ${ref}`);
    },
    runMutation:async(ref,args)=>{mutations.push({ref,args});return true;},
  };
  owner=false;
  await assert.rejects(resume.handler(ctx,{token:'other',bookingId:'booking-1'}),/access denied/);
  assert.equal(mutations.length,0);
  owner=true;
  process.env.LATE_FEE_AUTOCOLLECT_ENABLED='false';
  assert.deepEqual(await resume.handler(ctx,{token:'renter',bookingId:'booking-1'}),
    {status:'paused',clientSecret:null});
  process.env.LATE_FEE_AUTOCOLLECT_ENABLED='true';
  assert.deepEqual(await resume.handler(ctx,{token:'renter',bookingId:'booking-1'}),
    {status:'requires_action',clientSecret:'pi_late_secret_test'});
  intent.status='succeeded';intent.amount_received=5000;
  assert.deepEqual(await sync.handler(ctx,{token:'renter',bookingId:'booking-1'}),{status:'paid'});
  assert.deepEqual(mutations.pop(),{ref:'bookings:settleAuthenticatedLateCharge',args:{
    bookingId:'booking-1',intentId:'pi_late',status:'paid',paidFromCard:50,
  }});
  // The hourly reconciler reaches the same Stripe outcome when the customer
  // closes the browser immediately after authenticating.
  await reconcilePending.handler(ctx,{});
  assert.equal(mutations.pop().args.status,'paid');

  intent.status='requires_action';booking.actualReturnedAt=now-31*86400000;
  assert.deepEqual(await resume.handler(ctx,{token:'renter',bookingId:'booking-1'}),
    {status:'partial',clientSecret:null});
  assert.deepEqual(canceled,['pi_late']);
  assert.equal(mutations.pop().args.status,'partial');

  let patched=0;
  let scheduled=0;
  const stored={status:'returned',lateFeeIntentId:'pi_late',lateFeeStatus:'requires_action',
    lateFeeAmount:80,lateFeePaidFromHold:30,lateFeePaidFromCard:0};
  const settleCtx={
    db:{get:async()=>stored,patch:async(_id,patch)=>{patched++;Object.assign(stored,patch);}},
    scheduler:{runAfter:async(_delay,ref)=>{assert.equal(ref,'lateFees:sendCollectionResult');scheduled++;}},
  };
  const settlement={bookingId:'booking-1',intentId:'pi_late',status:'paid',paidFromCard:50};
  assert.equal(await settleAuthenticatedLateCharge.handler(settleCtx,{...settlement,intentId:'pi_wrong'}),false);
  assert.equal(patched,0);
  await assert.rejects(settleAuthenticatedLateCharge.handler(settleCtx,{...settlement,paidFromCard:51}),/amount is invalid/);
  assert.equal(await settleAuthenticatedLateCharge.handler(settleCtx,settlement),true);
  assert.equal(stored.lateFeeStatus,'paid');
  assert.equal(stored.lateFeePaidFromCard,50);
  assert.equal(scheduled,1);
  assert.equal(await settleAuthenticatedLateCharge.handler(settleCtx,settlement),false);
  assert.equal(scheduled,1);

  // Expired sessions stop account access immediately, without waiting for the sweep.
  let accountFetched=false;
  const expiredSessionCtx={db:{
    query:()=>({withIndex:()=>({first:async()=>({accountId:'account-1',expiresAt:now-1000})})}),
    get:async()=>{accountFetched=true;return {email:'renter@example.invalid'};},
  }};
  assert.equal(await _byToken.handler(expiredSessionCtx,{token:'expired'}),null);
  assert.equal(await me.handler(expiredSessionCtx,{token:'expired'}),null);
  assert.equal(accountFetched,false);
  console.log('PASS: late-fee bank approval is owner-only, reconciles one payment, expires unapproved charges, and rejects expired sessions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
