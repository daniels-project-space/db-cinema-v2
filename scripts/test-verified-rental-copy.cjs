const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {contentsFor,contentsText}=require('../shared/rentalContents');
const {bundleContentSimilarity,displayListingCopy,sanitizeCustomerCopy}=require('../shared/verifiedRentalCopy');

function owner(model='DJI RS3 Pro'){
  return {_id:'verified-gimbal',active:true,category:'Stabilizers',itemType:'gimbal',stockMappingStatus:'complete',
    inventoryFacts:{version:1,owned:true,reviewRequired:false,contents:[`1 × ${model} gimbal`,'1 × battery grip','1 × extended tripod grip','1 × camera mounting plate','1 × cable set','1 × carry case'],optionalContents:[]},
    components:[{inventoryUnitId:'physical-gimbal-1',qty:1}]};
}
function packageListing(unit='physical-gimbal-1'){
  return {_id:'fx3-package',active:true,category:'Cameras',itemType:'camera-body',stockMappingStatus:'incomplete',
    title:'Sony FX3 · 24–70mm GM & DJI RS 2 Kit',description:'A complete filming package. This package is enquiry only: the DJI RS 2 is not currently stocked. It includes a DJI RS 2 gimbal. f/2.8 lens.',
    components:[{inventoryUnitId:unit,qty:1},{inventoryUnitId:'physical-camera-1',qty:1},{inventoryUnitId:'physical-lens-1',qty:1}],
    rentalContents:{included:['1 × Sony FX3','1 × DJI RS 2 gimbal','1 × DJI Ronin gimbal battery'],optional:[],excluded:[],notes:['Not currently stocked: DJI RS 2. This advertised package is enquiry only and cannot be booked as listed.','Confirm the 24–70mm lens generation, gimbal charge/cable pack, mounting and balance. A telephoto build must be checked rather than assuming every configuration balances.','The pickup includes a labelled case.'],status:'documented',sources:[{account:'owner-source',productId:'1173646',url:'https://example.invalid/source',checkedAt:1,excerpt:'private source text'}]}};
}
function loadPublicCopyBoundary(evidence){
  const file=require.resolve('../convex/lib/publicListingCopy.ts');
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)((id)=>id==='../../shared/verifiedRentalCopy'?require('../shared/verifiedRentalCopy'):require(id),mod,mod.exports);
  let indexName=null,takeCount=0,conditions=[];
  const query={eq:(key,value)=>{conditions.push([key,value]);return query;}};
  const ctx={db:{query(table){assert.equal(table,'listings');return {withIndex(name,build){indexName=name;build(query);return {take:async count=>{takeCount=count;return evidence;}};}};}}};
  return {decorate:mod.exports.createPublicListingCopy(ctx),readback:()=>({indexName,takeCount,conditions})};
}

const displayed=displayListingCopy(packageListing(),[owner()]);
assert.match(displayed.title,/Sony FX3/);
assert.match(displayed.title,/DJI RS3 Pro Kit/);
assert.doesNotMatch(displayed.title,/RS\s*2/i);
assert.match(displayed.description,/DJI RS3 Pro gimbal/);
assert.match(displayed.description,/f\/2\.8 lens/,'decimal lens specs stay intact');
assert.doesNotMatch(displayed.description,/enquiry only|not currently stocked/i);
assert.deepEqual(displayed.rentalContents.notes,['The pickup includes a labelled case.']);
assert.ok(displayed.verifiedComponentContents.includes('1 × DJI RS3 Pro gimbal'));
assert.ok(displayed.verifiedComponentContents.includes('1 × cable set'));
assert.ok(displayed.rentalContents.included.includes('1 × DJI Ronin gimbal battery'),'separate battery copy is retained');
assert.equal(displayed.itemType,'camera-body','the physical camera package is not replaced');
assert.equal(displayed.components[1].inventoryUnitId,'physical-camera-1');
assert.ok(!JSON.stringify(displayed.rentalContents.sources).includes('private source text'));
assert.match(contentsText(displayed),/DJI RS3 Pro gimbal/);
assert.doesNotMatch(contentsText(displayed),/Confirm the|not currently stocked|cannot be booked as listed/i);
assert.ok(contentsFor(displayed).includes.some(line=>/extended tripod grip/i.test(line)));
assert.match(sanitizeCustomerCopy('Sony FE 24–70mm f/2.8 GM. Confirm the cable pack.'),/f\/2\.8 GM/);
assert.equal(sanitizeCustomerCopy('A camera hire kit with the two listed batteries. Choose your dates to check live stock.'),'A camera hire kit with the two listed batteries. Choose your dates to check live stock.');
assert.doesNotMatch(sanitizeCustomerCopy('Confirm the gimbal cable pack.'),/Confirm/i);

const wrongUnit=displayListingCopy(packageListing('different-gimbal-unit'),[owner()]);
assert.match(wrongUnit.title,/RS 2 Kit/,'an unproven physical match never changes the listing name');
assert.doesNotMatch(wrongUnit.description,/not currently stocked|enquiry only/i,'internal availability copy is always removed');
const unowned=owner();unowned.inventoryFacts.owned=false;
assert.match(displayListingCopy(packageListing(),[unowned]).title,/RS 2 Kit/,'unowned inventory cannot authorize a model substitution');

const source=packageListing();
const close={...packageListing(),_id:'close-package',components:[{inventoryUnitId:'physical-camera-1',qty:1},{inventoryUnitId:'physical-lens-1',qty:1},{inventoryUnitId:'another-gimbal',qty:1}],rentalContents:{...displayed.rentalContents,included:['1 × Sony FX3','1 × 24–70mm GM lens','1 × different gimbal']}};
const distant={...packageListing(),_id:'distant-package',components:[{inventoryUnitId:'unrelated-camera',qty:1},{inventoryUnitId:'unrelated-lens',qty:1}],rentalContents:{included:['1 × unrelated camera']}};
assert.ok(bundleContentSimilarity(displayed,close)>bundleContentSimilarity(displayed,distant),'replacement ranking prefers packages retaining the verified physical contents');

(async()=>{
  const boundary=loadPublicCopyBoundary([owner()]);
  const first=await boundary.decorate([packageListing()]);
  assert.match(first[0].title,/RS3 Pro/);
  assert.deepEqual(boundary.readback(),{indexName:'by_active_itemType',takeCount:65,conditions:[['active',true],['itemType','gimbal']]},'owner evidence uses the bounded indexed gimbal lookup');
  const refreshed=loadPublicCopyBoundary([owner('DJI RS4 Pro')]);
  const next=await refreshed.decorate([packageListing()]);
  assert.match(next[0].title,/DJI RS4 Pro/,'a later inventory fact change is reflected on the next reactive query');
  assert.ok(next[0].verifiedComponentContents.includes('1 × DJI RS4 Pro gimbal'));
  const ambiguous=loadPublicCopyBoundary(Array(65).fill(owner()));
  const safe=await ambiguous.decorate([packageListing()]);
  assert.match(safe[0].title,/RS 2 Kit/,'overflowing evidence fails closed instead of choosing an ambiguous owner');
  console.log('PASS verified physical gimbal display copy, private-note removal, bounded/reactive inventory evidence and package-content matching');
})().catch(error=>{console.error(error);process.exitCode=1;});
