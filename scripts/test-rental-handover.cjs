const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {rentalHandoverLabel,rentalClockLabel}=load('shared/rentalHandover.ts'),{groupRentalKit}=load('src/lib/rentalKit.ts');
const {LEO_SUPPORT_PHONE,TRAFALGAR_PICKUP_ADDRESS,TRAFALGAR_PICKUP_INSTRUCTIONS}=load('shared/pickupLocation.ts');
const operations=load('convex/rentalOperations.ts'),chat=load('convex/rentalChat.ts');
process.env.ADMIN_TOKEN='qa-owner';
const day=Date.UTC(2026,9,23),listing=put('listings',{title:'QA lens',itemType:'lens',components:[]});
const account=put('accounts',{email:'qa@example.invalid'});
put('sessions',{token:'qa-renter',accountId:account._id,expiresAt:Date.now()+60000});
const line=(extra={})=>({listingId:listing._id,title:'QA lens',start:day,end:day+86400000,qty:1,lineTotal:10,...extra});
const booking=put('bookings',{accountId:account._id,status:'pending_payment',lineItems:[line({pickupTime:'10:00',returnTime:'18:00'})],fulfilment:'pickup',subtotal:10,total:10,depositAmount:0});
const ctx={db};
(async()=>{
 assert.equal(rentalHandoverLabel(booking,'pickup'),'10:00','Item clocks do not disappear when global clock is absent');
 assert.equal(rentalHandoverLabel(booking,'return'),'18:00');
 const mixed={lineItems:[line({pickupTime:'10:00',returnTime:'18:00'}),line({pickupTime:'16:00',returnTime:'20:00'})],pickupTime:'09:00',returnTime:'17:00'};
 assert.equal(rentalHandoverLabel(mixed,'pickup'),'23 Oct 2026 · 10:00 / 23 Oct 2026 · 16:00','Separate intraday collections retain both windows');
 assert.equal(groupRentalKit(mixed.lineItems).length,2,'Distinct intraday hires cannot collapse into one clock/quantity row');
 assert.equal(groupRentalKit([...mixed.lineItems,line({pickupTime:'10:00',returnTime:'18:00',qty:2})])[0].qty,3,'Only genuinely matching windows combine quantities');
 const unknown={lineItems:[line({pickupTime:null,returnTime:''})],pickupTime:'09:00',returnTime:'17:00'};
 assert.equal(rentalHandoverLabel(unknown,'pickup'),'Time to confirm','Explicit unknown cannot inherit a different booking clock');assert.equal(rentalHandoverLabel(unknown,'return'),'Time to confirm');
 assert.equal(rentalHandoverLabel({lineItems:[line()],pickupTime:'00:00',returnTime:'23:30'},'pickup'),'00:00','Confirmed midnight is a real clock');
 assert.equal(rentalClockLabel('TBD'),'Time to confirm');assert.equal(rentalClockLabel('25:00'),'Time to confirm');
 assert.equal(rentalHandoverLabel({lineItems:[]},'return'),'Dates need review');
 const twoDays={lineItems:[line({pickupTime:'10:00'}),line({start:day+86400000,end:day+2*86400000,pickupTime:'10:00'})]};
 assert.equal(rentalHandoverLabel(twoDays,'pickup'),'23 Oct 2026 · 10:00 / 24 Oct 2026 · 10:00','Same clock across different dates remains distinct');
 let details=await operations.details.handler(ctx,{token:'qa-owner',bookingId:booking._id});assert.equal(rentalHandoverLabel(details,'pickup'),'10:00');
 booking.pickupTime='09:00';booking.returnTime='17:00';booking.lineItems=[line(),line({pickupTime:'16:00',returnTime:'20:00'})];
 const before=JSON.stringify(booking);
 details=await operations.details.handler(ctx,{token:'qa-owner',bookingId:booking._id});assert.deepEqual(details.lineItems.map(l=>l.pickupTime),['09:00','16:00']);
 const owner=await chat.getConversation.handler(ctx,{token:'qa-owner',admin:true,bookingId:booking._id});
 const renter=await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id});
 assert.deepEqual(owner.items.map(l=>l.returnTime),['17:00','20:00']);assert.deepEqual(renter.items.map(l=>l.pickupTime),['09:00','16:00']);assert.equal(JSON.stringify(booking),before,'Presentation cannot rewrite authoritative rental or financial data');
 assert.equal(renter.handoverDetails,null,'An unpaid, unverified booking hides the address and phone');
 booking.status='confirmed';booking.paidConfirmedAt=Date.now();booking.idVerifyStatus='required';booking.verificationExpiresAt=Date.now()+90*86400000;
 assert.equal((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails,null,'Payment and confirmation without verification are not enough');
 booking.idVerifyStatus='verified';booking.verificationProvider='didit';booking.idVerificationSource='didit';booking.idVerifiedAt=Date.now();booking.verificationChecks={identity:'approved',selfie:'approved',address:'approved'};
 booking.paidConfirmedAt=undefined;
 assert.equal((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails,null,'A fully verified confirmed booking still hides handover details until payment is confirmed');
 booking.paidConfirmedAt=Date.now();booking.status='pending_verification';
 assert.equal((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails,null,'A paid, verified booking still hides handover details until its status is confirmed or active');
 booking.status='confirmed';booking.verificationChecks.address='needs_review';
 assert.equal((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails,null,'A Didit check that needs review keeps the handover address and phone private');
 booking.verificationChecks.address='approved';
 booking.idVerifyStatus='verified';booking.verificationProvider='didit';booking.idVerificationSource='didit';booking.idVerifiedAt=Date.now()-100*86400000;booking.verificationExpiresAt=Date.now()-10*86400000;booking.verificationChecks={identity:'approved',selfie:'approved',address:'approved'};
 assert.notEqual((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails,null,'A booking retains its own passed Didit result after the separate account reuse badge expires');
 booking.idVerificationSource=undefined;
 assert.equal((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails,null,'A verified status without booking-level Didit provenance does not expose handover details');
 booking.idVerificationSource='didit';
 const handover=(await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:booking._id})).handoverDetails;
 assert.equal(handover.phone,LEO_SUPPORT_PHONE);assert.equal(handover.pickupAddress,TRAFALGAR_PICKUP_ADDRESS);assert.equal(handover.returnAddress,TRAFALGAR_PICKUP_ADDRESS);assert.equal(handover.pickupInstructions,TRAFALGAR_PICKUP_INSTRUCTIONS,'Paid, confirmed rentals with a booking-level Didit pass expose the agreed collection point and instructions');
 assert.equal(await operations.details.handler(ctx,{token:'foreign',bookingId:booking._id}),null);
 const handoverMessage=put('messages',{accountId:account._id,bookingId:booking._id,sender:'renter',text:'Please change the return time'});
 const openHandoverRequest=put('rental_change_requests',{requestId:'renter-handover-guard-001',accountId:account._id,bookingId:booking._id,kind:'handover',detail:'Please move the return to 19:00',messageId:handoverMessage._id,createdAt:Date.now(),requestedHandover:{lineIndexes:[0],kind:'return',time:'19:00'},requestedSnapshot:'fixture-snapshot',status:'pending'});
 const bookingBeforeDirectTimeGuards=JSON.stringify(booking);
 const directTimeChanges=[
  ['legacy pickup-time mutation',()=>operations.changePickupTime.handler(ctx,{token:'qa-owner',bookingId:booking._id,requestId:'fixture-legacy-direct-time-001',lineIndex:0,pickupTime:'11:00',expectedSnapshot:'fixture-snapshot',reason:'Legacy direct change test'})],
  ['direct pickup/return-time mutation',()=>operations.changeHandoverTimes.handler(ctx,{token:'qa-owner',bookingId:booking._id,requestId:'fixture-direct-handover-time-001',lineIndexes:[0],kind:'return',time:'20:00',expectedSnapshot:'fixture-snapshot',reason:'Direct change test'})],
 ];
 for(const state of [
  {status:'pending'},
  {status:'approved'},
  {status:'approved',execution:{operation:'handover',operationKey:'fixture-key',status:'processing',startedAt:Date.now()}},
 ]){
  await db.patch(openHandoverRequest._id,state);
  for(const [label,attempt] of directTimeChanges)await assert.rejects(attempt(),/A renter request is still awaiting a decision or completion/,`${label} must wait while a handover request is ${state.status}${state.execution?' processing':''}`);
 }
 assert.equal(JSON.stringify(booking),bookingBeforeDirectTimeGuards,'Blocked direct time changes leave the booking unchanged');
 console.log('PASS actual owner/renter clock projections and handover UI values: per-item overrides, mixed dates/intraday hires, explicit unknowns, genuine midnight, quantity grouping and immutable booking/charges. No live writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
