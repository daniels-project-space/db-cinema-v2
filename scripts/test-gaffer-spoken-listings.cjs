const assert=require('node:assert/strict');const {load}=require('./lib/rentalTestHarness.cjs');
const {isSignOff}=load('src/components/gaffer/callContext.ts');
for(const s of ["okay thx that's all","ok thanks thats all","thanks that's everything","thank you that's it","cool nothing else","all done cheers","you can hang up","end the call","that's all I need","okay bye"] )assert(isSignOff(s),s);
for(const s of ["thanks","okay thanks","thanks, what about Friday?","that's all I need to know about the deposit, but is the FX3 free?","okay thanks that's all for the camera, can I add a light?","no more questions about the dates but how much is the deposit?"])assert(!isSignOff(s),s);
const {listingMentions,createSpokenListingTracker}=load('src/components/gaffer/spokenListings.ts');
const rows=[{_id:'fx3',title:'Sony FX3 camera'},{_id:'bundle',title:'Sony fx 3 fx3 full frame + 24-70 GM lens'},{_id:'fx30',title:'Sony FX30 camera'},{_id:'bm',title:'Blackmagic 6k pro V mount rig'}];
assert.deepEqual(listingMentions('Sony FX3 or the FX30, then Blackmagic 6k pro.',rows).map(m=>m.id),['fx3','fx30','bm']);
assert.equal(listingMentions('FX3',rows,['bundle'])[0].id,'bundle');assert.equal(listingMentions('Sony cameras are great',rows).length,0);
let now=1000,serial=0;const jobs=new Map(),seen=[];const clock={now:()=>now,set:(fn,ms)=>{const id=++serial;jobs.set(id,{fn,at:now+ms});return id},clear:id=>jobs.delete(id)};
const tracker=createSpokenListingTracker(id=>seen.push(id),clock);function alignment(text){return {chars:[...text],char_start_times_ms:[...text].map((_,i)=>i*30),char_durations_ms:[...text].map(()=>30)}}
tracker.alignment(alignment('FX3 then FX30'),rows);assert.equal(jobs.size,2);const ordered=[...jobs.values()].sort((a,b)=>a.at-b.at);assert(ordered[1].at>ordered[0].at);ordered.forEach(j=>{now=j.at;for(const [id,job] of jobs)if(job===j)jobs.delete(id);j.fn()});assert.deepEqual(seen,['fx3','fx30']);
tracker.reset();tracker.alignment(alignment('FX'),rows);tracker.alignment(alignment('3 then FX30'),rows);assert.equal(jobs.size,2,'a name split across audio chunks is resolved');tracker.reset();assert.equal(jobs.size,0,'interruption clears all queued focus changes');
tracker.alignment({chars:['F'],char_start_times_ms:[NaN],char_durations_ms:[20]},rows);assert.equal(jobs.size,0,'invalid provider timing cannot schedule stale focus');
console.log('PASS Gaffer: early complete sign-offs, mid-question safety, exact catalog mentions, sequential provider timing, split audio chunks and interruption cancellation.');
