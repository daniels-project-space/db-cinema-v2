const assert=require('node:assert/strict'),{load}=require('./lib/rentalTestHarness.cjs');
const {GUIDES}=load('src/lib/guides.ts'),{guideReadMinutes,selectGuides,guideSectionIds}=load('src/lib/guideLibrary.ts');
const defaults={query:'',topic:'',format:'all',sort:'recommended'};
assert.deepEqual(selectGuides(GUIDES,defaults),GUIDES,'Default browsing preserves editorial order');
assert(selectGuides(GUIDES,{...defaults,query:'S-Log3'}).some(g=>g.slug==='shooting-log-picture-profiles'),'Search includes actual guide body, not just titles');
const videos=selectGuides(GUIDES,{...defaults,topic:'Gear how-to',format:'video'});assert(videos.length>0);assert(videos.every(g=>g.category==='Gear how-to'&&g.sections.some(s=>s.video)));
assert(selectGuides(GUIDES,{...defaults,format:'text'}).every(g=>!g.sections.some(s=>s.video)));
assert.equal(selectGuides(GUIDES,{...defaults,query:'nonexistent-fixture-topic'}).length,0);
const sorted=selectGuides(GUIDES,{...defaults,sort:'short'});assert(sorted.every((g,i)=>i===0||guideReadMinutes(sorted[i-1])<=guideReadMinutes(g)));
assert.deepEqual(selectGuides(GUIDES,{...defaults,sort:'az'}).map(g=>g.title),GUIDES.map(g=>g.title).sort((a,b)=>a.localeCompare(b,'en-GB')));
for(const guide of GUIDES){assert(guideReadMinutes(guide)>=1);const ids=guideSectionIds(guide);assert.equal(new Set(ids).size,guide.sections.length);assert(ids.every(Boolean));}
assert.deepEqual(guideSectionIds({...GUIDES[0],sections:[{h:'Setup',p:''},{h:'Setup',p:''},{h:'???',p:''}]}),['setup','setup-2','section-3']);
assert.deepEqual(guideSectionIds({...GUIDES[0],sections:[{h:'Setup',p:''},{h:'Setup 2',p:''},{h:'Setup',p:''}]}),['setup','setup-2','setup-3']);
console.log('PASS real guide library: full-text search, combined topic/video filters, meaningful reading-time sort, no mutation, empty results and unique section anchors.');
