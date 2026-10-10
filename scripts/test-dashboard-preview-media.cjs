const assert=require('node:assert/strict');
const h=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='preview-owner';
const analytics=h.load('convex/analytics.ts');
const policy=h.load('shared/dashboardPreviews.ts');
const now=Date.UTC(2030,0,1),day=86400000;
const camera=h.put('listings',{title:'Sony FX3',itemType:'camera',r2Images:['https://fixture.invalid/camera.jpg']});
const drone=h.put('listings',{title:'DJI Mavic 3',itemType:'drone',r2Images:['https://fixture.invalid/drone.jpg']});
function rental(status,offset,options={}){
 const owner=h.put('accounts',{name:'Owner '+offset,email:`owner-${offset}@example.invalid`,avatarStorageId:'photo-'+offset});
 return h.put('bookings',{accountId:owner._id,status,guestEmail:'historic@example.invalid',idVerifyStatus:'verified',droneLicenceStatus:'approved',returnTime:'18:00',lineItems:[{listingId:camera._id,title:camera.title,qty:2,start:now+offset*day,end:now+(offset+1)*day}],...options});
}
const active=Array.from({length:7},(_,i)=>rental('active',i));
const verified=Array.from({length:10},(_,i)=>rental('confirmed',20+i));
const pending=Array.from({length:6},(_,i)=>rental('confirmed',40+i,{idVerifyStatus:'required'}));
const licence=rental('confirmed',39,{droneLicenceStatus:'pending',lineItems:[{listingId:drone._id,title:drone.title,qty:1,start:now+39*day,end:now+40*day}]});
const photoReads=[];
const ctx={db:h.db,storage:{getUrl:async id=>{photoReads.push(id);return 'https://fixture.invalid/'+id+'.jpg';}}};
(async()=>{
 assert.deepEqual(await analytics.adminSummary.handler(ctx,{token:'denied',now}),{authorized:false});assert.equal(photoReads.length,0);
 let result=await analytics.adminSummary.handler(ctx,{token:'preview-owner',now});
 const waiting=result.awaitingCollection.filter(policy.dashboardVerificationPending);
 assert.equal(result.ongoing.length,7);assert.equal(result.awaitingCollection.length,17);assert.equal(result.itemsOut,14);
 assert.deepEqual(waiting.map(x=>x._id),[licence._id,...pending.map(x=>x._id)],'A verified drone still needs its licence; cameras do not inherit drone requirements');
 assert.equal(waiting[0].kit[0]?.heroImage,'https://fixture.invalid/drone.jpg','Late pending drone has its actual aircraft image');
 for(const row of waiting.slice(1,policy.DASHBOARD_PREVIEW_COUNT))assert.equal(row.kit[0]?.heroImage,'https://fixture.invalid/camera.jpg','Pending cards retain equipment after ten earlier verified confirmations');
 const shown=new Set([...active.slice(0,4).map(x=>x._id),...waiting.slice(0,4).map(x=>x._id)]);
 assert.equal(shown.size,8);assert.equal(photoReads.length,8,'Only the displayed eight cards resolve storage URLs');
 for(const row of [...result.ongoing,...result.awaitingCollection]){
  assert.equal(row.calendarLines.length,1,'Full calendar periods are retained regardless of image selection');
  assert.equal(row.guestEmail,(await h.db.get((await h.db.get(row._id)).accountId)).email,'Current owner contact remains available for every calendar entry');
  if(shown.has(row._id)){assert(row.kit.length);assert(row.customerPhoto);}else{assert.deepEqual(row.kit,[]);assert.equal(row.customerPhoto,null);}
 }
 // Approval changes which records are shown; the newly revealed fourth card must hydrate.
 await h.db.patch(licence._id,{droneLicenceStatus:'approved'});photoReads.length=0;
 result=await analytics.adminSummary.handler(ctx,{token:'preview-owner',now});
 const next=result.awaitingCollection.filter(policy.dashboardVerificationPending);
 assert.deepEqual(next.slice(0,4).map(x=>x._id),pending.slice(0,4).map(x=>x._id));
 assert.equal(next[3].kit[0]?.heroImage,'https://fixture.invalid/camera.jpg');assert(next[3].customerPhoto);
 assert.equal(result.awaitingCollection.find(x=>x._id===licence._id).customerPhoto,null);assert.equal(photoReads.length,8);
 console.log('PASS actual dashboard preview selection after verified records, drone approval, reactive replacement, all calendar periods/current contacts and visible-only profile URL reads. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
