/** Exercise the real read-only stock bridge; production hides validator errors. */
function binding(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.hostname.endsWith('.convex.cloud'))return null;return url.origin}catch{return null}
}
async function checkStockBackend({backendUrl,frontendUrl,fetchImpl=fetch}){
 const backend=binding(backendUrl),frontend=binding(frontendUrl);
 if(!backend||!frontend)return {ok:false,code:'INVALID_BACKEND_BINDING'};
 if(backend!==frontend)return {ok:false,code:'FRONTEND_BACKEND_MISMATCH'};
 const request=async(kind,path,args)=>{
  const response=await fetchImpl(`${backend}/api/${kind}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path,args,format:'json'}),signal:AbortSignal.timeout(15000)});
  return {response,json:await response.json()};
 };
 try{
  const catalog=await request('query','catalog:listListings',{});
  if(!catalog.response.ok||catalog.json?.status!=='success')return {ok:false,code:'CATALOG_UNAVAILABLE',backend};
  const value=catalog.json.value;
  const rows=Array.isArray(value)?value:value?.items??value?.listings??[];
  const listing=Array.isArray(rows)?rows.find(row=>typeof row?._id==='string'&&row._id.length>0):null;
  if(!listing)return {ok:false,code:'CATALOG_EMPTY',backend};
  const start=Math.floor((Date.now()+60*86400000)/86400000)*86400000;
  const {response,json}=await request('action','sync:refreshCartStock',{items:[{listingId:listing._id,start,end:start}]});
  // Do not print provider responses, account data, request IDs or error stacks.
  const error=typeof json?.errorMessage==='string'?json.errorMessage:'';
  if(json?.status==='error'&&error.includes('Could not find public function'))return {ok:false,code:'STOCK_FUNCTION_NOT_DEPLOYED',backend};
  const stock=json?.value,availability=stock?.availability?.[listing._id];
  if(response.ok&&json?.status==='success'&&Number.isSafeInteger(stock?.checkedAt)&&stock.checkedAt>0&&
     Number.isSafeInteger(availability?.available)&&availability.available>=0&&Number.isSafeInteger(availability?.demanded)&&availability.demanded>0&&typeof availability?.ok==='boolean')
   return {ok:true,code:'STOCK_FUNCTION_AVAILABLE',backend};
  return {ok:false,code:'UNEXPECTED_STOCK_BACKEND_RESPONSE',backend};
 }catch{return {ok:false,code:'BACKEND_UNREACHABLE',backend}}
}
module.exports={checkStockBackend};
if(require.main===module)checkStockBackend({backendUrl:process.env.DBC_CONVEX_URL,frontendUrl:process.env.NEXT_PUBLIC_CONVEX_URL}).then(result=>{console.log(JSON.stringify(result));if(!result.ok){console.error('Deploy the compatible backend and stock bridge to the intended environment before running checkout acceptance. Checkout assertions remain required.');process.exitCode=1}}).catch(()=>{console.error('Stock backend check failed');process.exitCode=1});
