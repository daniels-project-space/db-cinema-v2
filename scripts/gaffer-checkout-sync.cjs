/** Add only the checkout/account brief to the current live prompt. Preserve provider settings. */
const {CHECKOUT_ACCOUNT_BRIEF}=require('./gaffer-system-prompt');
const agentId=process.env.GAFFER_AGENT_ID||'agent_4601kvk2pfznfrws6ah700jnxvfv',key=process.env.ELEVENLABS_API_KEY;
const start='# CART REPLACEMENTS AND ACCOUNT ACCESS',end='# END CART AND ACCOUNT ACCESS';
(async()=>{
 if(!key)throw Error('ELEVENLABS_API_KEY is required');
 const call=async(body)=>{const r=await fetch('https://api.elevenlabs.io/v1/convai/agents/'+agentId,{method:body?'PATCH':'GET',headers:{'xi-api-key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Agent operation failed: HTTP '+r.status);return r.json();};
 const before=await call(),p=before.conversation_config.agent.prompt,brief=start+'\n'+CHECKOUT_ACCOUNT_BRIEF+'\n'+end;
 const first=p.prompt.indexOf(start),last=p.prompt.indexOf(end);
 if(first>=0&&last<first)throw Error('Existing brief markers are inconsistent');
 const updated=first>=0?p.prompt.slice(0,first)+brief+p.prompt.slice(last+end.length):p.prompt+'\n\n'+brief;
 console.log({agent:agentId,promptChanged:updated!==p.prompt,scope:'Cart alternatives, emailed checkout cart, private account codes and password reset'});
 if(!process.argv.includes('--apply'))return;
 if(updated!==p.prompt)await call({conversation_config:{agent:{prompt:{prompt:updated}}}});
 const after=await call(),a=after.conversation_config.agent.prompt;
 if(a.prompt!==updated)throw Error('Prompt verification failed');
 const unchanged=o=>{const copy=JSON.parse(JSON.stringify(o));delete copy.conversation_config.agent.prompt.prompt;return JSON.stringify(copy.conversation_config)+JSON.stringify(copy.platform_settings);};
 if(unchanged(before)!==unchanged(after))throw Error('Unrelated provider configuration changed');
 console.log('Verified live brief; models, voice, knowledge and tools preserved.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
