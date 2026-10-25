const assert = require('node:assert/strict');
const {load,setMock} = require('./lib/rentalTestHarness.cjs');
for (const [alias,file] of Object.entries({
 '@/lib/pricing':'src/lib/pricing.ts','@/lib/membership':'src/lib/membership.ts',
 '@/lib/dates':'src/lib/dates.ts','@/lib/mount':'src/lib/mount.ts',
 '@/lib/compat':'src/lib/compat.ts','@/lib/kitRank':'src/lib/kitRank.ts','@/lib/site':'src/lib/site.ts',
})) setMock(alias,load(file));
const cam={_id:'fx3',slug:'fx3',title:'Sony FX3 camera + 24-70mm GM lens',itemType:'camera-body',specs:{mount:'E',coverage:'ff',includesLens:true,lensFocal:'24-70',batteryType:'NP-FZ100'},pricing:{daily:90},components:[{inventoryUnitId:'body',qty:1},{inventoryUnitId:'gm',qty:1}],inventoryFacts:{contents:['Sony FX3','Sony 24–70mm GM lens']}};
const gm={_id:'gm',slug:'gm',title:'Sony 24-70mm f2.8 GM lens',itemType:'lens',specs:{mount:'E',coverage:'ff',tier:'premium',lensClass:'af',lensFocal:'24-70'},pricing:{daily:30},demandScore:999,components:[{inventoryUnitId:'gm',qty:1}]};
const wide={...gm,_id:'wide',slug:'wide',title:'Sony 16-35mm f2.8 GM lens',specs:{...gm.specs,lensFocal:'16-35'},demandScore:10,components:[{inventoryUnitId:'wide',qty:1}]};
const mystery={...gm,_id:'mystery',slug:'mystery',title:'Mystery 50mm lens',specs:{coverage:'ff'},components:[{inventoryUnitId:'mystery',qty:1}]};
const rf={...cam,_id:'r5',slug:'r5',title:'Canon R5 camera body',specs:{mount:'RF',coverage:'ff'},components:[{inventoryUnitId:'r5',qty:1}]};
let rows=[cam,gm,wide],availability=1,availabilityWithBasket=1,checks=[],intent={},narration='';
setMock('convex/browser',{ConvexHttpClient:class{async query(name,args){
 if(name==='catalog.listListings')return rows;
 if(name==='catalog.byItemType')return rows.filter(r=>args.types.includes(r.itemType));
 if(name==='catalog.listingsByIds')return rows.filter(r=>args.ids.includes(r._id));
 if(name==='catalog.getListingBySlug')return rows.find(r=>r.slug===args.slug)||null;
 if(name==='catalog.compatibilityKits')return [];
 if(name==='availability.forListing'||name==='availability.forTimeSlots'){
  assert(args.pickupTime&&args.returnTime,'date-only chat must not check/claim final availability');
  checks.push(args);return {available:args.items?.length?availabilityWithBasket:availability};
 }
 throw Error('Unexpected query '+name);
}}});
setMock('@/lib/ai',{generateBotObject:async({prompt})=>{
 if(prompt.startsWith('You parse'))return intent;
 narration=prompt;return {reply:'Grounded response',suggestions:[]};
}});
process.env.OPENROUTER_API_KEY='isolated-fixture-no-provider-call';
const {handleChat}=load('src/lib/gaffer.ts');
async function chat(next,message,cart){
 intent={pricePref:'any',cameraModel:'',subject:'',itemTypes:[],...next};checks=[];
 return handleChat({messages:[{role:'user',content:message}],cart});
}
(async()=>{
 const window={start:'2026-11-20',end:'2026-11-21'};
 let result=await chat({intent:'build_kit',itemTypes:['lens','camera'],...window},'Build a camera and lens kit for 20–21 November');
 assert.deepEqual(result.cards.map(c=>c.item.listingId),['fx3','wide'],'actual planner reasons progressively about included glass, despite lens-first model output');
 assert(result.cards.every(c=>c.item.needsTimes&&c.item.available===null));
 assert.equal(checks.length,0);
 assert(narration.includes('Availability is not confirmed')||narration.includes('ask for complete dates and times'));
 result=await chat({intent:'availability',subject:'Sony FX3',itemTypes:['camera'],...window},'Is the Sony FX3 free 20–21 November?');
 assert.equal(result.cards[0].item.available,null);
 assert(narration.includes('Choose pickup and return times before confirming availability'));
 assert.equal(checks.length,0);
 result=await chat({intent:'availability',subject:'Sony FX3',itemTypes:['camera'],...window,pickupTime:'10:00',returnTime:'17:00'},'Is the Sony FX3 free 20–21 November, pickup10 return17?');
 assert(checks.length>0);
 assert.equal(result.cards[0].item.pickupTime,'10:00');assert.equal(result.cards[0].item.returnTime,'17:00');
 assert.equal(result.cards[0].item.available,true);assert.equal(result.cards[0].item.needsTimes,false);
 result=await chat({intent:'availability',subject:'Sony FX3',itemTypes:['camera'],start:'2026-11-20T00:00:00Z',end:'2026-11-21T00:00:00.000Z',pickupTime:'10:00',returnTime:'17:00'},'Is the Sony FX3 free?');
 assert.equal(result.cards[0].item.start,'2026-11-20');assert.equal(result.cards[0].item.end,'2026-11-21');assert.equal(result.cards[0].item.available,true,'timestamp serialization must preserve a complete availability window');
 availability=0;availabilityWithBasket=0;
 result=await chat({intent:'build_kit',itemTypes:['camera','lens'],...window,pickupTime:'10:00',returnTime:'17:00'},'Build a kit for 20–21 November 10am to5pm');
 assert.equal(result.cards.length,0,'do not fall back to unavailable stock while calling it an in-stock kit');
 availability=1;availabilityWithBasket=1;rows=[cam,mystery];
 result=await chat({intent:'compatibility',subject:'Mystery 50mm lens',itemTypes:['lens'],cameraModel:'Sony FX3',...window},'Will Mystery 50mm lens fit Sony FX3?');
 assert(narration.includes('COMPATIBILITY UNCONFIRMED'));
 assert(!narration.includes('is NATIVE'));
 rows=[rf,gm];
 await chat({intent:'compatibility',subject:'EF lens',itemTypes:['lens'],cameraModel:'Canon R5',...window},'Will an EF lens work with a Canon R5?');
 assert(narration.includes('Mount rules for RF: native RF; needs a suitable adapter EF;'),'RF body must not receive Sony-only hard-coded mount advice');
 for(const type of Object.keys(load('convex/lib/taxonomy.ts').CATEGORY_OF).filter(t=>!['camera-body','lens','gimbal','nd-filter','battery'].includes(t))){
   rows=[{_id:type,slug:type,title:'Owned '+type,itemType:type,pricing:{daily:10},inventoryFacts:{owned:true},components:[{inventoryUnitId:type,qty:1}]}];
   result=await chat({intent:'build_kit',itemTypes:[type],...window,pickupTime:'10:00',returnTime:'17:00'},'Build with '+type);
   assert(result.cards.some(card=>card.item.itemType===type),'Gaffer planner supports real catalogue type '+type);
 }
 for(const [mount,coverage,name,focal,extra] of [['EF','s35','Blackmagic Pocket 6K','24-70','16-35'],['RF','ff','Canon R5','24-70','15-35'],['MFT','mft','Panasonic GH5','12-35','7-14'],['E','ff','Sony A7 V','24-70','16-35']]){
   const body={...cam,_id:'body-'+mount,slug:'body-'+mount,title:name+' with '+focal+'mm lens',specs:{mount,coverage,includesLens:true,lensFocal:focal},components:[{inventoryUnitId:'body-'+mount,qty:1},{inventoryUnitId:'kit-'+mount,qty:1}],inventoryFacts:{contents:[focal+'mm lens']}};
   const bundled={...gm,_id:'lens-'+mount,slug:'lens-'+mount,title:name+' '+focal+'mm lens',specs:{mount,coverage,lensFocal:focal},components:[{inventoryUnitId:'kit-'+mount,qty:1}]};
   const useful={...bundled,_id:'extra-'+mount,slug:'extra-'+mount,title:name+' '+extra+'mm lens',specs:{mount,coverage,lensFocal:extra},components:[{inventoryUnitId:'extra-'+mount,qty:1}]};
   rows=[body,bundled,useful];result=await chat({intent:'build_kit',itemTypes:['camera','lens'],...window,pickupTime:'10:00',returnTime:'17:00'},'Build a '+name+' kit');
   assert(result.cards.some(card=>card.item.listingId===useful._id),name+' gets useful additional coverage');assert(!result.cards.some(card=>card.item.listingId===bundled._id),name+' does not duplicate its included lens');
 }
 rows=[cam,{_id:'rig',slug:'rig',title:'Monitor rig',itemType:'monitor',pricing:{daily:10},components:[...cam.components,{inventoryUnitId:'monitor',qty:1}]}];availabilityWithBasket=0;
 result=await chat({intent:'build_kit',itemTypes:['monitor'],...window,pickupTime:'10:00',returnTime:'17:00'},'Add a monitor rig',[{listingId:cam._id,...window,pickupTime:'10:00',returnTime:'17:00'}]);
 assert.equal(result.cards.length,0,'initial Gaffer answer must include existing basket demand, before the UI refresh');assert(checks.some(check=>check.items?.[0]?.listingId===cam._id));
 console.log('PASS actual Gaffer planner/narration pipeline: progressive kit contents, timed availability gate, unavailable-stock rejection, unknown fit and camera-specific mount rules. Controlled model/catalogue transport; no provider writes.');
})().catch(error=>{console.error(error);process.exitCode=1});
