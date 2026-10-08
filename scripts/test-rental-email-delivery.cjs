/** Actual event queue, lease and delivery handlers; transport is controlled, no customer sends. */
const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
let now=Date.UTC(2030,0,1),mailResult=true,mailThrows=false;Date.now=()=>now;
const mails=[];h.setMock('./lib/mailer',{sendMail:async m=>{mails.push(m);if(mailThrows)throw Error('SMTP down');return mailResult},OWNER_EMAIL:()=> 'owner@example.invalid'});
const queue=h.load('convex/lib/rentalEmailQueue.ts'),delivery=h.load('convex/rentalEmailDelivery.ts'),worker=h.load('convex/rentalEmailMail.ts'),notify=h.load('convex/notify.ts'),invoice=h.load('convex/invoice.ts'),bookings=h.load('convex/bookings.ts');
const stored=new Map();let storageSerial=0;const scheduled=[],ctx={db:h.db,storage:{store:async blob=>{const id="_storage-"+(++storageSerial);stored.set(id,blob);return id},get:async id=>stored.get(id)??null,delete:async id=>stored.delete(id)},scheduler:{runAfter:async(ms,ref,args)=>{scheduled.push({ms,ref,args})}},runQuery:async(ref,a)=>{
 if(ref==='rentalEmailDelivery.ready')return delivery.ready.handler(ctx,a);
 if(ref==='bookings.get')return bookings.get.handler(ctx,a);
 if(ref==='bookings.receiptContext')return bookings.receiptContext.handler(ctx,a);
 throw Error('Unexpected query '+ref);
},runMutation:async(ref,a)=>{if(ref==='rentalEmailDelivery.prepare')return delivery.prepare.handler(ctx,a);assert.equal(ref,'rentalEmailDelivery.finish');return delivery.finish.handler(ctx,a)},runAction:async(ref,a)=>{
 const [group,name]=ref.split('.');return ({notify,invoice})[group][name].handler(ctx,a);
}};
const account=h.put('accounts',{email:'permanent@example.invalid'});
const b=h.put('bookings',{accountId:account._id,guestEmail:'reused@example.invalid',status:'confirmed',idVerifyStatus:'requires_input',stripePaymentIntentId:'pi_synthetic',subtotal:20,discount:0,total:25,depositAmount:5,depositHoldAmount:10,lineItems:[{title:'Cinema lens',lineTotal:20,start:now,end:now+86400000}]});
const get=id=>h.docs.get(id);
async function dispatch(id){await delivery.dispatchOne.handler(ctx,{deliveryId:id});return scheduled.at(-1).args}
(async()=>{
 const id=await queue.queueRentalEmail(ctx,b._id,'payment');assert.equal(await queue.queueRentalEmail(ctx,b._id,'payment'),id,'Paid webhook replay has one durable financial notice');
 const a=await dispatch(id);assert.equal(get(id).attempts,1);const count=scheduled.length;await delivery.dispatchOne.handler(ctx,{deliveryId:id});assert.equal(scheduled.length,count,'Concurrent dispatch cannot claim an active lease');
 mailResult=false;await worker.deliver.handler(ctx,a);assert.equal(get(id).state,'pending','False transport result must remain retryable');assert.equal(get(id).dueAt,now+60000);assert.equal(mails[0].to,account.email,'Permanent owner receives notice, not recycled guest mailbox');assert.equal(mails[0].deliveryKey,get(id).key);
 const originalPayload=mails[0].html;b.total=999;
 now+=60000;const retry=await dispatch(id);mailResult=true;await worker.deliver.handler(ctx,retry);assert.equal(get(id).state,'sent');assert.equal(get(id).sentAt,now);assert.equal(mails[1].html,originalPayload,'Changed booking cannot alter the prepared retry payload');b.total=25;assert.equal(mails[1].deliveryKey,mails[0].deliveryKey,'Provider idempotency key is stable across retries');const sent=mails.length;await worker.deliver.handler(ctx,retry);assert.equal(mails.length,sent,'Finished lease cannot send again');
 const receipt=await queue.queueRentalEmail(ctx,b._id,'receipt'),first=await dispatch(receipt);now+=10*60000;const takeover=await dispatch(receipt);assert.equal(takeover.generation,first.generation+1,'Expired action recovers under new lease');assert.equal(await delivery.finish.handler(ctx,{...first,result:'sent'}),false,'Stale completion cannot overwrite newer attempt');mailThrows=true;await worker.deliver.handler(ctx,takeover);assert.equal(get(receipt).state,'pending');mailThrows=false;
 const v1=await queue.queueRentalEmail(ctx,b._id,'verification',{verificationStatus:'requires_input'}),old=await dispatch(v1);b.idVerifyStatus='verified';const v2=await queue.queueRentalEmail(ctx,b._id,'verification',{verificationStatus:'verified'});assert.equal(get(v1).state,'skipped');const before=mails.length;await worker.deliver.handler(ctx,old);assert.equal(mails.length,before,'Superseded retry cannot send stale document request');const verified=await dispatch(v2);await worker.deliver.handler(ctx,verified);assert.equal(get(v2).state,'sent');assert.match(mails.at(-1).html,/remaining document checks and approval/);
 b.idVerifyStatus='requires_input';const v3=await queue.queueRentalEmail(ctx,b._id,'verification',{verificationStatus:'requires_input'});assert.notEqual(v3,v1,'A later genuine transition back to status creates new notice');assert.equal(get(v3).sequence,3);b.status='cancelled';await delivery.dispatchOne.handler(ctx,{deliveryId:v3});assert.equal(get(v3).state,'skipped','Cancelled rental does not get verification prompts');
 const c=await queue.queueRentalEmail(ctx,b._id,'cancellation',{mode:'refund',refundAmount:25,creditAmount:0});await worker.deliver.handler(ctx,await dispatch(c));assert.equal(get(c).state,'sent');assert.match(mails.at(-1).html,/Refund to original payment method/);assert.equal(await queue.queueRentalEmail(ctx,b._id,'cancellation',{mode:'refund',refundAmount:25,creditAmount:0}),c);
 // Retry budget is finite, failed state stays persisted rather than a false success.
 b.status='confirmed';const failure=await queue.queueRentalEmail(ctx,b._id,'verification',{verificationStatus:'requires_input'});mailResult=false;
 for(let n=1;n<=8;n++){now=get(failure).dueAt;const args=await dispatch(failure);await worker.deliver.handler(ctx,args);assert.equal(get(failure).attempts,n)}assert.equal(get(failure).state,'failed');assert.equal(get(failure).sentAt,undefined);assert.match(get(failure).lastError,/requires support/);assert(h.tables.get("admin_notifications").some(n=>n.bookingId===b._id&&n.kind==="email_failure"),"Exhausted email creates an actionable admin bell alert");mailResult=true;
 // Actual paid callback writes both notices in its transaction; replay adds neither.
 const paid=h.put('bookings',{accountId:account._id,guestEmail:account.email,status:'pending_payment',lineItems:[],fulfilment:'pickup',subtotal:20,total:25,depositAmount:5,currency:'GBP'});
 await bookings.confirm.handler(ctx,{bookingId:paid._id,paymentIntentId:'pi_controlled_paid'});
 let financial=h.tables.get('rental_email_deliveries').filter(x=>x.bookingId===paid._id);assert.deepEqual(financial.map(x=>x.kind),['payment','receipt']);
 await bookings.confirm.handler(ctx,{bookingId:paid._id,paymentIntentId:'pi_controlled_paid'});assert.equal(h.tables.get('rental_email_deliveries').filter(x=>x.bookingId===paid._id).length,2);
 paid.status='cancelled';for(const row of financial)await h.db.patch(row._id,{state:'skipped'});
 // A crash after the final claim is also terminal after lease expiry.
 const crash=await queue.queueRentalEmail(ctx,b._id,'verification',{verificationStatus:'requires_input'});await h.db.patch(crash,{attempts:7});await dispatch(crash);now=get(crash).dueAt;await delivery.dispatchOne.handler(ctx,{deliveryId:crash});assert.equal(get(crash).state,'failed');
 // Real verification writer persists an event atomically, and duplicate state does not enqueue.
 await bookings.setIdentity.handler(ctx,{bookingId:b._id,status:"canceled"});
 let notices=h.tables.get("rental_email_deliveries").filter(x=>x.bookingId===b._id&&x.kind==="verification");const length=notices.length;assert.equal(notices.at(-1).verificationStatus,"canceled");
 await bookings.setIdentity.handler(ctx,{bookingId:b._id,status:"canceled"});assert.equal(h.tables.get("rental_email_deliveries").filter(x=>x.bookingId===b._id&&x.kind==="verification").length,length);
 b.status="cancelled";await delivery.dispatchOne.handler(ctx,{deliveryId:notices.at(-1)._id});b.status="confirmed";
 // Due index is moved past the lease; a burst of in-flight rows cannot starve new work.
 await h.db.patch(receipt,{dueAt:now+86400000});
 const pending=[];for(let n=0;n<25;n++){const booking=h.put('bookings',{...b,_id:'bookings-burst-'+n});pending.push(await queue.queueRentalEmail(ctx,booking._id,'payment'))}
 const one=await delivery.dispatchDue.handler(ctx,{});assert.equal(one.dispatched,20);const two=await delivery.dispatchDue.handler(ctx,{});assert.equal(two.dispatched,5);assert.equal(pending.filter(id=>get(id).state==='sending').length,25);
 const deleted=await queue.queueRentalEmail(ctx,b._id,'receipt');assert.equal(deleted,receipt);await h.db.delete(account._id);now=get(receipt).dueAt;await delivery.dispatchOne.handler(ctx,{deliveryId:receipt});assert.equal(get(receipt).state,'skipped','Removed permanent account cannot redirect mail to guest mailbox');
 console.log('PASS durable booking notices: false/throw recovery, real mail actions, recipient binding, provider key, dedup, crash leases, stale generations, status supersession, cancellation, bounded retries and non-starving batches. No customer SMTP or payments.');
})().catch(e=>{console.error(e);process.exitCode=1});
