const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const {ConvexReactClient}=require('convex/react');
const credits=h.load('convex/accountCredits.ts');
const original={now:Date.now,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout,document:global.document,fetch:global.fetch};
let clock=Date.UTC(2030,0,1),serial=0;const start=clock,timers=new Map(),listeners=new Map();
Date.now=()=>clock;global.setTimeout=(callback,ms)=>{const id=++serial;timers.set(id,{callback,at:clock+ms});return id};global.clearTimeout=id=>timers.delete(id);
global.document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}};
global.fetch=()=>{throw Error('Network is forbidden in the credit-expiry fixture')};
const account=h.put('accounts',{email:'expiry-refresh@example.invalid'});h.put('sessions',{token:'owned-expiry-token',accountId:account._id,expiresAt:start+86400000});
for(const [amount,expiry]of [[10,100],[5,200]])h.put('credits',{accountId:account._id,kind:'earned',currency:'GBP',amount,remaining:amount,status:'active',createdAt:start-1000,expiresAt:start+expiry});
const ctx={db:h.db},states=[],effects=[],requests=[],cache=new Map();let stateIndex=0,effectIndex=0,pendingEffects=[],live;
const react={useState:initial=>{const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value}]},useEffect:(callback,deps)=>{const index=effectIndex++,before=effects[index];if(!before||deps.some((v,i)=>!Object.is(v,before.deps[i]))){before?.cleanup?.();const effect={deps,cleanup:null};effects[index]=effect;pendingEffects.push(()=>{effect.cleanup=callback()})}}};
const client={query:ConvexReactClient.prototype.query,watchQuery:(_query,args)=>{
 const key=JSON.stringify(args);requests.push(args);
 return{localQueryResult:()=>cache.get(key),onUpdate:callback=>{let alive=true;Promise.resolve().then(async()=>{const value=await credits.balance.handler(ctx,args);cache.set(key,value);if(alive)callback()});return()=>{alive=false}}};
}};
h.setMock('react',react);h.setMock('convex/react',{useConvex:()=>client,useQuery:()=>live});const {useCreditBalance}=h.load('src/components/account/useCreditBalance.ts');
function render(token='owned-expiry-token'){stateIndex=0;effectIndex=0;const result=useCreditBalance(token),run=pendingEffects;pendingEffects=[];for(const fn of run)fn();return result;}
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
(async()=>{
 live=await credits.balance.handler(ctx,{token:'owned-expiry-token'});cache.set(JSON.stringify({token:'owned-expiry-token'}),live);
 assert.equal(render().available,15);clock=start+101;
 assert.equal((await client.query('accountCredits.balance',{token:'owned-expiry-token'})).available,15,'The real installed Convex query method reproduces the cached pre-expiry result');
 const first=[...timers.values()][0];assert(first&&first.at===start+101);first.callback();await settle();
 assert.equal(render().available,5,'The real hook must bypass the old subscription cache when the first credit expires');
 const refreshed=requests.find(args=>args.refreshAt===clock);assert(refreshed&&refreshed.token==='owned-expiry-token','Fresh reads retain account ownership and use a distinct cache key');
 clock=start+201;listeners.get('visibilitychange')();await settle();assert.equal(render().available,0,'Returning to the tab after the next expiry hides all expired credit');
 assert.equal((await credits.balance.handler(ctx,{token:'owned-expiry-token',refreshAt:start-50000})).available,0,'The server uses its own clock, never the supplied refresh marker');
 live={accountId:'other-account',available:9,nextExpiry:null};assert.equal(render('other-token').available,9,'A cached expiry refresh cannot leak into another account');
 console.log('PASS actual useCreditBalance hook + installed Convex query cache + registered account-credit handler: old bug reproduced, two exact expiry boundaries refreshed, hidden-tab recovery, server clock authority, account changes and zero network/production writes.');
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>{for(const effect of effects)effect?.cleanup?.();Date.now=original.now;global.setTimeout=original.setTimeout;global.clearTimeout=original.clearTimeout;global.document=original.document;global.fetch=original.fetch});
