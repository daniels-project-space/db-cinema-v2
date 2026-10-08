const fs=require('node:fs');const crypto=require('node:crypto');const {ConvexHttpClient}=require('convex/browser');
const target='docs/design/rental-experience/master-inventory.json';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const factReviews=JSON.parse(fs.readFileSync('docs/design/rental-experience/equipment-fact-review.json','utf8')).reviews;
const factsById=new Map(factReviews.map(r=>[r.inventoryId,r]));
if(factsById.size!==factReviews.length)throw Error('Duplicate reviewed inventory ID');
const references=JSON.parse(fs.readFileSync('docs/design/rental-experience/equipment-reference-review.json','utf8')).references;
(async()=>{
 const client=new ConvexHttpClient('https://hearty-oyster-600.convex.cloud');
 const master=await client.query('items:listForReconcile',{});
 const names=new Map();for(const i of master){if(names.has(i.name))throw Error('Duplicate master canonical name requires ID-based review');names.set(i.name,i._id)}
 const masterById=new Map(master.map(i=>[i._id,i]));
 for(const review of factReviews){
  if(masterById.get(review.inventoryId)?.name!==review.canonicalName)throw Error(`Reviewed fact no longer matches master: ${review.inventoryId}`);
  if(!review.description||!review.checkedAt||!review.verificationScope||!review.sourceUrl?.startsWith('https://')||typeof review.compositionReady!=='boolean')throw Error('Incomplete reviewed manufacturer fact');
 }
 let cursor=0;const enriched=new Array(master.length);
 async function worker(){while(cursor<master.length){const index=cursor++,row=master[index];const response=await client.query('walle_inventory:lookup',{query:row.name,include_marketing:true});const exact=response.matches.filter(m=>m.name===row.name);if(exact.length>1)throw Error('Ambiguous inventory identity');const m=exact[0];
  const verified=!!m?.spec_verification&&!m.spec_verification_required&&!!m.spec_description;
  const local=factsById.get(row._id);
  if(local&&(local.canonicalName!==row.name||!m?.owned||m.is_marketing_only))throw Error(`Reviewed fact identity/ownership changed: ${row._id}`);
  const factualDescription=verified?m.spec_description:local?.description??null;
  const provenance=verified?{type:'reviewed-master',verification:m.spec_verification}:local?{type:'local-manufacturer-review',review:local}:null;
  const composition=local?.compositionReady?local.composition:null;
  const compositionBlockers=local?.compositionBlockers??[];
  const description=factualDescription?`${row.name}. ${factualDescription}`:`${row.name}. ${m?.kind?`Master inventory category: ${m.kind}. `:''}Technical details await verification.`;
  const prompt=`Side-view hero product photograph of the exact ${row.name}. ${factualDescription?`Reviewed model description: ${factualDescription}. `:''}${composition?`${composition} `:''}Show one individual physical item only, no invented accessories or additional kit. The equipment fills 85 percent of the frame without cropping. Matte dark studio room and dark floor, cool overhead spotlight directly above the equipment, subtle contact shadow, crisp realistic hardware details, consistent landscape framing and lighting across the inventory series. No people, promotional lettering, captions or watermark.`;
  const evidence={inventoryId:row._id,canonicalName:row.name,quantity:row.qty,kind:m?.kind??null,owned:m?.owned??null,provenance,factualDescription,composition,compositionBlockers};
  const cachedReferenceReview=references.filter(r=>r.items.some(i=>i.id===row._id)).map(r=>({url:r.url,sha256:r.sha256??null,status:r.status,mismatched:r.mismatchedItems?.includes(row.name)??false,accepted:r.renderReferenceAccepted===true}));
  enriched[index]={id:row._id,name:row.name,displayName:row.display_name,quantity:row.qty,aliases:row.aliases??[],kind:m?.kind??null,owned:m?.owned??null,isMarketingOnly:m?.is_marketing_only??null,description,verifiedDescription:factualDescription,specVerification:m?.spec_verification??null,descriptionProvenance:provenance,composition,compositionBlockers,cachedReferenceReview,descriptionStatus:factualDescription?'Reviewed model facts; rental contents and visual acceptance remain separate':m?'Technical specification needs verification':'Inactive/unmatched master row requires review',heroPrompt:prompt,sourceEvidenceSha256:hash(evidence),renderReadiness:compositionBlockers.length?'requires kit/region configuration review':factualDescription&&m.owned?'description-ready; references and output review required':'requires factual/ownership review'};
 }}
 await Promise.all([worker(),worker(),worker(),worker()]);
 const data={source:'Rental Manager items:listForReconcile + walle_inventory:lookup (exact canonical matches only)',deployment:'hearty-oyster-600',checkedAt:new Date().toISOString(),items:enriched};fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({items:enriched.length,reviewedDescriptions:enriched.filter(i=>i.verifiedDescription).length,owned:enriched.filter(i=>i.owned).length,needsReview:enriched.filter(i=>!i.verifiedDescription).length,manifestSha256:hash(data),noProviderWrites:true}));
})().catch(e=>{console.error('Render brief enrichment failed:',e.message);process.exitCode=1});
