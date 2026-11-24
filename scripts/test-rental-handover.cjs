const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {rentalHandoverLabel,rentalClockLabel}=load('shared/rentalHandover.ts'),{groupRentalKit}=load('src/lib/rentalKit.ts');
const {LEO_SUPPORT_PHONE,TRAFALGAR_PICKUP_ADDRESS,TRAFALGAR_PICKUP_INSTRUCTIONS}=load('shared/pickupLocation.ts');
const operations=load('convex/rentalOperations.ts'),chat=load('convex/rentalChat.ts'),accounts=load('convex/accounts.ts');
process.env.ADMIN_TOKEN='qa-owner';
const day=Date.UTC(2026,9,23),listing=put('listings',{title:'QA lens',itemType:'lens',components:[]});
const account=put('accounts',{email:'qa@example.invalid'});
put('sessions',{token:'qa-renter',accountId:account._id,expiresAt:Date.now()+60000});
const stranger=put('accounts',{email:'other@example.invalid'});
put('sessions',{token:'qa-stranger',accountId:stranger._id,expiresAt:Date.now()+60000});
const line=(extra={})=>({listingId:listing._id,title:'QA lens',start:day,end:day+86400000,qty:1,lineTotal:10,...extra});
const booking=put('bookings',{accountId:account._id,status:'pending_payment',lineItems:[line({pickupTime:'10:00',returnTime:'18:00'})],fulfilment:'pickup',subtotal:10,total:10,depositAmount:0});
const deliveryBooking=put('bookings',{accountId:account._id,guestEmail:account.email,status:'pending_payment',lineItems:[line()],fulfilment:'delivery',address:'Private QA delivery address',deliveryLegs:'two_way',subtotal:10,total:10,depositAmount:0});
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
 assert.deepEqual(owner.items.map(l=>l.returnTime),['17:00','20:00']);assert.deepEqual(renter.items.map(l=>l.pickupTime),['09:00','16:00']);assert.equal(renter.searchText,undefined,'Admin-only chat search context is not included in renter responses');assert.equal(renter.lastRenterAt,undefined);assert.equal(JSON.stringify(booking),before,'Presentation cannot rewrite authoritative rental or financial data');
 assert.equal(renter.handoverDetails,null,'An unpaid, unverified booking hides the address and phone');
 const staleVerificationCard=put('messages',{accountId:account._id,bookingId:deliveryBooking._id,sender:'system',text:'Verification approved. Your pickup map and support contact are below.',meta:{kind:'verification_update',status:'verified',supportPhone:LEO_SUPPORT_PHONE,pickupMapUrl:'https://www.google.com/maps/search/The+Grand+Building'}});
 const staleConfirmation=put('messages',{accountId:account._id,bookingId:deliveryBooking._id,sender:'system',text:'Your rental is confirmed. Location: Private QA delivery address. Call Leo +44 7933 019849.',meta:{kind:'booking_confirmation',bookingId:deliveryBooking._id,stage:'confirmed'}});
 const closedGateMessages=await chat.messages.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id,paginationOpts:{numItems:20,cursor:null}});
 const closedGateJson=JSON.stringify(closedGateMessages.page);
 assert.doesNotMatch(closedGateJson,/\+44 7933 019849|Private QA delivery address|google\.com\/maps\/search/i,'Historical chat messages cannot re-expose protected contact/location details after the live handover gate closes');
 assert.equal(closedGateMessages.page.find(m=>m._id===staleVerificationCard._id).meta.supportPhone,undefined,'The renter message API strips stale phone metadata');
 assert.equal(closedGateMessages.page.find(m=>m._id===staleVerificationCard._id).meta.pickupMapUrl,undefined,'The renter message API strips stale map links');
 assert.match(closedGateMessages.page.find(m=>m._id===staleConfirmation._id).text,/being updated/i,'Stale booking-confirmation copy is replaced with a safe current-state notice');
 const pageArgs={token:'qa-renter',paginationOpts:{numItems:10,cursor:null}};
 const deliveryFromChatMine=async()=> (await chat.mine.handler(ctx,{token:'qa-renter'})).find(item=>item._id===deliveryBooking._id);
 const deliveryFromChatPage=async()=> (await chat.minePage.handler(ctx,pageArgs)).page.find(item=>item._id===deliveryBooking._id);
 const deliveryFromAccount=async()=> (await accounts.myBookings.handler(ctx,{token:'qa-renter'})).find(item=>item._id===deliveryBooking._id);
 const deliveryFromAccountPage=async()=> (await accounts.myBookingsPage.handler(ctx,pageArgs)).page.find(item=>item._id===deliveryBooking._id);
 const assertDeliveryDetailsHidden=async(label)=>{
  const chatView=await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id});
  const chatMineView=await deliveryFromChatMine();
  const chatPageView=await deliveryFromChatPage();
  const accountView=await deliveryFromAccount();
  const pageView=await deliveryFromAccountPage();
  assert.equal(chatView.handoverDetails,null,`${label}: renter chat hides handover details`);
  assert.equal(chatMineView.handoverDetails,null,`${label}: renter chat list hides handover details`);
  assert.equal(chatPageView.handoverDetails,null,`${label}: paginated renter chat list hides handover details`);
  assert.equal(accountView.handoverDetails,null,`${label}: account rental hides handover details`);
  assert.equal(accountView.address,null,`${label}: account rental does not expose its raw delivery address`);
  assert.equal(pageView.handoverDetails,null,`${label}: paginated account rental hides handover details`);
  assert.equal(pageView.address,null,`${label}: paginated account rental does not expose its raw delivery address`);
 };
 await assertDeliveryDetailsHidden('An unpaid delivery rental');
 deliveryBooking.status='pending_verification';deliveryBooking.paidConfirmedAt=Date.now();deliveryBooking.idVerifyStatus='verified';deliveryBooking.verificationProvider='didit';deliveryBooking.idVerificationSource='didit';deliveryBooking.idVerifiedAt=Date.now();deliveryBooking.verificationChecks={identity:'approved',selfie:'approved',address:'approved'};
 await assertDeliveryDetailsHidden('A paid, verified rental that is not yet confirmed');
 deliveryBooking.status='confirmed';deliveryBooking.verificationChecks.address='needs_review';
 await assertDeliveryDetailsHidden('A failed verification');
 deliveryBooking.verificationChecks.address='approved';
 const diditAccountView=await deliveryFromAccount(),diditPageView=await deliveryFromAccountPage(),diditChatView=await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id});
 const diditChatMineView=await deliveryFromChatMine(),diditChatPageView=await deliveryFromChatPage();
 for (const view of [diditAccountView,diditPageView,diditChatView,diditChatMineView,diditChatPageView]) {
  assert.notEqual(view.handoverDetails,null,'A paid, confirmed Didit-approved rental reveals handover details');
  assert.equal(view.handoverDetails.pickupAddress,'Private QA delivery address');
  assert.equal(view.handoverDetails.phone,LEO_SUPPORT_PHONE);
 }
 for(const view of [diditAccountView,diditPageView])assert.equal(view.address,'Private QA delivery address','A paid, confirmed Didit-approved rental can expose its address in account projections');
 const openGateMessages=await chat.messages.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id,paginationOpts:{numItems:20,cursor:null}});
 assert.equal(openGateMessages.page.find(m=>m._id===staleVerificationCard._id).meta.supportPhone,LEO_SUPPORT_PHONE,'After the current payment, verification and confirmation gates pass, the renter can see the gated phone action');
 assert.equal(openGateMessages.page.find(m=>m._id===staleVerificationCard._id).meta.pickupMapUrl,'https://www.google.com/maps/search/The+Grand+Building','After the current handover gate passes, the renter can see the gated map link');
 deliveryBooking.idVerificationSource='manual';deliveryBooking.verificationProvider=undefined;deliveryBooking.verificationChecks=undefined;
 assert.equal((await deliveryFromAccount()).handoverDetails,null,'A legacy manual verification label cannot bypass the booking-level Didit approval gate');
 assert.equal((await chat.getConversation.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id})).handoverDetails,null,'Chat keeps delivery details private when only legacy manual verification is recorded');
 const revokedGateMessages=await chat.messages.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id,paginationOpts:{numItems:20,cursor:null}});
 assert.doesNotMatch(JSON.stringify(revokedGateMessages.page),/\+44 7933 019849|Private QA delivery address|google\.com\/maps\/search/i,'Historical chat details are redacted again if the authoritative Didit gate is no longer satisfied');
 deliveryBooking.idVerificationSource='didit';deliveryBooking.verificationProvider='didit';deliveryBooking.verificationChecks={identity:'approved',selfie:'approved',address:'approved'};deliveryBooking.diditManualDecisionAt=Date.now();
 assert.notEqual((await deliveryFromAccount()).handoverDetails,null,'A final Didit approval following the provider human-review workflow unlocks the paid, confirmed rental');
 assert.equal(await chat.getConversation.handler(ctx,{token:'qa-renter',admin:true,bookingId:deliveryBooking._id}),null,'A renter session cannot request the admin conversation projection');
 assert.equal(await chat.messages.handler(ctx,{token:'qa-renter',admin:true,bookingId:deliveryBooking._id,paginationOpts:{numItems:5,cursor:null}}),null,'A renter session cannot request admin message context');
 await assert.rejects(chat.getConversation.handler(ctx,{token:'qa-stranger',bookingId:deliveryBooking._id}),/not available to your account/,'A different renter cannot read this rental conversation');
 assert.equal((await accounts.myBookings.handler(ctx,{token:'qa-stranger'})).some(item=>item._id===deliveryBooking._id),false,'Account rentals remain scoped to the authenticated session');
 assert.deepEqual(await chat.adminInbox.handler(ctx,{token:'qa-renter'}),{authorized:false,items:[]},'Admin inbox remains token-gated');
 assert.deepEqual(await chat.adminRenterIdentity.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id}),{authorized:false,email:null},'Private renter identity remains token-gated');
 assert.deepEqual(await chat.adminPage.handler(ctx,{token:'qa-renter',paginationOpts:{numItems:5,cursor:null}}),{page:[],isDone:true,continueCursor:''},'Admin rental page remains token-gated');
 assert.equal(await chat.getGeneralConversation.handler(ctx,{token:'qa-renter',accountId:account._id}),null,'General admin chat details remain token-gated');
 assert.deepEqual(await chat.generalOwnerPage.handler(ctx,{token:'qa-renter',paginationOpts:{numItems:5,cursor:null}}),{page:[],isDone:true,continueCursor:''},'General admin chat list remains token-gated');
 assert.equal(await chat.unreadTotals.handler(ctx,{token:'qa-renter',admin:true}),0,'Admin unread totals fail closed for a renter token');
 assert.deepEqual(await chat.unreadBreakdown.handler(ctx,{token:'qa-renter',admin:true}),{rentals:0,general:0},'Admin unread breakdown fails closed for a renter token');
 await assert.rejects(chat.setHandler.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id,gaffer:false}),/unauthorized/,'Renter cannot switch chat ownership or expose admin takeover controls');
 await assert.rejects(chat.markRead.handler(ctx,{token:'qa-renter',admin:true,bookingId:deliveryBooking._id,through:'forged-message'}),/unauthorized/,'Renter cannot update the owner read state');
 await assert.rejects(chat.sendOwner.handler(ctx,{token:'qa-renter',bookingId:deliveryBooking._id,text:'Forged admin reply'}),/unauthorized/,'Renter cannot send an owner-authored message');
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
 console.log('PASS handover gates across renter chat and account APIs, private delivery address, manual/Didit verification, admin chat authorization, ownership, per-item clocks, quantity grouping and immutable charges. No live writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
