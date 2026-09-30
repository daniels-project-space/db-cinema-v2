/** Source files come from authenticated, read-only /v4/my/products detail reads.
 * Never fuzzy-match bundles automatically: a different lens/count is a different rental.
 * Run with --source-dir=/tmp --out=data/rental-contents.json; --apply uses ADMIN_TOKEN
 * and CONVEX_URL explicitly, so it cannot select another project's default deployment. */
const fs=require('fs'),path=require('path');const {extractContents}=require('../shared/rentalContents');
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
async function main(){
 const dir=(process.argv.find(x=>x.startsWith('--source-dir='))??'--source-dir=/tmp').split('=')[1];
 const rows=JSON.parse(fs.readFileSync(path.join(dir,'dbc-listing-rows.json')));
 const diogo=JSON.parse(fs.readFileSync(path.join(dir,'dbc-details-diogo.json'))),db=JSON.parse(fs.readFileSync(path.join(dir,'dbc-details-dbcinema.json')));
 const matches=require('../data/rental-contents-matches.json');const manifest=[];
 for(const listing of rows){
  const original=db.find(x=>x.productId===listing.hyggloProductId);
  const same=diogo.filter(x=>norm(x.name)===norm(listing.title));
  const pinned=matches[listing.hyggloProductId];
  const candidate=pinned?diogo.find(x=>x.productId===pinned.productId):null;
  const primary=pinned&&candidate&&norm(pinned.storefrontTitle)===norm(listing.title)&&norm(pinned.sourceTitle)===norm(candidate.name)?candidate:same.length===1?same[0]:null;
  const usable=primary&&extractContents(primary.description).status==='documented'?primary:original;
  const extracted=extractContents(usable?.description??'');const {excerpt,...contents}=extracted;
  manifest.push({productId:listing.hyggloProductId,title:listing.title,contents:{...contents,sources:usable?[{account:usable.account,productId:usable.productId,url:usable.url,checkedAt:usable.fetchedAt,excerpt:usable.description}]:[]}});
 }
 const out=(process.argv.find(x=>x.startsWith('--out='))??'--out=data/rental-contents.json').split('=')[1];
 fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
 console.log('Contents audit',JSON.stringify({total:manifest.length,documented:manifest.filter(x=>x.contents.status==='documented').length,unknown:manifest.filter(x=>x.contents.status==='unknown').length,diogoPrimary:manifest.filter(x=>x.contents.sources[0]?.account==='diogo').length}));
 if(process.argv.includes('--apply')){
  for(const account of ['diogo','dbcinema']) {const receipt=JSON.parse(fs.readFileSync(path.join(dir,'dbc-details-'+account+'.audit.json')));if(!receipt.complete)throw Error('Incomplete source acquisition; existing contents will not be overwritten');}
  if(!process.env.CONVEX_URL||!process.env.ADMIN_TOKEN)throw Error('Explicit CONVEX_URL and ADMIN_TOKEN required');
  const {ConvexHttpClient}=require('convex/browser');const c=new ConvexHttpClient(process.env.CONVEX_URL);
  for(let i=0;i<manifest.length;i+=50){const result=await c.mutation('rentalContents:apply',{token:process.env.ADMIN_TOKEN,items:manifest.slice(i,i+50).map(({productId,contents})=>({productId,contents}))});console.log('Applied',i,result.updated);}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
