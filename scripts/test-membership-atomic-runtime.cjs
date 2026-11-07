const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {ConvexHttpClient}=require('convex/browser');
const {makeFunctionReference}=require('convex/server');
const root=path.resolve(__dirname,'..'),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-membership-atomic-'));
let child,cleaned=false;const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cleanup(){if(cleaned)return;cleaned=true;if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}for(let i=0;i<50&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}fs.rmSync(workspace,{recursive:true,force:true});}
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>cleanup().finally(()=>process.exit(code)));
async function main(){
 for(const name of ['convex','shared','src/lib'])fs.cpSync(path.join(root,name),path.join(workspace,name),{recursive:true});
 for(const name of ['package.json','tsconfig.json'])fs.copyFileSync(path.join(root,name),path.join(workspace,name));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(workspace,'node_modules'),'dir');
 fs.rmSync(path.join(workspace,'convex/crons.ts'),{force:true});
 fs.copyFileSync(path.join(__dirname,'fixtures/membership-atomic-runtime.ts.fixture'),path.join(workspace,'convex/membership_atomic.ts'));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,CONVEX_AGENT_MODE:'anonymous',XDG_CONFIG_HOME:path.join(workspace,'config')};
 child=spawn(path.join(root,'node_modules/.bin/convex'),['dev','--typecheck','disable','--codegen','disable','--tail-logs','disable'],{cwd:workspace,env,detached:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<180&&!output.includes('Convex functions ready!')&&child.exitCode===null&&child.signalCode===null;i++)await sleep(1000);
 const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(!match||!output.includes('[Local]')||!output.includes('Convex functions ready!'))throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
 const client=new ConvexHttpClient(match[0]),seed=makeFunctionReference('membership_atomic:seed'),grant=makeFunctionReference('membership_atomic:grant'),inspect=makeFunctionReference('membership_atomic:inspect');
 const accountId=await client.mutation(seed,{}),args={accountId,invoiceId:'in_fixture',refund:950};
 await Promise.all([client.action(grant,args),client.action(grant,args)]);
 let state=await client.query(inspect,{accountId});assert.equal(state.grants.length,1);assert.equal(state.grants[0].revokedPence,1045);assert.equal(state.credits.length,1);assert.equal(state.credits[0].remaining,10.45);
 const failedAccount=await client.mutation(seed,{});await assert.rejects(client.action(grant,{accountId:failedAccount,invoiceId:'in_invalid',refund:-1}));
 state=await client.query(inspect,{accountId:failedAccount});assert.equal(state.grants.length,0);assert.equal(state.credits.length,0);assert.equal(state.account.membershipPaidThrough,undefined);
 console.log('PASS isolated local Convex: concurrent historical invoice retries issue one already-reversed grant; invalid reversal rolls back all writes. Synthetic provider snapshot only.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(cleanup);
