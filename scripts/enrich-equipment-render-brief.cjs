const fs=require('node:fs');const crypto=require('node:crypto');const {ConvexHttpClient}=require('convex/browser');
const target='docs/design/rental-experience/master-inventory.json';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
(async()=>{
 const client=new ConvexHttpClient('https://hearty-oyster-600.convex.cloud');
 const master=await client.query('items:listForReconcile',{});
 const names=new Map();for(const i of master){if(names.has(i.name))throw Error('Duplicate master canonical name requires ID-based review');names.set(i.name,i._id)}
 let cursor=0;const enriched=new Array(master.length);
 async function worker(){while(cursor<master.length){const index=cursor++,row=master[index];const response=await client.query('walle_inventory:lookup',{query:row.name,include_marketing:true});const exact=response.matches.filter(m=>m.name===row.name);if(exact.length>1)throw Error('Ambiguous inventory identity');const m=exact[0];
  const verified=!!m?.spec_verification&&!m.spec_verification_required&&!!m.spec_description;
  const factualDescription=verified?m.spec_description:null;
  const description=verified?`${row.name}. ${factualDescription}`:`${row.name}. ${m?.kind?`Master inventory category: ${m.kind}. `:''}Technical details await verification.`;
  const prompt=`Side-view hero product photograph of the exact ${row.name}. ${verified?`Verified equipment description: ${factualDescription}. `:''}Show one individual physical item only, no invented accessories or additional kit. The equipment fills 85 percent of the frame without cropping. Matte dark studio room and dark floor, cool overhead spotlight directly above the equipment, subtle contact shadow, crisp realistic hardware details, consistent landscape framing and lighting across the inventory series. No people, promotional lettering, captions or watermark.`;
  const evidence={inventoryId:row._id,canonicalName:row.name,quantity:row.qty,kind:m?.kind??null,owned:m?.owned??null,verification:m?.spec_verification??null,factualDescription};
  enriched[index]={id:row._id,name:row.name,displayName:row.display_name,quantity:row.qty,aliases:row.aliases??[],kind:m?.kind??null,owned:m?.owned??null,isMarketingOnly:m?.is_marketing_only??null,description,verifiedDescription:factualDescription,specVerification:m?.spec_verification??null,descriptionStatus:verified?'Reviewed master specification; visual reference/appearance check outstanding':m?'Technical specification needs verification':'Inactive/unmatched master row requires review',heroPrompt:prompt,sourceEvidenceSha256:hash(evidence),renderReadiness:verified&&m.owned?'description-ready; references and output review required':'requires factual/ownership review'};
 }}
 await Promise.all([worker(),worker(),worker(),worker()]);
 const data={source:'Rental Manager items:listForReconcile + walle_inventory:lookup (exact canonical matches only)',deployment:'hearty-oyster-600',checkedAt:new Date().toISOString(),items:enriched};fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({items:enriched.length,reviewedDescriptions:enriched.filter(i=>i.verifiedDescription).length,owned:enriched.filter(i=>i.owned).length,needsReview:enriched.filter(i=>!i.verifiedDescription).length,manifestSha256:hash(data),noProviderWrites:true}));
})().catch(e=>{console.error('Render brief enrichment failed:',e.message);process.exitCode=1});
