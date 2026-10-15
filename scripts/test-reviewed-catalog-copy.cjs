const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs'),fs=require('node:fs'),ts=require('typescript');
process.env.ADMIN_TOKEN='catalog-copy-fixture-admin';
const {deriveSpecs,deriveItemType,categoryFor,COMPLEMENTS}=h.load('convex/lib/taxonomy.ts');
for(const title of [
 'Anker Nebula 4K Laser Projector | Portable Battery Powered Smart Cinema',
 'Anker Nebula 4K Laser Projector + Projection Screen | Portable Battery Powered',
 'Anker Nebula 4K Laser Projector + Projection Screen + 2× JBL PartyBox Speakers |',
 'NEBULA Projector, Tripod Screen and 2× JBL PartyBox',
 'NEBULA battery-powered projector',
 'ViewSonic Projector · Enquiry Only',
]){assert.equal(deriveItemType(title),'projector',title);assert.equal(categoryFor(title),'Projectors',title);assert.equal(deriveSpecs(title,'projector').batteryType,null,'Projector power must not be inferred from wording');}
for(const [title,type] of [
 ['Projector stand for NEBULA','accessory'],['Tripod for NEBULA projector','tripod'],
 ['Replacement battery for NEBULA projector','battery'],['Projector lens for Epson','lens'],
 ['NEBULA projector remote control','accessory'],['Anker NEBULA projector carry case','accessory'],
 ['JBL PartyBox speaker with projector','speaker'],['Anker power station for NEBULA projector','battery'],
])assert.equal(deriveItemType(title),type,title);
assert.deepEqual(COMPLEMENTS.projector,['speaker'],'Do not infer a compatible power bank or camera battery');
for(const [title,includesLens] of [
 ['Blackmagic PYXIS 6K Basic Camera Kit',false],
 ['Blackmagic PYXIS 6K Advanced V-Mount Camera Kit',false],
 ['Blackmagic PYXIS 6K with Canon EF Zoom Pair',true],
 ['Blackmagic PYXIS 6K Documentary Kit with Canon Zooms',true],
 ['Blackmagic PYXIS 6K with 25mm, 50mm and 75mm Cine Primes',true],
 ['Blackmagic PYXIS 6K Production Kit with Cine Lens Set',true],
 ['Blackmagic Pyxis 6K Cinema Camera Basic Set | Modular 6K RAW ProRes Body + PL/EF',false],
 ['Blackmagic PYXIS 6K EF/PL adapter kit',false],
 ['Blackmagic PYXIS 6K PL / EF adapter kit',false],
]){
 const specs=deriveSpecs(title,'camera-body');
 assert.equal(specs.mount,null,'Kit lenses/adapters must not establish the physical camera mount: '+title);
 assert.equal(specs.batteryType,'BP-U');assert.equal(specs.coverage,'ff');
 assert.equal(specs.includesLens,includesLens);assert.equal(specs.hasAutofocus,null);
}
for(const [variant,mount] of [['EF','EF'],['PL','PL'],['L-Mount','L']])assert.equal(deriveSpecs('Blackmagic PYXIS 6K '+variant,'camera-body').mount,mount);
assert.equal(deriveSpecs('Canon EF zoom lens for Blackmagic PYXIS 6K','lens').mount,'EF','Camera rule must not replace a lens mount');
const copy=h.load('convex/rentalContents.ts'),catalog=h.load('convex/catalog.ts'),{catalogCopyFingerprint}=h.load('shared/catalogCopy.ts');
const listing=h.put('listings',{slug:'copy-fixture',title:'Fixture camera kit',hyggloProductId:100,category:'Cameras',components:[{inventoryUnitId:'inventory_units-fixture',qty:1}],active:true,pricing:{daily:50},depositAmount:1000,sourceImages:['https://fixture.invalid/image.jpg'],knowledge:{summary:'Old summary'}});
h.put('inventory_units',{_id:'inventory_units-fixture',rmv2ItemId:'fixture-camera',sku:'mi-fixture-camera',name:'Fixture camera',quantityOwned:1,replacementCost:1000,active:true});
const original={price:structuredClone(listing.pricing),deposit:listing.depositAmount,components:structuredClone(listing.components),images:structuredClone(listing.sourceImages)},contents={included:['1x Camera','2x Batteries'],optional:['Tripod on request'],excluded:['Standard USB charging lead'],notes:['Collect at the agreed time.'],status:'documented',sources:[{account:'diogo',productId:200,url:'https://hygglo.com/uk/i/fixture-camera-kit',checkedAt:Date.now(),excerpt:'In this kit:\n- 1x Camera\n- 2x Batteries\nTripod on request. Standard USB charging lead is not included.'}]};
const reviewedCopy={title:'Reviewed fixture camera kit',expectedFingerprint:catalogCopyFingerprint(listing),description:'A camera hire kit with the two listed batteries. Choose your dates to check live stock.',knowledge:{summary:'Camera kit with two batteries.',features:['Camera body','Two batteries'],limits:[],bestFor:['Video production'],tips:[],pairsWith:[]},review:{sourceAccount:'diogo',sourceProductId:200,identityReview:'Matched the exact camera kit and battery quantity against the seller offer.',firstFactReview:'Read the complete seller description and retained only explicit inclusions.',secondFactReview:'Reviewed again for different kits, duplicate accessories and charging exclusions.'}};
const args={token:process.env.ADMIN_TOKEN,requestId:'reviewed-catalog-copy-fixture-01',items:[{productId:100,listingTitle:listing.title,contents,reviewedCopy}]},ctx={db:h.db};
(async()=>{
 await assert.rejects(copy.apply.handler(ctx,{...args,token:'foreign'}),/Unauthorized/);
 await assert.rejects(copy.apply.handler(ctx,{...args,requestId:undefined}),/stable publishing/);
 await assert.rejects(copy.apply.handler(ctx,{...args,items:[{...args.items[0],reviewedCopy:{...reviewedCopy,review:{...reviewedCopy.review,secondFactReview:''}}}]}),/Both fact reviews/);
 const changed=structuredClone(args);changed.items[0].reviewedCopy.expectedFingerprint='stale';await assert.rejects(copy.apply.handler(ctx,changed),/kit identity changed/);
 const wrong=structuredClone(args);wrong.items[0].reviewedCopy.review.sourceProductId=300;await assert.rejects(copy.apply.handler(ctx,wrong),/attached seller evidence/);
 assert.equal(listing.description,undefined);assert.equal((h.tables.get('catalog_copy_batches')??[]).length,0);
 assert.equal((await copy.apply.handler(ctx,args)).updated,1);assert.equal((await copy.apply.handler(ctx,args)).replayed,true);assert.equal(h.tables.get('catalog_copy_batches').length,1);
 await assert.rejects(copy.apply.handler(ctx,{token:process.env.ADMIN_TOKEN,items:[{productId:100,listingTitle:listing.title,contents}]}),/unreviewed contents import/);
 await assert.rejects(h.load('convex/sync.ts').applyKnowledge.handler(ctx,{token:process.env.ADMIN_TOKEN,items:[{id:listing._id,knowledge:{summary:'Unreviewed title-only claims'}}]}),/source-backed review/);
 const retry=structuredClone(args);retry.items[0].reviewedCopy.description+=' Changed.';await assert.rejects(copy.apply.handler(ctx,retry),/different particulars/);
 assert.deepEqual(listing.pricing,original.price);assert.equal(listing.depositAmount,original.deposit);assert.deepEqual(listing.components,original.components);assert.deepEqual(listing.sourceImages,original.images);
 const view=await catalog.getListingBySlug.handler(ctx,{slug:listing.slug});assert.equal(view.title,reviewedCopy.title);assert.equal(listing.copyReview.sourceTitle,'Fixture camera kit');assert.equal(view.description,reviewedCopy.description);assert.deepEqual(view.rentalContents.included,contents.included);
 const code=ts.transpileModule(fs.readFileSync('src/components/booking/RentalContentsList.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(name=>name.endsWith('shared/rentalContents')?require('../shared/rentalContents'):require(name),m,m.exports);
 const html=require('react-dom/server').renderToStaticMarkup(require('react').createElement(m.exports.RentalContentsList,{listing:view}));for(const text of ['What’s included','1x Camera','2x Batteries','Optional','Tripod on request','Not included','Standard USB charging lead'])assert(html.includes(text),text);
 const safe=require('react-dom/server').renderToStaticMarkup(require('react').createElement(m.exports.RentalContentsList,{listing:{rentalContents:{...contents,included:['<script>alert(1)</script>']}}}));assert(!safe.includes('<script>'));
 const unknown=require('react-dom/server').renderToStaticMarkup(require('react').createElement(m.exports.RentalContentsList,{listing:{category:'Cameras'}}));assert(unknown.includes('confirm the supplied accessories'));assert(!unknown.includes('2x Batteries'));
 const sync=h.load('convex/sync.ts'),source={hyggloProductId:100,slug:listing.slug,title:'Fixture camera kit',category:'Cameras',itemType:'camera-body',sizeScore:1,weightKg:1,sourceImages:original.images,pricing:original.price,depositAmount:1000,minimumRentalDays:1,unavailableDates:[],stockMappingStatus:'complete',stockComponents:[{masterItemId:'fixture-camera',name:'Fixture camera',qty:1,quantityOwned:1,replacementCost:1000,active:true}]};
 await sync.applyCatalog.handler(ctx,{items:[source]});
 assert.equal(listing.title,reviewedCopy.title,'unchanged source cannot restore an unreviewed title');assert.equal(listing.description,reviewedCopy.description);assert.deepEqual(listing.rentalContents.included,contents.included);
 await sync.applyCatalog.handler(ctx,{items:[{...source,title:'Source changed camera configuration'}]});
 assert.equal(listing.title,'Source changed camera configuration');assert.equal(listing.copyReview,undefined);assert.equal(listing.description,undefined);assert.equal(listing.rentalContents,undefined);
 const projector=h.put('listings',{slug:'projector-fixture',hyggloProductId:101,title:'NEBULA Projector Fixture',itemType:'battery',category:'Power',isPackage:false,sizeScore:2,weightKg:1.5,pricing:{daily:30},depositAmount:100,components:[],stockMappingStatus:'not_owned',specs:{includesLens:false},active:true});
 await sync.applyCatalog.handler(ctx,{items:[{...source,hyggloProductId:101,slug:projector.slug,title:projector.title,itemType:'projector',category:'Projectors',sizeScore:4,weightKg:8,pricing:projector.pricing,depositAmount:100,stockComponents:[],stockMappingStatus:'not_owned'}]});
 assert.equal(projector.itemType,'projector');assert.equal(projector.category,'Projectors');assert.equal(projector.sizeScore,2);assert.equal(projector.weightKg,1.5);assert.equal(projector.pricing.daily,30);assert.deepEqual(projector.components,[]);assert.equal(projector.stockMappingStatus,'not_owned');
 console.log('PASS actual reviewed-copy publishing → public listing query → real included/optional/excluded UI: two recorded reviews, exact seller identity, stale-copy rejection, immutable request replay, protected auth, plain escaped text, unknown accessories remain unknown; unchanged prices, stock, images and rentals. Synthetic data only.');
})().catch(e=>{console.error(e);process.exitCode=1});
