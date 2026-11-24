// Real provider compare-and-set test on the designated synthetic sandbox case.
// No live key, customer data or email is used. Run only with the vault's sandbox key.
const assert=require('node:assert/strict');
const key=process.env.DIDIT_SANDBOX_API_KEY,workflowId=process.env.DIDIT_SANDBOX_WORKFLOW_ID;
if(!key||!workflowId)throw Error('Sandbox credentials required');
const root='https://verification.didit.me/v3/',headers={'x-api-key':key,'content-type':'application/json'};
async function post(path,body){const r=await fetch(root+path,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error(`Sandbox request failed: ${r.status}`);return r.json()}
async function get(path){const r=await fetch(root+path,{headers});if(!r.ok)throw Error(`Sandbox read failed: ${r.status}`);return r.json()}
(async()=>{
 const list=await get('sessions/?limit=100');
 const item=list.results?.find(row=>row.vendor_data==='dbc-booking-synthetic-retry-qualification');
 if(!item)throw Error('The designated synthetic sandbox case is missing');
 let decision=await get(`session/${item.session_id}/decision/`);
 if(decision.workflow_id!==workflowId)throw Error('Sandbox workflow mismatch');
 // The sandbox-only endpoint must succeed before any resubmission request.
 if(decision.status==='Declined')await post(`session/${item.session_id}/simulate/`,{new_status:'Approved',send_webhooks:false});
 await post(`session/${item.session_id}/simulate/`,{new_status:'Declined',risk:'COULD_NOT_RECOGNIZE_DOCUMENT',send_webhooks:false});
 const workflow=await get(`workflows/${workflowId}/`);
 const nodes=Object.entries(workflow.workflow_graph?.nodes||{}).filter(([,node])=>node.node_type==='feature').map(([node_id,node])=>({node_id,feature:node.feature==='PROOF_OF_ADDRESS'?'POA':node.feature}));
 assert.equal(nodes.length,4);
 const preview=await post(`session/${item.session_id}/resubmission-preview/`,{new_status:'Resubmitted',nodes_to_resubmit:nodes,email_language:'en'});
 assert.equal(preview.will_be_sent,false);assert.equal(preview.not_sent_reason,'sandbox');assert(preview.preview_token&&preview.recipient);
 await post(`session/${item.session_id}/simulate/`,{new_status:'Approved',send_webhooks:false});
 const result=await fetch(root+`session/${item.session_id}/update-status/`,{method:'PATCH',headers,body:JSON.stringify({new_status:'Resubmitted',nodes_to_resubmit:nodes,send_email:true,email_address:preview.recipient,email_language:preview.language||'en',email_preview_token:preview.preview_token,comment:'Synthetic stale preview test'})});
 assert.equal(result.status,409,'Didit must reject a preview after the session status changes');
 decision=await get(`session/${item.session_id}/decision/`);assert.equal(decision.status,'Approved','a stale retry must not overwrite the newer provider decision');
 await post(`session/${item.session_id}/simulate/`,{new_status:'Declined',risk:'COULD_NOT_RECOGNIZE_DOCUMENT',send_webhooks:false});
 const selectionPreview=await post(`session/${item.session_id}/resubmission-preview/`,{new_status:'Resubmitted',nodes_to_resubmit:nodes,email_language:'en'});
 assert.equal(selectionPreview.will_be_sent,false);assert.equal(selectionPreview.not_sent_reason,'sandbox');
 const changedSelection=await fetch(root+`session/${item.session_id}/update-status/`,{method:'PATCH',headers,body:JSON.stringify({new_status:'Resubmitted',nodes_to_resubmit:nodes.slice(0,-1),send_email:true,email_address:selectionPreview.recipient,email_language:selectionPreview.language||'en',email_preview_token:selectionPreview.preview_token,comment:'Synthetic changed selection test'})});
 assert.equal(changedSelection.status,409,'Didit must reject a different selected-step set from the preview');
 decision=await get(`session/${item.session_id}/decision/`);assert.equal(decision.status,'Declined','a changed selection must not reopen the session');
 const changedRecipient=await fetch(root+`session/${item.session_id}/update-status/`,{method:'PATCH',headers,body:JSON.stringify({new_status:'Resubmitted',nodes_to_resubmit:nodes,send_email:true,email_address:'different-recipient@example.invalid',email_language:selectionPreview.language||'en',email_preview_token:selectionPreview.preview_token,comment:'Synthetic changed recipient test'})});
 assert.equal(changedRecipient.status,409,'Didit must reject a recipient different from the preview');
 decision=await get(`session/${item.session_id}/decision/`);assert.equal(decision.status,'Declined','a changed recipient must not reopen the session');
 console.log('PASS real Didit sandbox rejects stale status, changed-step and changed-recipient previews before a session update; sandbox previews confirm no email.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
