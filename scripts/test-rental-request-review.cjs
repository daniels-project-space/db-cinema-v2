const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const requests = load('convex/rentalRequests.ts');
const operations = load('convex/rentalOperations.ts');
process.env.ADMIN_TOKEN = 'fixture-request-owner';
const jobs = [];
let previewResult = null;
const ctx = {
  db,
  scheduler: { runAfter: async (...args) => jobs.push(args) },
  runQuery: async (_query, args) => previewResult ?? ({ ok: true, start: args.start, end: args.start + 86400000, controlsSnapshot: 'fixture-snapshot', ...(args.lineIndexes ? { lineIndexes: [...args.lineIndexes].sort((a,b)=>a-b), kind: args.kind, time: args.time } : {}) }),
};
const owner = put('accounts', { email: 'request-owner@example.invalid' });
const stranger = put('accounts', { email: owner.email });
put('sessions', { token: 'owner-session', accountId: owner._id, expiresAt: Date.now() + 600000 });
put('sessions', { token: 'stranger-session', accountId: stranger._id, expiresAt: Date.now() + 600000 });
put('sessions', { token: 'expired-session', accountId: owner._id, expiresAt: Date.now() - 1 });
put('sessions', { token: 'missing-expiry', accountId: owner._id });
const agedBookingPass = Date.now() - 100 * 86400000;
const diditApproval = { paidConfirmedAt: Date.now() - 1000, verificationProvider: 'didit', idVerifyStatus: 'verified', idVerificationSource: 'didit', idVerifiedAt: agedBookingPass, verificationExpiresAt: agedBookingPass + 90 * 86400000, verificationChecks: { identity: 'approved', selfie: 'approved', address: 'approved' } };
const booking = put('bookings', { accountId: owner._id, guestEmail: owner.email, status: 'confirmed', ...diditApproval, lineItems: [{ start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 2), qty: 1 }], total: 45 });
const otherBooking = put('bookings', { accountId: stranger._id, status: 'confirmed' });
const view = { token: 'owner-session', bookingId: booking._id, paginationOpts: {numItems:30,cursor:null} };
const admin = { token: process.env.ADMIN_TOKEN, bookingId: booking._id, paginationOpts: {numItems:30,cursor:null} };
(async () => {
  const gatedCases = [
    ['unpaid-confirmed', { paidConfirmedAt: undefined }],
    ['pending-payment', { status: 'pending_payment' }],
    ['verification-incomplete', { idVerifyStatus: 'manual_review' }],
    ['verification-not-didit', { verificationProvider: 'stripe' }],
    ['missing-provenance', { idVerificationSource: undefined }],
    ['missing-approval-time', { idVerifiedAt: undefined }],
    ['incomplete-checks', { verificationChecks: { identity: 'approved', selfie: 'approved', address: 'waiting' } }],
  ];
  for (const [suffix, change] of gatedCases) {
    const blocked = put('bookings', { accountId: owner._id, guestEmail: owner.email, status: 'confirmed', ...diditApproval,
      lineItems: [{ start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 2), qty: 1 }], total: 45, ...change });
    const args = { token: 'owner-session', bookingId: blocked._id };
    assert.equal((await requests.context.handler(ctx, args)).actionReady, false, `${suffix} hides renter request controls`);
    await assert.rejects(requests.submit.handler(ctx, { ...args, requestId: `blocked-${suffix}-0001`, kind: 'dates', detail: 'Please move my rental to Friday.' }), /payment and Didit verification/);
  }
  for (const [index, field] of ['activeAdditionId', 'activeDeliveryQuoteId', 'activeExtensionId', 'activeItemSwapId', 'activePriceAdjustmentId'].entries()) {
    const operationAccount = put('accounts', { email: `active-operation-${index}@example.invalid` });
    put('sessions', { token: `active-operation-session-${index}`, accountId: operationAccount._id, expiresAt: Date.now() + 600000 });
    const operationBooking = put('bookings', { accountId: operationAccount._id, guestEmail: operationAccount.email, status: 'confirmed', ...diditApproval,
      lineItems: [{ start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 2), qty: 1 }], total: 45, [field]: `active-${field}` });
    const operationArgs = { token: `active-operation-session-${index}`, bookingId: operationBooking._id };
    assert.equal((await requests.context.handler(ctx, operationArgs)).locked, true, `${field} locks renter change tools`);
    await assert.rejects(requests.submit.handler(ctx, { ...operationArgs, requestId: `active-lock-${index}-00001`, kind: 'dates', detail: 'Please move my rental to Friday.' }), /active rental operation/);
    const pending = put('rental_change_requests', { bookingId: operationBooking._id, accountId: operationAccount._id, kind: 'dates', detail: 'Please move my rental to Friday.', createdAt: Date.now(), messageId: `active-request-${index}`, status: 'pending' });
    const adminOperationArgs = { token: process.env.ADMIN_TOKEN, bookingId: operationBooking._id, paginationOpts: { numItems: 30, cursor: null } };
    assert.equal((await requests.list.handler(ctx, { ...adminOperationArgs, admin: true })).page[0].approvalBlocked, true, `${field} explains the blocked admin approval`);
    await assert.rejects(requests.review.handler(ctx, { ...adminOperationArgs, id: pending._id, decision: 'approved', note: 'We can arrange this change.' }), /Finish the active rental operation/);
    assert.equal(pending.status, 'pending', `${field} cannot record a stale approval`);
    await requests.review.handler(ctx, { ...adminOperationArgs, id: pending._id, decision: 'declined', note: 'Please finish the current rental operation first.' });
    assert.equal(pending.status, 'declined', `${field} still allows staff to decline the request`);
  }
  assert.equal((await requests.context.handler(ctx, { token: 'owner-session', bookingId: booking._id })).actionReady, true,
    'A paid booking retains its own complete Didit approval even after the account reuse window has elapsed');
  const requestedStart = Date.UTC(2030, 0, 4);
  await requests.submit.handler(ctx, { ...view, requestId: 'request-review-00001', kind: 'dates', detail: 'Reschedule all items together to 2030-01-04. Reason: Could we move the rental to Friday?', proposedStart: requestedStart });
  const first = tables.get('rental_change_requests').find(row=>row.requestId==='request-review-00001');
  assert.equal(first.status, 'pending');
  assert.equal(first.requestedStart, requestedStart, 'The exact renter-selected collection date is stored');
  assert.equal(first.requestedEnd, requestedStart + 86400000, 'The existing duration determines and stores the projected return date');
  assert.equal(first.requestedSnapshot, 'fixture-snapshot', 'The availability preview captures the rental controls snapshot');
  assert.equal((await requests.list.handler(ctx, view)).page.find(row=>row._id===first._id).status, 'pending');
  assert.equal((await requests.list.handler(ctx, { ...admin, admin: true })).page.find(row=>row._id===first._id).requestedSnapshot, 'fixture-snapshot', 'Only admin history receives the execution snapshot');
  assert.equal((await requests.list.handler(ctx, view)).page.find(row=>row._id===first._id).requestedSnapshot, undefined, 'The renter view does not expose the internal snapshot');
  await requests.submit.handler(ctx, { ...view, requestId: 'request-review-00001', kind: 'dates', detail: 'Reschedule all items together to 2030-01-04. Reason: Could we move the rental to Friday?', proposedStart: requestedStart });
  await assert.rejects(requests.submit.handler(ctx, { ...view, requestId: 'request-review-00001', kind: 'dates', detail: 'Reschedule all items together to 2030-01-04. Reason: Could we move the rental to Friday?', proposedStart: requestedStart + 86400000 }), /different change/, 'An idempotency replay cannot alter the proposed date');
  previewResult = { ok: true, start: requestedStart, end: requestedStart + 86400000, controlsSnapshot: 'changed-snapshot' };
  await assert.rejects(requests.review.handler(ctx, { ...admin, id: first._id, decision: 'approved', note: 'We can arrange the requested dates.' }), /changed|fresh date request/, 'A stale booking snapshot cannot be approved');
  previewResult = null;
  assert.equal((await requests.context.handler(ctx, view)).locked, true, 'A pending renter request locks conflicting controls in the renter panel');
  await assert.rejects(requests.submit.handler(ctx,{...view,requestId:'request-review-00002',kind:'items',detail:'Please change the kit instead.'}),/already awaiting the team/,'A renter cannot stack a second change on the same rental');
  for (const token of ['stranger-session', 'expired-session', 'missing-expiry', 'invalid-session']) await assert.rejects(requests.list.handler(ctx, { ...view, token }));
  await assert.rejects(requests.submit.handler(ctx, { ...view, token: 'missing-expiry', requestId: 'missing-expiry-request-01', kind: 'dates', detail: 'Please move my rental to Friday.' }), /sign in/);
  await assert.rejects(requests.list.handler(ctx, { ...view, admin: true }), /unauthorized/);
  await assert.rejects(requests.review.handler(ctx, { ...view, id: first._id, decision: 'approved', note: 'Friday is possible.' }), /unauthorized/);
  await assert.rejects(requests.review.handler(ctx, { ...admin, bookingId: otherBooking._id, id: first._id, decision: 'approved', note: 'Friday is possible.' }), /not available/);
  const competing=put('rental_change_requests',{bookingId:booking._id,accountId:owner._id,kind:'items',detail:'Please change the kit.',createdAt:Date.now(),messageId:'competing-message',status:'pending'});
  await assert.rejects(requests.review.handler(ctx,{...admin,id:first._id,decision:'approved',note:'Friday is possible.'}),/Resolve the other open request/,'Staff cannot approve two overlapping uncompleted requests');
  await requests.review.handler(ctx,{...admin,id:competing._id,decision:'declined',note:'Please keep the original kit for now.'});
  const before = JSON.stringify(booking), messageCount = tables.get('messages').length;
  const decision = { ...admin, id: first._id, decision: 'approved', note: 'We can arrange Friday. Please confirm the collection time in this chat.' };
  await assert.rejects(requests.review.handler(ctx, { ...decision, note: 'OK' }), /5–1000/);
  const result = await requests.review.handler(ctx, decision);
  assert.equal(JSON.stringify(booking.lineItems), JSON.parse(before).lineItems && JSON.stringify(JSON.parse(before).lineItems));
  assert.equal(booking.status, 'confirmed'); assert.equal(booking.total, 45);
  assert.equal(result.status, 'approved'); assert.equal(first.status, 'approved');
  assert.equal(first.decisionNote, decision.note); assert(first.decidedAt); assert.equal(first.decisionMessageId, result.messageId);
  const reply = tables.get('messages').at(-1);
  assert.equal(reply.accountId, owner._id); assert.equal(reply.bookingId, booking._id);
  assert.equal(reply.meta.changeRequestId, first._id); assert.equal(reply.meta.decision, 'approved');
  assert.match(reply.text, /unchanged until/); assert.match(reply.text, /settlement separately/);
  assert.equal(tables.get('renter_notifications').at(-1).bookingId, booking._id, 'Decision goes to the real booking notification queue');
  assert.equal(tables.get('messages').length, messageCount + 1);
  assert.equal((await requests.context.handler(ctx,view)).locked,true,'Approval still waits for the separate manager apply action');
  await db.patch(first._id,{execution:{operation:'reschedule',status:'applied'}});
  assert.equal((await requests.context.handler(ctx,view)).locked,false,'An applied request releases the renter change lock');
  const retried = await requests.review.handler(ctx, decision);
  assert.equal(retried.messageId, result.messageId); assert.equal(tables.get('messages').length, messageCount + 1);
  await assert.rejects(requests.review.handler(ctx, { ...decision, decision: 'declined' }), /already been reviewed/);
  await assert.rejects(requests.review.handler(ctx, { ...decision, note: 'A different reply.' }), /already been reviewed/);
  const renter = (await requests.list.handler(ctx, view)).page.find(row=>row._id===first._id);
  assert.equal(renter.decisionNote, decision.note); assert.equal(renter.status, 'approved');
  assert.deepEqual(Object.keys(renter).sort(), ['_id', 'kind', 'detail', 'createdAt', 'cancellationKindAtRequest', 'cancellationTermsVersion', 'cancellationChoice', 'requestedStart', 'requestedEnd', 'requestedSnapshot', 'status', 'decisionNote', 'decidedAt', 'execution'].sort(), 'Renter sees their date proposal while the internal availability snapshot stays private');
  await db.patch(booking._id, { agreementDocs: [{ kind: 'cancellation', version: '2026-11-v21' }], pickupTime: '15:00' });
  await assert.rejects(requests.submit.handler(ctx, { ...view, requestId: 'cancel-request-choice-0001', kind: 'cancel', detail: 'Please cancel my rental under the accepted terms.' }), /Choose a full refund or 100% account credit/);
  const cancelArgs = { ...view, requestId: 'cancel-request-choice-0001', kind: 'cancel', detail: 'Please cancel my rental under the accepted terms.', cancellationChoice: 'credit' };
  await requests.submit.handler(ctx, cancelArgs);
  const cancelRequest = tables.get('rental_change_requests').find(row => row.requestId === cancelArgs.requestId);
  assert.equal(cancelRequest.cancellationKindAtRequest, 'full_refund');
  assert.equal(cancelRequest.cancellationTermsVersion, '2026-11-v21');
  assert.equal(cancelRequest.cancellationChoice, 'credit');
  assert.match(tables.get('messages').at(-1).text, /Renter chose 100% account credit/);
  await assert.rejects(requests.submit.handler(ctx, { ...cancelArgs, cancellationChoice: 'refund' }), /different change/);
  const visibleCancel = (await requests.list.handler(ctx, view)).page.find(row => row._id === cancelRequest._id);
  assert.equal(visibleCancel.cancellationChoice, 'credit');
  await requests.review.handler(ctx, { ...admin, id: cancelRequest._id, decision: 'approved', note: 'Cancellation is approved under the renter’s selected option.' });
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.total, 45, 'manual approval does not execute cancellation or settlement');
  await db.patch(cancelRequest._id,{execution:{operation:'cancellation',status:'applied'}});
  const v22Owner=put('accounts',{email:'request-v22-owner@example.invalid'});
  put('sessions',{token:'v22-owner-session',accountId:v22Owner._id,expiresAt:Date.now()+600000});
  const v22Start=Date.UTC(2030,0,10,15),v22Booking=put('bookings',{accountId:v22Owner._id,guestEmail:v22Owner.email,status:'confirmed',...diditApproval,lineItems:[{start:v22Start,end:v22Start+86400000,qty:1}],pickupTime:'15:00',total:45});
  const v22View={token:'v22-owner-session',bookingId:v22Booking._id};
  await db.patch(v22Booking._id,{agreementDocs:[{kind:'cancellation',version:'2026-11-v22'}]});
  const v22Context=await requests.context.handler(ctx,v22View);
  assert.equal(v22Context.cancellationTermsVersion,'2026-11-v22');
  assert.equal(v22Context.cancellationKind,'full_refund','v22 matches the renter cancellation window of v21');
  await assert.rejects(requests.submit.handler(ctx,{...v22View,requestId:'cancel-v22-choice-0001',kind:'cancel',detail:'Please cancel this rental under my accepted terms.'}),/Choose a full refund or 100% account credit/,'v22 full-refund requests require the same explicit choice as v21');
  const v22Args={...v22View,requestId:'cancel-v22-choice-0001',kind:'cancel',detail:'Please cancel this rental under my accepted terms.',cancellationChoice:'refund'};
  await requests.submit.handler(ctx,v22Args);
  const v22Request=tables.get('rental_change_requests').find(row=>row.requestId===v22Args.requestId);
  assert.equal(v22Request.cancellationTermsVersion,'2026-11-v22','The request preserves the exact v22 snapshot version');
  assert.equal(v22Request.cancellationKindAtRequest,'full_refund');
  assert.equal(v22Request.cancellationChoice,'refund');
  await requests.review.handler(ctx,{...admin,bookingId:v22Booking._id,id:v22Request._id,decision:'approved',note:'Approved under the renter’s saved cancellation choice.'});
  assert.equal(v22Request.status,'approved','Staff review keeps the renter settlement choice linked to the request');
  const legacy = put('rental_change_requests', { bookingId: booking._id, accountId: owner._id, kind: 'items', detail: 'Please add another camera.', createdAt: Date.now(), messageId: 'old-message' });
  assert.equal((await requests.list.handler(ctx, view)).page[0].status, 'pending');
  await requests.review.handler(ctx, { ...admin, id: legacy._id, decision: 'declined', note: 'The extra camera is reserved. We can discuss an alternative.' });
  assert.equal(legacy.status, 'declined'); assert.match(tables.get('messages').at(-1).text, /declined.*kit/);
  const stale = put('rental_change_requests', { bookingId: booking._id, accountId: owner._id, kind: 'cancel', detail: 'Please cancel the booking.', createdAt: Date.now(), messageId: 'stale-message' });
  await db.patch(booking._id, { status: 'active' });
  await assert.rejects(requests.review.handler(ctx, { ...admin, id: stale._id, decision: 'approved', note: 'Agreed cancellation request.' }), /early return/);
  await db.patch(booking._id, { status: 'returned' });
  await assert.rejects(requests.review.handler(ctx, { ...admin, id: stale._id, decision: 'approved', note: 'Agreed cancellation request.' }), /no longer/);
  await requests.review.handler(ctx, { ...admin, id: stale._id, decision: 'declined', note: 'The rental has already been returned. Contact us about settlement.' });
  const foreign = put('rental_change_requests', { bookingId: booking._id, accountId: stranger._id, kind: 'items', detail: 'Foreign private detail', createdAt: Date.now(), messageId: 'foreign-message' });
  assert(!(await requests.list.handler(ctx, view)).page.some(r => r._id === foreign._id));
  await assert.rejects(requests.review.handler(ctx, { ...admin, id: foreign._id, decision: 'declined', note: 'Account identity mismatch.' }), /not available/);
  for (let i = 0; i < 35; i++) put('rental_change_requests', { bookingId: booking._id, accountId: owner._id, kind: 'dates', detail: 'History request ' + i, createdAt: i, messageId: 'history-message' });
  const history = await requests.list.handler(ctx, { ...admin, admin: true });
  assert.equal(history.page.length, 30); assert.equal(history.isDone, false);
  assert.equal(history.page[0].detail, 'History request 34');
  const older=await requests.list.handler(ctx,{...admin,admin:true,paginationOpts:{numItems:30,cursor:history.continueCursor}});
  assert(older.page.some(r=>r._id===first._id));assert(older.isDone);
  assert(!older.page.some(r=>history.page.some(h=>h._id===r._id)));
  await assert.rejects(requests.list.handler(ctx,{...admin,admin:true,paginationOpts:{numItems:10000,cursor:null}}),/1–50/);
  const timeOwner=put('accounts',{email:'handover-owner@example.invalid'});
  put('sessions',{token:'handover-owner-session',accountId:timeOwner._id,expiresAt:Date.now()+600000});
  const timeStart=Date.UTC(2030,4,1,15),timeBooking=put('bookings',{accountId:timeOwner._id,guestEmail:timeOwner.email,status:'confirmed',...diditApproval,lineItems:[
    {listingId:'handover-camera',title:'Camera kit',start:timeStart,end:timeStart+86400000,qty:1,pickupTime:'10:00',returnTime:'18:00'},
    {listingId:'handover-lens',title:'Lens set',start:timeStart,end:timeStart+86400000,qty:2,pickupTime:'10:00',returnTime:'18:00'},
  ],total:80});
  const timeView={token:'handover-owner-session',bookingId:timeBooking._id},timeAdmin={token:process.env.ADMIN_TOKEN,bookingId:timeBooking._id,admin:true,paginationOpts:{numItems:30,cursor:null}};
  const handoverPreviewArgs={bookingId:timeBooking._id,lineIndexes:[1],kind:'return',time:'19:00',reason:'The shoot is running late.'};
  await assert.rejects(operations.previewHandoverTimes.handler(ctx,{...handoverPreviewArgs,token:'wrong-admin-token'}),/Unauthorized/,'Admin approval preview requires the owner credential');
  await assert.rejects(operations.renterHandoverPreview.handler(ctx,{...handoverPreviewArgs,token:process.env.ADMIN_TOKEN}),/sign in/,'The admin credential is not accepted as a renter session');
  const timeRequestArgs={...timeView,requestId:'handover-return-request-001',kind:'handover',detail:'I need to return the lens after the later shoot wraps.',handoverKind:'return',handoverTime:'19:00',handoverLineIndexes:[1]};
  await requests.submit.handler(ctx,timeRequestArgs);
  const timeRequest=tables.get('rental_change_requests').find(row=>row.requestId===timeRequestArgs.requestId);
  assert.equal(timeRequest.status,'pending');assert.deepEqual(timeRequest.requestedHandover,{lineIndexes:[1],kind:'return',time:'19:00'});assert.equal(timeRequest.requestedSnapshot,'fixture-snapshot');
  assert.match(tables.get('messages').at(-1).text,/Return time requested: 19:00 for 2× Lens set/);
  const savedReturn=timeBooking.lineItems[1].returnTime;
  await requests.submit.handler(ctx,timeRequestArgs);
  assert.equal(tables.get('messages').filter(message=>message.bookingId===timeBooking._id).length,1,'An exact renter retry does not create another request message');
  await assert.rejects(requests.submit.handler(ctx,{...timeRequestArgs,handoverTime:'20:00'}),/different change/);
  const listedTimeRequest=(await requests.list.handler(ctx,{...timeView,paginationOpts:{numItems:30,cursor:null}})).page.find(row=>row._id===timeRequest._id);
  assert.equal(listedTimeRequest.requestedHandover.time,'19:00');assert.deepEqual(listedTimeRequest.handoverItems.map(item=>[item.title,item.qty]),[['Lens set',2]]);
  assert.equal((await requests.context.handler(ctx,timeView)).locked,true,'A pending time proposal locks conflicting renter controls');
  previewResult={ok:true,controlsSnapshot:'stale-handover-snapshot',lineIndexes:[1],kind:'return',time:'19:00'};
  await assert.rejects(requests.review.handler(ctx,{...timeAdmin,id:timeRequest._id,decision:'approved',note:'Approved if return availability holds.'}),/changed|fresh time request/);
  previewResult=null;
  const timeBookingBefore=structuredClone(timeBooking);const timeReservationRows=JSON.stringify(tables.get('reservations')??[]);
  await requests.review.handler(ctx,{...timeAdmin,id:timeRequest._id,decision:'approved',note:'Approved for 19:00 return; apply the update below.'});
  assert.equal(timeRequest.status,'approved');assert.equal(timeBooking.lineItems[1].returnTime,savedReturn,'Approval alone does not change the agreed rental time');
  assert.equal(JSON.stringify(tables.get('reservations')??[]),timeReservationRows,'Approval alone does not move inventory');
  await requests.review.handler(ctx,{...timeAdmin,id:timeRequest._id,decision:'approved',note:'Approved for 19:00 return; apply the update below.'});
  assert.equal(tables.get('messages').filter(message=>message.bookingId===timeBooking._id).length,2,'Approval replay does not duplicate the team reply');
  const declineOwner=put('accounts',{email:'handover-decline@example.invalid'});put('sessions',{token:'handover-decline-session',accountId:declineOwner._id,expiresAt:Date.now()+600000});
  const declineBooking=put('bookings',{accountId:declineOwner._id,guestEmail:declineOwner.email,status:'active',...diditApproval,lineItems:[{listingId:'active-kit',title:'Active camera kit',start:timeStart,end:timeStart+86400000,qty:1,pickupTime:'10:00',returnTime:'18:00'}],total:50});
  const declineView={token:'handover-decline-session',bookingId:declineBooking._id};
  await requests.submit.handler(ctx,{...declineView,requestId:'handover-decline-request-01',kind:'handover',detail:'The shoot is running late this evening.',handoverKind:'return',handoverTime:'19:00',handoverLineIndexes:[0]});
  const declineRequest=tables.get('rental_change_requests').find(row=>row.requestId==='handover-decline-request-01');const declineBefore=JSON.stringify({status:declineBooking.status,total:declineBooking.total,lineItems:declineBooking.lineItems});const declineReservations=JSON.stringify((tables.get('reservations')??[]).filter(row=>row.bookingId===declineBooking._id));
  await requests.review.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:declineBooking._id,id:declineRequest._id,decision:'declined',note:'The return slot is not available; please keep the scheduled time.'});
  assert.equal(JSON.stringify({status:declineBooking.status,total:declineBooking.total,lineItems:declineBooking.lineItems}),declineBefore,'Declining a time request leaves booking terms unchanged');assert.equal(JSON.stringify((tables.get('reservations')??[]).filter(row=>row.bookingId===declineBooking._id)),declineReservations,'Declining a time request leaves inventory unchanged');assert.equal(declineBooking.lineItems[0].returnTime,'18:00');
  assert.equal(timeBookingBefore.lineItems[0].pickupTime,'10:00','The saved proposal does not alter the other line handover');
  assert(!jobs.some(j => /refund|cancel|checkout|hold/i.test(j[1])), 'Review cannot trigger bank or rental settlement');
  console.log('PASS actual request handlers: owner/account/expiry boundaries, bounded legacy/current history, real decision chat+notification queue, replay dedup, immutable decisions, stale lifecycle fences and unchanged rental/payments. Controlled database; no real provider dispatch.');
})().catch(e => { console.error(e); process.exitCode = 1; });
