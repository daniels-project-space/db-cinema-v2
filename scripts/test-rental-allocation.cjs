const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='allocation-owner';const operations=h.load('convex/rentalOperations.ts'),guard=h.load('convex/lib/rentalAllocation.ts');
const jobs=[],ctx={db:h.db,scheduler:{runAfter:async(...a)=>jobs.push(a)}};
const owner=h.put('accounts',{email:'new-owner@qa.invalid'}),other=h.put('accounts',{email:'old-owner@qa.invalid'});
const start=Date.UTC(2030,9,1),end=start+86400000,day=86400000;
function fixture(){
 const u=h.put('inventory_units',{name:'Camera',quantityOwned:8}),v=h.put('inventory_units',{name:'Battery',quantityOwned:8});
 const kit=h.put('listings',{title:'Camera kit',active:true,depositAmount:10,components:[{inventoryUnitId:u._id,qty:1},{inventoryUnitId:v._id,qty:2}]});
 const lens=h.put('listings',{title:'Lens',active:true,depositAmount:10,components:[{inventoryUnitId:v._id,qty:1}]});
 const lines=[{listingId:kit._id,title:kit.title,start,end,qty:2,lineTotal:30},{listingId:lens._id,title:lens.title,start:start+2*day,end:end+2*day,qty:1,lineTotal:10}];
 const b=h.put('bookings',{accountId:owner._id,guestEmail:other.email,status:'confirmed',lineItems:lines,total:50,subtotal:40,depositAmount:10});
 const reservations=[];for(const line of lines)for(const c of (line.listingId===kit._id?kit:lens).components)reservations.push(h.put('reservations',{bookingId:b._id,listingId:line.listingId,inventoryUnitId:c.inventoryUnitId,start:line.start,end:line.end,qty:c.qty*line.qty,status:'confirmed',source:'site'}));
 return {u,v,kit,lens,b,reservations};
}
const reschedule=x=>operations.reschedule.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:x.b._id,start:start+10*day,reason:'Agreed later collection'});
const removal=x=>operations.removeItem.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:x.b._id,requestId:'remove-'+x.b._id+'-000001',lineIndex:0,listingId:x.kit._id,expectedQty:2,expectedStart:start,expectedEnd:end,reason:'Requested camera removal'});
const snapshot=x=>JSON.stringify({b:x.b,reservations:x.reservations,jobs:jobs.length,messages:(h.tables.get('messages')??[]).length});
(async()=>{
 for(const change of [x=>x.kit.components[0].inventoryUnitId=x.v._id,x=>x.kit.components[1].qty=1,x=>x.reservations[0].qty=1,x=>x.reservations[0].end+=day,x=>x.reservations[0].listingId=x.lens._id,x=>x.reservations[0].status='cancelled',x=>{x.kit.components=[]},x=>x.kit.components[0].qty=0,x=>x.reservations[0].qty=NaN]){
   for(const run of [reschedule,removal]){const x=fixture();change(x);const before=snapshot(x);await assert.rejects(run(x),/mapping.*(changed|team check)/);assert.equal(snapshot(x),before,'Mismatch never edits kit, dates, stock, messages or lifecycle jobs')}
 }
 for(const run of [reschedule,removal]){const x=fixture();h.put('reservations',{...x.reservations[0],_id:undefined,status:'hold'});const before=snapshot(x);await assert.rejects(run(x),/stock hold/);assert.equal(snapshot(x),before)}
 const external=fixture();external.reservations[0].source='hygglo';await assert.rejects(reschedule(external),/original booking platform/);
 const missing=fixture();for(const r of missing.reservations)r.status='cancelled';await assert.rejects(reschedule(missing),/mapping changed/);
 const split=fixture();const r=split.reservations[0];r.qty=1;h.put('reservations',{...r,_id:undefined,qty:1});await guard.assertRentalAllocation(ctx,split.b,await h.db.query('reservations').withIndex('by_booking',q=>q.eq('bookingId',split.b._id)).collect());
 const valid=fixture(),original=valid.b.lineItems.map(l=>({...l}));await assert.rejects(operations.reschedule.handler(ctx,{token:'renter',bookingId:valid.b._id,start:start+10*day,reason:'Not authorized'}),/unauthorized/);await reschedule(valid);
 assert.deepEqual(valid.b.lineItems.map(l=>[l.start,l.end,l.qty]),original.map(l=>[l.start+10*day,l.end+10*day,l.qty]));assert.equal(valid.b.total,50);await guard.assertRentalAllocation(ctx,valid.b,await h.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",valid.b._id)).collect());
 const timed=fixture(),window=h.load('shared/rentalWindow.ts').rentalWindow;
 for(const line of timed.b.lineItems){line.pickupTime='10:00';line.returnTime='18:00';}
 for(const row of timed.reservations){const line=timed.b.lineItems.find(l=>l.listingId===row.listingId);Object.assign(row,window(line));}
 await operations.reschedule.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:timed.b._id,start:Date.UTC(2030,9,28),reason:'Collection moved across London clock change'});
 const moved=await h.db.query('reservations').withIndex('by_booking',q=>q.eq('bookingId',timed.b._id)).collect();await guard.assertRentalAllocation(ctx,timed.b,moved);
 assert.equal(moved.find(r=>r.status==='confirmed').start,Date.parse('2030-10-28T10:00:00Z'),'Admin reschedule reinterprets civil clocks across DST rather than adding fixed 24-hour offsets');
 const thread=(h.tables.get('chat_threads')??[]).find(t=>t.bookingId===valid.b._id);assert.equal(thread.accountId,owner._id,'Changed email does not transfer permanent rental ownership');
 const remove=fixture();await removal(remove);assert.equal(remove.b.lineItems.length,1);assert.equal(remove.b.total,50);const remaining=await h.db.query('reservations').withIndex('by_booking',q=>q.eq('bookingId',remove.b._id)).collect();await guard.assertRentalAllocation(ctx,remove.b,remaining);assert.equal((h.tables.get('chat_threads')??[]).find(t=>t.bookingId===remove.b._id).accountId,owner._id);await removal(remove);assert.equal(remove.b.removedItems.length,1);
 const conflict=fixture();h.put('reservations',{bookingId:'another-rental',inventoryUnitId:conflict.u._id,start:start+10*day,end:end+10*day,qty:8,status:'confirmed',source:'site'});const before=snapshot(conflict);await assert.rejects(reschedule(conflict),/already reserved/);assert.equal(snapshot(conflict),before);

 const mail=[];h.setMock('./lib/mailer',{sendMail:async message=>mail.push(message),OWNER_EMAIL:'owner@qa.invalid'});const notify=h.load('convex/notify.ts');const emailCtx={...ctx,runQuery:async(ref,a)=>{assert.equal(ref,'rentalOperations.changeRecipient');return operations.changeRecipient.handler(ctx,a)}};
 await notify.changeEmail.handler(emailCtx,{bookingId:valid.b._id,kind:'rescheduled',detail:'<script>unsafe</script>'});assert.equal(mail[0].to,owner.email);assert(mail[0].html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert(!mail[0].html.includes('<script>'));assert(mail[0].html.includes(`/account?rental=${valid.b._id}#chat`));
 const absent=fixture();absent.b.accountId='deleted-account';await notify.changeEmail.handler(emailCtx,{bookingId:absent.b._id,kind:'kit updated'});assert.equal(mail.length,1,'Missing permanent owner cannot fall back to another account mailbox');
 const legacy=fixture();legacy.b.accountId=undefined;await notify.changeEmail.handler(emailCtx,{bookingId:legacy.b._id,kind:'kit updated'});assert.equal(mail[1].to,other.email,'Legacy booking keeps compatible email ownership');
 console.log('PASS actual reschedule/removal/allocation handlers: changed kit mappings, quantities, periods, listing identity, missing/invalid and unresolved holds preserve original state; split equivalent reservations accepted; exact mixed-period kit moves, unchanged charges, permanent account chat linking, removal retry and occupied-date rejection. Synthetic database; no provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
