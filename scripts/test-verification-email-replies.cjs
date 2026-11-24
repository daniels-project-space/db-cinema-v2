const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
process.env.INBOUND_EMAIL_SECRET='fixture-secret';process.env.INBOUND_REPLY_ADDRESS='replies@example.invalid';process.env.RESEND_API_KEY='fixture';process.env.RESEND_FROM='DB Cinema <bookings@dbcinemarentals.com>';
const inbox=h.load('convex/emailInbox.ts'),sent=[],scheduled=[];
const ctx={db:h.db,scheduler:{runAfter:async(...args)=>scheduled.push(args)},runMutation:async(ref,args)=>inbox[ref.split('.')[1]].handler(ctx,args),runAction:async(ref,args)=>{assert.equal(ref,'emailMailer.sendBusinessReply');sent.push(args);return {sent:true,messageId:'<reply-fixture@example.invalid>'}}};
(async()=>{
 const account=h.put('accounts',{email:'renter@example.invalid',emailVerificationRequired:true});
 const booking=h.put('bookings',{accountId:account._id,guestEmail:account.email,status:'pending_verification'});
 const subject=`Payment received — complete your rental checks · DBC-${String(booking._id).slice(-8).toUpperCase()}`;
 async function notice(kind){
  const delivery=h.put('rental_email_deliveries',{bookingId:booking._id,kind,state:'sending',generation:1,recipientEmail:account.email,dueAt:Date.now()+60000});
  const prepared=await inbox.prepareRentalEmailThread.handler(ctx,{deliveryId:delivery._id,generation:1,recipientEmail:account.email,subject,text:'Payment was received. Your private link is omitted.'});
  assert.equal(prepared.ok,true);assert.equal(await inbox.finishRentalEmailThread.handler(ctx,{deliveryId:delivery._id,generation:1,result:'sent',resendEmailId:`resend-${delivery._id}`}),true);
  delivery.state='sent';delivery.sentAt=Date.now();return {delivery,prepared};
 }
 const first=await notice('paid_verification');const out=h.tables.get('email_messages');const thread=h.docs.get(out[0].threadId);
 assert.equal(thread.accountId,undefined,'Payment alone does not verify ownership');assert(!out[0].text.includes('#'));
 const inboundArgs={secret:'fixture-secret',providerId:'private-inbound',from:account.email,to:first.prepared.replyTo,subject:`Re: ${subject}`,text:'Could you help with verification?',references:[],replyThreadId:thread._id,replyCapabilityKey:thread.replyKey};
 const incoming=await inbox.ingest.handler(ctx,inboundArgs);assert.equal(incoming.threadId,thread._id,'The capability and exact subject reference route to the rental thread');assert.equal(incoming.accountId,null);assert.equal(incoming.bookingId,null,'An unverified email cannot claim rental data');
 const claimed=await inbox.claimInbound.handler(ctx,{secret:'fixture-secret',inboundId:incoming.inboundId,humanRequested:false});assert.equal(claimed.state,'claimed');assert.equal(claimed.rentalContext,null,'Unverified email gets no private booking context');
 const reply=await inbox.sendAssistantReply.handler(ctx,{secret:'fixture-secret',threadId:thread._id,inboundId:incoming.inboundId,text:'Please open your verification link.',humanRequested:false});assert.equal(reply.ok,true);assert.equal(sent.length,1);assert.equal(sent[0].replyTo,first.prepared.replyTo);
 assert.equal((await inbox.sendAssistantReply.handler(ctx,{secret:'fixture-secret',threadId:thread._id,inboundId:incoming.inboundId,text:'Duplicate',humanRequested:false})).duplicate,true);
 const reminder=await notice('verification_reminder');assert.equal(reminder.prepared.replyTo,first.prepared.replyTo);assert.equal(h.tables.get('email_threads').length,1,'One rental uses one unambiguous thread');
 const forged=await inbox.ingest.handler(ctx,{...inboundArgs,providerId:'forged',replyCapabilityKey:'0'.repeat(24)});assert.notEqual(forged.threadId,thread._id,'A wrong reply capability cannot access the rental thread');
 const wrongReference=await inbox.ingest.handler(ctx,{...inboundArgs,providerId:'wrong-reference',subject:'Re: DBC-ABCDEFGH'});assert.notEqual(wrongReference.threadId,thread._id);
 const direct=await inbox.ingest.handler(ctx,{secret:'fixture-secret',providerId:'legacy-direct',from:account.email,to:'replies@example.invalid',subject:`Re: ${subject}`,text:'A legacy reply',references:[]});assert.notEqual(direct.threadId,thread._id,'A legacy reply without a capability cannot inherit private rental history');assert.equal(direct.bookingId,null);
 thread.status='human_requested';const human=await inbox.ingest.handler(ctx,{...inboundArgs,providerId:'human-followup'});assert.equal((await inbox.claimInbound.handler(ctx,{secret:'fixture-secret',inboundId:human.inboundId,humanRequested:false})).state,'human_waiting');assert.equal(h.docs.get(human.inboundId).state,'handoff');assert((h.tables.get('admin_notifications')??[]).some(row=>row.emailThreadId===thread._id));
 const before=h.tables.get('email_messages').length;assert.equal(await inbox.recordVerificationNotice.handler(ctx,{deliveryId:first.delivery._id,subject}),true);assert.equal(h.tables.get('email_messages').length,before,'A delayed legacy mirror cannot duplicate a central outbox record');
 const legacy=h.put('rental_email_deliveries',{bookingId:booking._id,kind:'paid_verification',state:'sent',recipientEmail:account.email,sentAt:Date.now()-1000});assert.equal(await inbox.recordVerificationNotice.handler(ctx,{deliveryId:legacy._id,subject}),true);assert.equal(await inbox.recordVerificationNotice.handler(ctx,{deliveryId:legacy._id,subject}),true);assert.equal(h.tables.get('email_messages').filter(row=>row.providerId===`rental-notice:${legacy._id}`).length,1,'Already scheduled legacy mirrors remain idempotent');
 console.log('PASS verification email: private capability threading, unverified ownership, human handoff, reminders and legacy mirror compatibility.');
})().catch(error=>{console.error(error);process.exitCode=1});
