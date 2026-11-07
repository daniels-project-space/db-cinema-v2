const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {ConvexHttpClient}=require('convex/browser');
const {makeFunctionReference}=require('convex/server');
const root=path.resolve(__dirname,'..'),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-refund-jobs-'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let child;
async function cleanup(){if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{}for(let i=0;i<50&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL')}catch{}}fs.rmSync(workspace,{recursive:true,force:true});}
async function main(){
 for(const name of ['convex','shared','src/lib'])fs.cpSync(path.join(root,name),path.join(workspace,name),{recursive:true});
 for(const name of ['package.json','tsconfig.json'])fs.copyFileSync(path.join(root,name),path.join(workspace,name));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(workspace,'node_modules'),'dir');fs.rmSync(path.join(workspace,'convex/crons.ts'),{force:true});
 fs.copyFileSync(path.join(__dirname,'fixtures/membership-refund-jobs-runtime.ts.fixture'),path.join(workspace,'convex/refund_job_fixture.ts'));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,CONVEX_AGENT_MODE:'anonymous',XDG_CONFIG_HOME:path.join(workspace,'config')},cli=path.join(root,'node_modules/.bin/convex');
 child=spawn(cli,['dev','--typecheck','disable','--codegen','disable','--tail-logs','disable'],{cwd:workspace,env,detached:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<180&&!output.includes('Convex functions ready!')&&child.exitCode===null&&child.signalCode===null;i++)await sleep(1000);
 const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(!match||!output.includes('[Local]')||!output.includes('Convex functions ready!'))throw Error(`Isolated backend failed: ${output.slice(-1200)}`);
 const config=fs.readFileSync(path.join(workspace,'.env.local'),'utf8');if(!config.includes(match[0])||!/CONVEX_DEPLOYMENT=anonymous:/.test(config))throw Error('Refusing non-anonymous backend');
 execFileSync(cli,['env','set','MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1','enabled'],{cwd:workspace,env,stdio:'pipe'});
 const client=new ConvexHttpClient(match[0]),ref=name=>makeFunctionReference(`refund_job_fixture:${name}`);
 const accountId=await client.mutation(ref('seed'),{}),ids=await Promise.all(Array.from({length:8},()=>client.action(ref('enqueue'),{accountId})));
 assert(ids.every(id=>id===ids[0]));assert.equal((await client.query(ref('inspect'),{})).length,1);
 await assert.rejects(client.action(ref('grant'),{accountId}),/refund requires reconciliation/);
 assert.equal((await client.query(ref('credits'),{accountId})).length,0,'an already recorded refund fences the grant in the real transaction');
 await client.mutation(ref('expire'),{id:ids[0]});const leases=await Promise.all(Array.from({length:8},(_,index)=>client.action(ref('claim'),{id:ids[0],token:`token${index}`})));
 assert.equal(leases.filter(Boolean).length,1,'concurrent workers cannot share a lease');
 await client.mutation(ref('expire'),{id:ids[0]});assert(await client.action(ref('claim'),{id:ids[0],token:'after-crash'}),'expired lease is reclaimable without scheduler delivery');
 await client.action(ref('enqueue'),{accountId,refundId:'re_new'});
 assert.deepEqual(await client.action(ref('finish'),{id:ids[0],token:'after-crash',done:true}),{stale:true},'new refund invalidates the previously claimed lease');
 const [changed]=await client.query(ref('inspect'),{});assert.equal(changed.refundId,'re_new');assert.equal(changed.state,'pending');
 console.log('PASS isolated local Convex: concurrent webhook enqueue and worker lease deduplication, crash lease recovery; no provider actions.');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(cleanup);
