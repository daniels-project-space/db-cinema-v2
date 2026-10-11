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
 return h.put('bookings',{accountId:owner._id,status,guestEmail:'historic@example.invalid',idVerifyStatus:'verified',idVerifiedAt:now,verificationExpiresAt:now+90*day,droneLicenceStatus:'approved',returnTime:'18:00',lineItems:[{listingId:camera._id,title:camera.title,qty:2,start:now+offset*day,end:now+(offset+1)*day}],...options});
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
 const archive=h.put('verification_archives',{bookingId:licence._id,accountId:licence.accountId,sessionId:'fixture-drone',source:'drone',status:'complete'});
 const {seedVerificationFiles}=require('./lib/verificationFiles.cjs');
 const file=seedVerificationFiles(h.put,archive)[0];file.kind='drone-operator-licence';
 await h.db.patch(licence._id,{droneLicenceStatus:'approved',droneLicenceDocumentId:file._id,droneLicenceStorageId:file.storageId});photoReads.length=0;
 result=await analytics.adminSummary.handler(ctx,{token:'preview-owner',now});
 const next=result.awaitingCollection.filter(policy.dashboardVerificationPending);
 assert.deepEqual(next.slice(0,4).map(x=>x._id),pending.slice(0,4).map(x=>x._id));
 assert.equal(next[3].kit[0]?.heroImage,'https://fixture.invalid/camera.jpg');assert(next[3].customerPhoto);
 assert.equal(result.awaitingCollection.find(x=>x._id===licence._id).customerPhoto,null);assert.equal(photoReads.length,8);
 const sharedEmail='legacy-owner@example.invalid';
 const sharedAccount=h.put('accounts',{name:'Verified legacy owner',email:sharedEmail,phone:'+447700900111',createdAt:now-10*day});
 const legacyRental=(extra)=>h.put('bookings',{status:'confirmed',guestEmail:sharedEmail,idVerifyStatus:'required',lineItems:[{listingId:camera._id,title:camera.title,qty:1,start:now+5*day,end:now+6*day}],...extra});
 const recycled=legacyRental({guestName:'Previous mailbox owner',guestPhone:'+447700900222'});recycled._creationTime=now-20*day;
 const compatibleLegacy=legacyRental({guestName:sharedAccount.name,guestPhone:sharedAccount.phone,lineItems:[{listingId:camera._id,title:camera.title,qty:1,start:now+20*day,end:now+21*day}]});compatibleLegacy._creationTime=now-5*day;
 const unlinked=legacyRental({guestEmail:'unlinked-guest@example.invalid',guestName:'Unlinked guest'});unlinked._creationTime=now-3*day;
 const deletedOwner=h.put('accounts',{name:'Removed account',email:'removed@example.invalid',createdAt:now-10*day});
 const deletedOwnerRental=legacyRental({accountId:deletedOwner._id,guestEmail:deletedOwner.email,guestName:deletedOwner.name});deletedOwnerRental._creationTime=now-5*day;
 await h.db.delete(deletedOwner._id);
 result=await analytics.adminSummary.handler(ctx,{token:'preview-owner',now});
 const contact=b=>result.awaitingCollection.find(row=>row._id===b._id);
 assert.equal(contact(recycled).accountNeedsReview,true,'A current account created after an unbound rental is not treated as its owner');
 assert.equal(contact(recycled).guestEmail,'','A recycled mailbox is hidden until an admin verifies ownership');
 assert.equal(contact(recycled).customerName,'Linked account unavailable');
 assert.equal(contact(recycled).customerPhoto,null,'A recycled mailbox cannot expose the new account photo');
 assert.equal(contact(compatibleLegacy).accountNeedsReview,false,'An older exact-name/phone account retains verified legacy compatibility');
 assert.equal(contact(compatibleLegacy).guestEmail,sharedAccount.email);
 assert.equal(contact(compatibleLegacy).customerName,sharedAccount.name);
 assert.equal(contact(unlinked).accountNeedsReview,false,'A guest with no conflicting account keeps the historical booking contact');
 assert.equal(contact(unlinked).guestEmail,'unlinked-guest@example.invalid');
 assert.equal(contact(deletedOwnerRental).accountNeedsReview,true,'A deleted explicit owner remains a review case');
 assert.equal(contact(deletedOwnerRental).guestEmail,'','A deleted account does not fall back to its historical mailbox');
 console.log('PASS actual dashboard preview selection after verified records, drone approval, reactive replacement, all calendar periods/current contacts and visible-only profile URL reads. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
