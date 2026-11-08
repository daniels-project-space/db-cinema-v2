const assert=require('node:assert/strict'),{load,db,put}=require('./lib/rentalTestHarness.cjs');
const archives=load('convex/verificationArchive.ts'),queued=[];
const ctx={db,scheduler:{runAfter:async(_delay,ref,args)=>{assert.equal(ref,'verificationArchive.backfillRetentionLinks');queued.push(args)}}};
const owner=put('accounts',{email:'owner@example.invalid'}),other=put('accounts',{email:'other@example.invalid'});
const source=put('bookings',{accountId:owner._id,status:'returned'});put('verification_archives',{bookingId:source._id,status:'complete',sessionId:'fixture',attempts:0,dueAt:0,createdAt:Date.now()});
const targets=[];for(let index=0;index<70;index++)targets.push(put('bookings',{accountId:owner._id,status:'confirmed',verificationReusedFrom:source._id}));
const foreign=put('bookings',{accountId:other._id,status:'confirmed',verificationReusedFrom:source._id});
const missing=put('bookings',{accountId:owner._id,status:'confirmed',verificationReusedFrom:'bookings-missing'});
(async()=>{
 const first=await archives.backfillRetentionLinks.handler(ctx,{cursor:null});assert(first.hasMore);assert(first.linked<=50);const replay=await archives.backfillRetentionLinks.handler(ctx,{cursor:null});assert(replay.hasMore);
 while(queued.length)await archives.backfillRetentionLinks.handler(ctx,queued.shift());
 const links=await db.query('verification_archive_links').collect();assert.equal(links.length,70);assert.equal(new Set(links.map(row=>row.bookingId)).size,70);assert(!links.some(row=>row.bookingId===foreign._id||row.bookingId===missing._id));
 assert(targets.every(booking=>booking.status==='confirmed'&&booking.verificationReusedFrom===source._id),'Backfill never changes verification or booking state');
 console.log('PASS retention-link backfill: bounded pages, safe replay, account/source checks and no booking changes; synthetic data only.');
})().catch(error=>{console.error(error);process.exitCode=1});
