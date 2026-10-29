const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const {extractContents,contentsFor,contentsText}=require('../shared/rentalContents');
const {sourceContents}=require('./lib/source-contents.cjs');
const reviewed=require('../data/rental-contents-facts.json');
for (const r of reviewed) {
 const source={account:r.account,productId:r.productId,name:r.sourceTitle,description:r.sourceDescription};
 assert.deepEqual(sourceContents(source).included,r.included);
 assert.equal(sourceContents({...source,name:source.name+' changed'}).status,'unknown');
 assert.equal(sourceContents({...source,description:source.description+' Changed package.'}).status,'unknown');
 assert.equal(sourceContents({...source,productId:-1}).status,'unknown');
}
const c=extractContents('In this kit:\n- 1x FX3\n- 1x 256GB SD card\n- 3x NP-FZ100 batteries\n- 1x XLR cable (optional)\n\nAdd-ons:\nAdd a tripod for £15/day');
assert.deepEqual(c.included,['1x FX3','1x 256GB SD card','3x NP-FZ100 batteries']);assert.equal(c.optional.length,1);assert.ok(!JSON.stringify(c.included).includes('tripod'));
assert.equal(extractContents('Battery type NP-FZ100. Compatible with SDXC cards.').status,'unknown');
assert.equal(contentsFor({category:'Cameras',specs:{batteryType:'NP-FZ100'}}).includes.length,0);
assert.ok(!contentsText({category:'Cameras'}).includes('memory cards are not included'));
assert.equal(extractContents("In this kit, you'll find:\n1x Microphone\nA protective carry bag\n\nKey features:\n- Long range").included.length,2);
assert.equal(extractContents('⭐️Included in this set⭐️\n- 2x Batteries\n\nAbout us').included.length,1);
const inventoryFacts={version:1,contents:['1 × Sony A7 V','1 × 256GB SDXC V90 card'],optionalContents:['Sony XLR Handle Unit'],reviewRequired:false,owned:true};
assert.deepEqual(contentsFor({inventoryFacts}).optional,['Sony XLR Handle Unit']);assert.deepEqual(contentsFor({inventoryFacts}).includes,inventoryFacts.contents);assert.match(contentsText({inventoryFacts}),/256GB SDXC V90/);assert.match(contentsText({inventoryFacts}),/Owner-verified contents/);
assert.match(contentsText({inventoryFacts:{...inventoryFacts,owned:false}}),/not backed by rentable owned stock/);
const verifiedOwnerListing={inventoryFacts,rentalContents:{included:['3x third-party transmitter','1x competitor receiver'],optional:['third-party lav mic'],excluded:['charging cable'],notes:['another seller package'],sources:[{account:'other-seller',productId:123456,url:'https://example.test/listing',checkedAt:1}],status:'documented'}};
const ownerContents=contentsFor(verifiedOwnerListing);
assert.deepEqual(ownerContents.includes,inventoryFacts.contents,'completed owned-stock facts replace generic seller copy');
assert.deepEqual(ownerContents.optional,['Sony XLR Handle Unit']);assert.deepEqual(ownerContents.excludes,[]);assert.deepEqual(ownerContents.notes,[]);assert.deepEqual(ownerContents.contentsSources,[]);
const ownerText=contentsText(verifiedOwnerListing);assert.match(ownerText,/Owner-verified contents for this rental/);assert.match(ownerText,/256GB SDXC V90/);assert.doesNotMatch(ownerText,/third-party|competitor|another seller/);
const reviewText=contentsText({...verifiedOwnerListing,inventoryFacts:{...inventoryFacts,reviewRequired:true}});assert.match(reviewText,/confirm them before promising/);assert.match(reviewText,/third-party transmitter/);
const rows=require('../data/rental-contents.json');assert.equal(new Set(rows.map(x=>x.productId)).size,rows.length);
for(const row of rows){for(const fact of [...row.contents.included,...row.contents.optional,...row.contents.excluded,...row.contents.notes])assert.ok(row.contents.sources.some(s=>s.excerpt.includes(fact)),`${row.productId} unsourced: ${fact}`);}

function loadBoundary(file){
 const compiled=ts.transpileModule(fs.readFileSync(require.resolve('../'+file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};const refs=new Proxy({},{get:()=>new Proxy({},{get:()=> 'reference'})});
 new Function('require','module','exports',compiled)(p=>p==='./_generated/server'?{mutation:x=>x,internalMutation:x=>x,internalQuery:x=>x,internalAction:x=>x,action:x=>x}:p==='convex/values'?{v:new Proxy({},{get:()=>()=>0})}:p==='./_generated/api'?{internal:refs,api:refs}:p==='./adminAuth'?{checkAdminToken:()=>true}:p==='./lib/marketingInventory'?require('./lib/rentalTestHarness.cjs').load('convex/lib/marketingInventory.ts'): {},module,module.exports);return module.exports;
}
async function configurationGuards(){
 const {apply}=loadBoundary('convex/rentalContents.ts');let writes=0;
 await assert.rejects(apply.handler({db:{query:()=>({withIndex:()=>({unique:async()=>({title:'New package'})})}),patch:async()=>writes++}},{token:'test',items:[{productId:1,listingTitle:'Old package',contents:{sources:[],status:'unknown'}}]}),/configuration changed/);
 assert.equal(writes,0,'old acquired contents must not attach to a renamed package');
 const {applyCatalog}=loadBoundary('convex/sync.ts');
 for(const changed of [false,true]){
  const writes=[];const row={_id:'listing',title:'Old package',hyggloProductId:1,components:[{inventoryUnitId:'unit',qty:1}],rentalContents:{included:['Old lens']}};
  const ctx={db:{query:table=>({withIndex:()=>({first:async()=>table==='inventory_units'?{_id:'unit',quantityOwned:1}:row,collect:async()=>[]})}),patch:async(id,patch)=>writes.push({id,patch})}};
  await applyCatalog.handler(ctx,{items:[{hyggloProductId:1,stockMappingStatus:'complete',stockComponents:[{masterItemId:'camera',name:'Camera',qty:1,quantityOwned:1,active:true,replacementCost:100}],slug:'listing',title:changed?'New package':'Old package',category:'Cameras',itemType:'camera-body',sourceImages:[],pricing:{daily:20},depositAmount:100,replacementCost:100,minimumRentalDays:1,unavailableDates:[]}]});
  const patch=writes.find(x=>x.id==='listing').patch;
  assert.equal(Object.hasOwn(patch,'rentalContents'),changed);
  if(changed)assert.equal(patch.rentalContents,undefined,'a new configuration must forget the old contents');
 }
}

// Run the actual public voice search boundary, not just a formatter snapshot.
const source=ts.transpileModule(fs.readFileSync(require.resolve('../convex/voiceCatalog.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};new Function('require','module','exports',source)(p=>p==='./_generated/server'?{query:x=>x}:p==='convex/values'?require('convex/values'):p==='../shared/rentalContents'?require('../shared/rentalContents'):p==='../../shared/equipmentIdentity'?require('../../shared/equipmentIdentity'):p==='../../shared/rentalContents'?require('../../shared/rentalContents'):p==='./lib/marketingInventory'?require('./lib/rentalTestHarness.cjs').load('convex/lib/marketingInventory.ts'):p.startsWith('../shared/')?require('./lib/rentalTestHarness.cjs').load(p.replace('../','')+'.ts'):{},mod,mod.exports);
(async()=>{await configurationGuards();const fx=rows.find(x=>x.contents.included.some(s=>/SD card|SDXC|CFexpress/.test(s))&&/fx3/i.test(x.title));assert.ok(fx);const listing={_id:'fixture',title:fx.title,slug:'fixture',category:'Cameras',active:true,pricing:{daily:30},rentalContents:fx.contents,inventoryFacts,specs:{batteryType:'NP-FZ100'}};const ctx={db:{query:()=>({collect:async()=>[listing],withIndex:()=>({collect:async()=>[listing]})})}};const result=await mod.exports.search.handler(ctx,{q:fx.title,limit:1});assert.deepEqual(result.matches[0].includes,inventoryFacts.contents);assert.equal(contentsText(result.matches[0]),contentsText({inventoryFacts}),'the main voice lookup must prefer exact owned-stock facts over another offer');assert.deepEqual(result.matches[0].inventoryFacts,inventoryFacts);assert.deepEqual(result.matches[0].excludes,[]);assert.deepEqual(result.matches[0].contentsSources,[]);console.log('PASS exact owned-stock facts override unrelated seller contents at the public voice-search boundary');})().catch(e=>{console.error(e);process.exitCode=1});
