const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const requests = load('convex/rentalRequests.ts');
process.env.ADMIN_TOKEN = 'fixture-request-owner';
const jobs = [], ctx = { db, scheduler: { runAfter: async (...args) => jobs.push(args) } };
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
  assert.equal((await requests.context.handler(ctx, { token: 'owner-session', bookingId: booking._id })).actionReady, true,
    'A paid booking retains its own complete Didit approval even after the account reuse window has elapsed');
  await requests.submit.handler(ctx, { ...view, requestId: 'request-review-00001', kind: 'dates', detail: 'Could we move the rental to Friday?' });
  const first = tables.get('rental_change_requests').find(row=>row.requestId==='request-review-00001');
  assert.equal(first.status, 'pending');
  assert.equal((await requests.list.handler(ctx, view)).page.find(row=>row._id===first._id).status, 'pending');
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
  assert.deepEqual(Object.keys(renter).sort(), ['_id', 'kind', 'detail', 'createdAt', 'cancellationKindAtRequest', 'cancellationTermsVersion', 'cancellationChoice', 'status', 'decisionNote', 'decidedAt', 'execution'].sort(), 'Public view contains only this renter’s cancellation choice and request snapshot');
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
  assert(!jobs.some(j => /refund|cancel|checkout|hold/i.test(j[1])), 'Review cannot trigger bank or rental settlement');
  console.log('PASS actual request handlers: owner/account/expiry boundaries, bounded legacy/current history, real decision chat+notification queue, replay dedup, immutable decisions, stale lifecycle fences and unchanged rental/payments. Controlled database; no real provider dispatch.');
})().catch(e => { console.error(e); process.exitCode = 1; });
