const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const sweep = load('convex/diditSweep.ts');
const bookings = load('convex/bookings.ts');

(async () => {
  const tasks = [];
  const ctx = { db, scheduler: { runAfter: async (_delay, ref, args) => tasks.push({ ref, args }) } };
  const missing=put('bookings',{verificationProvider:'didit',status:'confirmed',diditSessionId:'missing-contact-session'});
  const pendingMissing=put('bookings',{verificationProvider:'didit',status:'pending_verification',diditSessionId:'pending-missing-contact-session'});
  for (let index = 0; index < 240; index++) put('bookings', {
    verificationProvider: 'didit', status: 'confirmed', guestEmail: 'test@example.invalid',
  });
  const eligible = Array.from({ length: 125 }, (_, index) => put('bookings', {
    verificationProvider: 'didit', status: index % 2 ? 'active' : 'confirmed',
    guestEmail: 'test@example.invalid', diditSessionId: `session-${index}`, diditReconciledAt: 125 - index,
  }));
  const pendingVerification = Array.from({ length: 40 }, (_, index) => put('bookings', {
    verificationProvider: 'didit', status: 'pending_verification',
    guestEmail: 'test@example.invalid', diditSessionId: `pending-session-${index}`, diditReconciledAt: Date.now(),
  }));
  await sweep.start.handler(ctx, {});
  await sweep.start.handler(ctx, {});
  assert.equal(tasks.length, 1, 'overlapping hourly starts share a single sweep');
  let pages = 0;
  while (tasks.length && tasks[0].ref !== 'didit.reconcileOpenSessions') {
    const task = tasks.shift();
    if(task.ref==='diditSweep.page'){await sweep.page.handler(ctx, task.args);pages++;}
    else if(task.ref==='diditSweep.missingEmail')await sweep.missingEmail.handler(ctx,task.args);
    else throw Error(`Unexpected scheduled task ${task.ref}`);
  }
  assert.ok(pages >= 6, 'each active and recently returned status stream is scanned in bounded pages');
  assert.equal(tasks.length, 1);
  assert.ok((tables.get('admin_notifications')??[]).some(row=>row.bookingId===missing._id&&row.kind==='verification_failure'),'a bound session with no email produces a durable repair alert');
  assert.ok((tables.get('admin_notifications')??[]).some(row=>row.bookingId===pendingMissing._id&&row.kind==='verification_failure'),'a paid pending-verification session with no email also produces a durable repair alert');
  assert.equal(tasks[0].ref, 'didit.reconcileOpenSessions');
  const generation = tasks.shift().args.generation;
  await sweep.configurationFailure.handler(ctx, { generation });
  assert.ok((tables.get('admin_notifications') ?? []).some(row => row.title === 'Verification configuration needs attention' && !row.accountId), 'configuration incidents are stored without requiring an account');
  const batch = await sweep.batch.handler(ctx, { generation });
  assert.equal(batch.length, 50, 'provider reads stay capped at 50 per sweep');
  assert.deepEqual(batch.slice(0, 30).map(row => row.bookingId), pendingVerification.slice(0, 30).map(row => row._id),
    'recently checked paid pending-verification sessions use the reserved priority quota ahead of older active sessions');
  const selectedIds = new Set(batch.map(row => row.bookingId));
  const selectedPending = new Set(pendingVerification.slice(0, 30).map(row => row._id));
  assert.equal(batch.filter(row => !selectedPending.has(row.bookingId)).length, 20,
    'a large pending backlog still leaves twenty provider reads for other rental states');
  assert(eligible.filter((_, index) => index % 2 === 0).sort((left, right) => left.diditReconciledAt - right.diditReconciledAt).slice(0, 12).every(row => selectedIds.has(row._id)),
    'confirmed rentals receive their reserved oldest-session quota');
  assert(eligible.filter((_, index) => index % 2 === 1).sort((left, right) => left.diditReconciledAt - right.diditReconciledAt).slice(0, 6).every(row => selectedIds.has(row._id)),
    'active rentals receive their reserved oldest-session quota');
  eligible[124].diditReconciledAt++;
  eligible[123].status = 'returned';
  const revalidatedBatch = await sweep.batch.handler(ctx, { generation });
  assert.equal(revalidatedBatch.length, 50, 'changed candidates are revalidated and replaced from the retained fair queue');
  assert(!revalidatedBatch.some(row => row.bookingId === eligible[124]._id || row.bookingId === eligible[123]._id), 'changed sessions are never sent to Didit');
  const protectedRental = eligible[122];
  protectedRental.diditEventId = 'newer-webhook';protectedRental.diditEventAt = 42;
  assert.equal(await bookings.setDiditResult.handler(ctx, { bookingId: protectedRental._id, sessionId: protectedRental.diditSessionId, eventId: 'stale-read', status: 'verified', providerStatus: 'Approved', eventAt: 43, poaPostcodes: [], sweepGeneration: generation, requireApplied: true, expectedEventId: null, expectedEventAt: null, expectedManualDecisionAt: null }), false,'the shared Didit boundary reports a stale compare-and-set as not applied');
  assert.equal(protectedRental.diditEventId, 'newer-webhook', 'an in-flight provider read cannot overwrite a newer webhook even with a later response timestamp');
  await sweep.finish.handler(ctx, { generation: generation - 1 });
  assert.equal((tables.get('didit_reconcile_sweeps') ?? [])[0].phase, 'dispatch', 'stale runs cannot finish a newer sweep');
  await sweep.finish.handler(ctx, { generation });
  assert.equal((await sweep.batch.handler(ctx, { generation })).length, 0);
  const recentlyReturned=put('bookings',{verificationProvider:'didit',status:'returned',returnedAt:Date.now()-86400000,guestEmail:'returned@example.invalid',diditSessionId:'returned-session',diditReconciledAt:0});
  const oldReturned=put('bookings',{verificationProvider:'didit',status:'returned',returnedAt:Date.now()-91*86400000,guestEmail:'old-returned@example.invalid',diditSessionId:'old-returned-session',diditReconciledAt:0});
  for(const row of pendingVerification)row.diditReconciledAt=Date.now();
  await sweep.start.handler(ctx,{});
  while(tasks.length&&tasks[0].ref!=='didit.reconcileOpenSessions'){
    const task=tasks.shift();if(task.ref==='diditSweep.page')await sweep.page.handler(ctx,task.args);else if(task.ref==='diditSweep.missingEmail')await sweep.missingEmail.handler(ctx,task.args);else throw Error(`Unexpected task ${task.ref}`);
  }
  const returnedGeneration=tasks.shift().args.generation,returnedBatch=await sweep.batch.handler(ctx,{generation:returnedGeneration});
  assert(returnedBatch.some(row=>row.bookingId===recentlyReturned._id),'a missed approval is recovered after the rental closes');
  assert(!returnedBatch.some(row=>row.bookingId===oldReturned._id),'closed rentals outside the 90-day window do not call Didit');
  recentlyReturned.status='cancelled';assert(!((await sweep.batch.handler(ctx,{generation:returnedGeneration})).some(row=>row.bookingId===recentlyReturned._id)),'a changed or cancelled rental is dropped before provider access');
  await sweep.finish.handler(ctx,{generation:returnedGeneration});
  missing.guestEmail='repaired@example.invalid';
  pendingMissing.guestEmail='repaired@example.invalid';

  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await sweep.start.handler(ctx, {});
    const stale = tasks.shift().args;
    await sweep.page.handler(ctx, stale);
    while(tasks[0]?.ref==='diditSweep.missingEmail'){
      const notice=tasks.shift();
      await sweep.missingEmail.handler(ctx,notice.args);
    }
    const abandoned = tasks.shift();
    now += 10 * 60000 + 1;
    await sweep.start.handler(ctx, {});
    const replacement = tasks.shift().args;
    assert.equal(replacement.generation, stale.generation + 1, 'a stalled sweep recovers on the next cron');
    await sweep.page.handler(ctx, abandoned.args);
    assert.equal(tasks.length, 0, 'the abandoned continuation is fenced');
    const priorTimestamp = eligible[0].diditReconciledAt;
    await bookings.markDiditReconciled.handler(ctx, { bookingId: eligible[0]._id, sessionId: eligible[0].diditSessionId, attemptedAt: now, sweepGeneration: stale.generation });
    assert.equal(eligible[0].diditReconciledAt, priorTimestamp, 'an abandoned provider response cannot mark a newer sweep');
    assert.equal(await bookings.setDiditResult.handler(ctx, { bookingId: eligible[0]._id, sessionId: eligible[0].diditSessionId, eventId: 'stale', status: 'verified', eventAt: now, poaPostcodes: [], sweepGeneration: stale.generation }), false, 'a stale decision cannot change a rental');
    await sweep.page.handler(ctx, replacement);
    assert.equal(tasks.length, 1, 'the replacement makes progress');
  } finally { Date.now = realNow; }
  console.log('PASS Didit sweep: bounded pages, global fairness, single flight, revalidation and stalled-run recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
