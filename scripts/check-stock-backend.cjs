/** Invalid argument type checks registration before the action body can run. */
function binding(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.hostname.endsWith('.convex.cloud'))return null;return url.origin}catch{return null}
}
async function checkStockBackend({backendUrl,frontendUrl,fetchImpl=fetch}){
 const backend=binding(backendUrl),frontend=binding(frontendUrl);
 if(!backend||!frontend)return {ok:false,code:'INVALID_BACKEND_BINDING'};
 if(backend!==frontend)return {ok:false,code:'FRONTEND_BACKEND_MISMATCH'};
 let response,json;
 try{response=await fetchImpl(`${backend}/api/action`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:'sync:refreshCartStock',args:{items:null},format:'json'}),signal:AbortSignal.timeout(10000)});json=await response.json()}catch{return {ok:false,code:'BACKEND_UNREACHABLE',backend}};
 // Do not print provider responses, account data, request IDs or error stacks.
 const error=typeof json?.errorMessage==='string'?json.errorMessage:'';
 if(json?.status==='error'&&error.includes('Could not find public function'))return {ok:false,code:'STOCK_FUNCTION_NOT_DEPLOYED',backend};
 if((response.ok||response.status===560)&&json?.status==='error'&&error.includes('ArgumentValidationError')&&error.includes('items')&&error.includes('array'))return {ok:true,code:'STOCK_FUNCTION_AVAILABLE',backend};
 return {ok:false,code:'UNEXPECTED_STOCK_BACKEND_RESPONSE',backend};
}
module.exports={checkStockBackend};
if(require.main===module)checkStockBackend({backendUrl:process.env.DBC_CONVEX_URL,frontendUrl:process.env.NEXT_PUBLIC_CONVEX_URL}).then(result=>{console.log(JSON.stringify(result));if(!result.ok){console.error('Deploy the compatible backend to the intended environment before running checkout acceptance. Checkout assertions remain required.');process.exitCode=1}}).catch(()=>{console.error('Stock backend check failed');process.exitCode=1});
