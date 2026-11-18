// Diagnostic of the current workflow, not a release gate: it records the
// unsafe sequencing observed today and should be rewritten when that is fixed.
// Sandbox only, using Didit's own sample document; no customer data or email.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync('scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const key=process.env.DIDIT_SANDBOX_API_KEY,sourceWorkflow=process.env.DIDIT_SANDBOX_WORKFLOW_ID,workflow=process.env.DIDIT_SANDBOX_TEST_WORKFLOW_ID||sourceWorkflow;
if(!key||!sourceWorkflow||!workflow)throw Error('Sandbox credentials required');
const root='https://verification.didit.me/v3/',headers={'x-api-key':key,'content-type':'application/json'};
async function get(path){const r=await fetch(root+path,{headers});if(!r.ok)throw Error(`Sandbox read failed: ${r.status}`);return r.json()}
async function post(path,body){const r=await fetch(root+path,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error(`Sandbox request failed: ${r.status}`);return r.json()}
(async()=>{
 const list=await get('sessions/?limit=100');const fixture=list.results?.find(row=>row.vendor_data==='dbc-booking-synthetic-retry-qualification');if(!fixture)throw Error('Designated sandbox fixture missing');
 const prior=await get(`session/${fixture.session_id}/decision/`);if(prior.workflow_id!==sourceWorkflow)throw Error('Sandbox workflow mismatch');
 // simulate is sandbox-only; require success before creating the test session.
 await post(`session/${fixture.session_id}/simulate/`,{new_status:prior.status==='Declined'?'Approved':'Declined',send_webhooks:false});
 if(workflow!==sourceWorkflow){
  const [source,target]=await Promise.all([get(`workflows/${sourceWorkflow}/`),get(`workflows/${workflow}/`)]);
  const walk=w=>{const g=w.workflow_graph,visited=new Set(),steps=[];let id=g.start_node;while(id&&!visited.has(id)){visited.add(id);const n=g.nodes[id];if(!n||n.branches?.length)throw Error('The sequencing clone is not linear');steps.push(n.node_type==='feature'?{feature:n.feature,config:n.config||{}}:{status:n.session_status});id=n.next}return steps};
  assert.equal(target.max_retry_attempts,2,'the isolated sandbox workflow must match the live retry limit');if(!require('node:util').isDeepStrictEqual(walk(target),walk(source)))throw Error('The isolated sandbox workflow does not match the source graph and feature configurations');
 }
 const session=await post('session/',{workflow_id:workflow,vendor_data:`dbc-native-sequencing-synthetic-${randomUUID()}`,sandbox_scenario:'decline_document_expired',contact_details:{email:'native-test@example.invalid',send_notification_emails:false}});
 if(!/^https:\/\/verify\.didit\.me\//.test(session.url))throw Error('Invalid sandbox URL');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-didit-sequencing-'));const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{stdio:'ignore'});let client;
 try{
  let port;for(let n=0;n<100;n++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await delay(100)}}assert(port);
  process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Page.enable');await client.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await client.cmd('Page.navigate',{url:session.url});
  async function waitFor(text){for(let n=0;n<100;n++){if(await client.evaluate(`document.body?.innerText?.includes(${JSON.stringify(text)})===true`))return;await delay(200)}throw Error(`Sandbox screen did not show: ${text}`)}
  async function click(text){const clicked=await client.evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button,[role=button],a')).find(x=>x.innerText.trim().includes(${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`);assert(clicked,`Sandbox control missing: ${text}`)}
  await waitFor('Continue');await click('Continue');await waitFor('Which ID will you use?');await click('Passport');await waitFor('Upload photos of your ID');await click('Passport');await delay(500);await click('Upload photos of your ID');await waitFor('Upload your ID');await delay(500);await click('Passport');await waitFor('Remove this photo');await click('Continue');await waitFor('This ID has expired');
  const failure=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-native-expired.png',Buffer.from(failure.data,'base64'));
  await click('Passport');await waitFor('Remove this photo');await click('Continue');await waitFor('Take a selfie');
  const decision=await get(`session/${session.session_id}/decision/`);
  assert.equal(decision.status,'In Progress');assert((decision.id_verifications||[]).some(row=>row.status==='Declined'&&(row.warnings||[]).some(w=>w.risk==='DOCUMENT_EXPIRED')),'the real sandbox ID result must be declined');
  assert.equal((decision.liveness_checks||[]).length,0);assert.equal((decision.poa_verifications||[]).length,0);
  const next=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-native-selfie.png',Buffer.from(next.data,'base64'));
  console.log('OBSERVED current sandbox workflow: expired-ID warning was shown, then the flow advanced to selfie while the provider ID result remained declined. No real identity data or customer email.');
  assert.equal(decision.environment,'sandbox','terminal simulation must never target a live session');
  await post(`session/${session.session_id}/simulate/`,{new_status:'Declined',send_webhooks:false});
  const finalDecision=await get(`session/${session.session_id}/decision/`);
  assert.equal(finalDecision.decision_trace?.decided_by,'manual','sandbox simulation marks the overall decision as manual');
  const reasons=require('./lib/rentalTestHarness.cjs').load('shared/diditFailureReason.ts');
  assert.equal(reasons.diditFailureReason(finalDecision),reasons.DIDIT_EXPIRED_ID);
  assert.equal(reasons.diditCanRetryAutomatically(finalDecision),true,'the provider document error itself should be eligible; the action separately rejects this manual decision');
  console.log('PASS real sandbox expired-ID reason maps to clear English and a remediable error; overall decision is sandbox-simulated and remains manual.');
 }catch(error){if(client)try{const shot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-native-error.png',Buffer.from(shot.data,'base64'));console.error('Synthetic sandbox screen:',await client.evaluate(`document.body?.innerText?.slice(0,600)`))}catch{}throw error}finally{if(client)client.close();if(chrome.exitCode===null){const exited=new Promise(r=>chrome.once('exit',r));chrome.kill();await exited}await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:200})}
})().catch(error=>{console.error(error.message);process.exitCode=1});
