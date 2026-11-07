const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {ConvexHttpClient}=require('convex/browser');
const {makeFunctionReference}=require('convex/server');
const root=path.resolve(__dirname,'..'),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-credit-runtime-'));
let child,cleaned=false;const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cleanup(){if(cleaned)return;cleaned=true;if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}for(let i=0;i<50&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}fs.rmSync(workspace,{recursive:true,force:true});}
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>cleanup().finally(()=>process.exit(code)));
async function main(){
 for(const name of ['convex','shared','src/lib'])fs.cpSync(path.join(root,name),path.join(workspace,name),{recursive:true});
 for(const name of ['package.json','tsconfig.json'])fs.copyFileSync(path.join(root,name),path.join(workspace,name));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(workspace,'node_modules'),'dir');
 fs.rmSync(path.join(workspace,'convex/crons.ts'),{force:true});
 fs.copyFileSync(path.join(__dirname,'fixtures/verification-credit-runtime.ts.fixture'),path.join(workspace,'convex/credit_qualify.ts'));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,CONVEX_AGENT_MODE:'anonymous',XDG_CONFIG_HOME:path.join(workspace,'config')};
 child=spawn(path.join(root,'node_modules/.bin/convex'),['dev','--typecheck','disable','--codegen','disable','--tail-logs','disable'],{cwd:workspace,env,detached:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<180&&!output.includes('Convex functions ready!')&&child.exitCode===null&&child.signalCode===null;i++)await sleep(1000);
 const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(!match||!output.includes('[Local]')||!output.includes('Convex functions ready!'))throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
 const client=new ConvexHttpClient(match[0]),seed=makeFunctionReference('credit_qualify:seed'),reserve=makeFunctionReference('credit_qualify:reserve'),release=makeFunctionReference('credit_qualify:release'),freeze=makeFunctionReference('credit_qualify:freeze'),inspect=makeFunctionReference('credit_qualify:inspect');
 for(let i=0;i<5;i++){
  const fixture=await client.mutation(seed,{});
  const identity={accountId:fixture.accountId,creditId:fixture.creditId};
  const contenders=[new ConvexHttpClient(match[0]),new ConvexHttpClient(match[0])];
  const race=await Promise.allSettled(contenders.map(contender=>contender.mutation(reserve,{accountId:fixture.accountId})));
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected').length,1);
  let state=await client.query(inspect,identity);assert.equal(state.credit.remaining,20);assert.equal(state.rows[0].availablePence,0);
  assert.equal(state.bookings.filter(b=>b.status==='pending_verification').length,1);assert.equal(state.bookings.filter(b=>b.status==='pending_payment').length,1);
  await client.mutation(release,{bookingId:fixture.bookingId});state=await client.query(inspect,identity);assert.equal(state.rows[0].availablePence,1000);
  await client.mutation(reserve,{accountId:fixture.accountId});state=await client.query(inspect,identity);assert.equal(state.rows[0].availablePence,0);assert.equal(state.credit.remaining,20);
  await client.mutation(freeze,{creditId:fixture.creditId});
  const open=state.bookings.filter(b=>b.status==='pending_payment');assert.equal(open.length,2);
  await Promise.all(open.map((booking,index)=>contenders[index].mutation(release,{bookingId:booking._id})));
  state=await client.query(inspect,identity);assert.equal(state.credit.remaining,0);assert.equal(state.credit.revokedPendingPence,0);assert.equal(state.credit.status,'spent');
 }
 console.log('PASS isolated local Convex: five concurrent reservation races and concurrent frozen-credit release races. Fixture uses actual credit helpers and synthetic mutations, not full checkout or payment settlement.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(cleanup);
