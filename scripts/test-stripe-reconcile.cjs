/** Exercise the real pending-payment reconciler with inert Stripe responses. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

const refs = new Proxy({}, {get: (_, group) => new Proxy({}, {get: (_, name) => `${String(group)}:${String(name)}`})});
const registered = {action: x => x, internalAction: x => x, query: x => x, internalQuery: x => x, mutation: x => x, internalMutation: x => x};
const sessions = {
  paid: {id:'paid',status:'complete',payment_status:'paid',payment_intent:'pi_paid'},
  expired: {id:'expired',status:'expired',payment_status:'unpaid'},
  open: {id:'open',status:'open',payment_status:'unpaid'},
  processing: {id:'processing',status:'complete',payment_status:'unpaid'},
};
class FakeStripe {
  checkout = {sessions: {
    retrieve: async id => {if(id==='failed')throw Error('provider temporarily unavailable');return sessions[id];},
    expire: async id => ({...sessions[id],status:'expired'}),
  }};
}
function load(file) {
  const filename = path.resolve(root, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2020,esModuleInterop:true},
  }).outputText;
  const mod = {exports:{}};
  const mocks = {'./_generated/server':registered,'./_generated/api':{internal:refs,api:refs},stripe:FakeStripe};
  new Function('require','module','exports',source)((name) => {
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
const {reconcilePendingPayments}=load('convex/checkout.ts');
const {createPending,confirm,expireUnpaidPending,releaseExpiredHolds}=load('convex/bookings.ts');
const {expire:expireCredits}=load('convex/credits.ts');

(async()=>{
  const now=Date.now();
  const pending=['paid','expired','open','processing','failed','unbound'].map(id=>({
    bookingId:id,sessionId:id==='unbound'?null:id,createdAt:now-60*60*1000,
  }));
  for(const name of Object.keys(sessions))sessions[name].metadata={bookingId:name};
  const mutations=[];
  const ctx={
    runQuery: async ref=>{
      if(ref==='bookings:pendingCheckoutSessions')return pending;
      if(ref==='bookings:holdContext')return null;
      throw Error(`Unexpected query ${ref}`);
    },
    runMutation: async (ref,args)=>{
      mutations.push({ref,args});
      if(ref==='bookings:confirm')return {already:false};
      if(ref==='bookings:expireUnpaidPending')return true;
      throw Error(`Unexpected mutation ${ref}`);
    },
  };
  const originalError=console.error;
  console.error=()=>{}; // provider outage is expected in this fixture
  let result;
  try{result=await reconcilePendingPayments.handler(ctx,{});}finally{console.error=originalError;}
  assert.deepEqual(result,{checked:6,confirmed:1,expired:3,failures:1});
  assert.deepEqual(mutations.filter(m=>m.ref==='bookings:confirm').map(m=>m.args.bookingId),['paid']);
  assert.deepEqual(mutations.filter(m=>m.ref==='bookings:expireUnpaidPending').map(m=>m.args.bookingId),['expired','open','unbound']);
  assert.ok(!mutations.some(m=>['processing','failed'].includes(m.args.bookingId)));
  await assert.rejects(createPending.handler({db:{get:async()=>({email:'owner@example.invalid'})}},
    {customerEmail:'other@example.invalid',creditAccountId:'owner-account'}),/different customer/);

  // A credit valid when checkout began remains reserved even when the webhook
  // arrives just after its expiry; it is not silently given away as a discount.
  const booking={_id:'booking-credit',_creationTime:now-10000,status:'pending_payment',
    guestEmail:'owner@example.invalid',creditApplied:10,lineItems:[]};
  const credit={_id:'credit-1',accountId:'owner-account',createdAt:now-100000,
    expiresAt:now-5000,status:'active',remaining:10};
  const patches=[],queuedEmails=[];
  const db={
    get:async id=>id==='booking-credit'?booking:id==='owner-account'?{_id:'owner-account',email:'owner@example.invalid'}:null,
    query:table=>({withIndex:()=>({collect:async()=>table==='credits'?[credit]:[],first:async()=>table==='accounts'?{_id:'owner-account'}:null,unique:async()=>table==='accounts'?{_id:'owner-account'}:null,order:()=>({take:async()=>[]})})}),
    patch:async(id,patch)=>patches.push({id,patch}),
    insert:async(table,value)=>{assert.equal(table,"rental_email_deliveries");queuedEmails.push(value);return "delivery-fixture";},
  };
  const bookingCtx={db,scheduler:{runAfter:async()=>{}}};
  await confirm.handler(bookingCtx,{bookingId:'booking-credit',paymentIntentId:'pi_paid'});
  assert.ok(patches.some(p=>p.id==='credit-1'&&p.patch.remaining===0&&p.patch.status==='spent'));
  assert.deepEqual(queuedEmails.map(x=>x.kind),["payment","receipt"]);
  booking.status='confirmed';
  assert.equal(await expireUnpaidPending.handler(bookingCtx,{bookingId:'booking-credit'}),false);

  const hold={_id:'hold-1',bookingId:'booking-credit',status:'hold',holdExpiresAt:now-1000};
  booking.status='pending_payment';
  let deleted=false;
  const holdCtx={db:{
    get:db.get,
    query:()=>({withIndex:()=>({collect:async()=>[hold]})}),
    delete:async()=>{deleted=true;},
  }};
  assert.deepEqual(await releaseExpiredHolds.handler(holdCtx,{}),{released:0});
  assert.equal(deleted,false,'pending payment keeps the physical stock hold');
  let pendingCreditBooking=true;
  const expiryPatches=[];
  const expiryCtx={db:{
    get:async()=>({email:'owner@example.invalid'}),
    query:table=>({withIndex:()=>({collect:async()=>table==='credits'?[credit]:
      pendingCreditBooking?[booking]:[]})}),
    patch:async(id,patch)=>expiryPatches.push({id,patch}),
  }};
  assert.deepEqual(await expireCredits.handler(expiryCtx,{}),{expired:0});
  pendingCreditBooking=false;
  assert.deepEqual(await expireCredits.handler(expiryCtx,{}),{expired:1});
  assert.deepEqual(expiryPatches,[{id:'credit-1',patch:{status:'expired'}}]);
  console.log('PASS: paid sessions confirmed, terminal unpaid sessions expired, processing/outage sessions preserved.');
})().catch(error=>{console.error(error);process.exitCode=1;});
