const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const sweep = load('convex/diditSweep.ts');
const bookings = load('convex/bookings.ts');

(async () => {
  const tasks = [];
  const ctx = { db, scheduler: { runAfter: async (_delay, ref, args) => tasks.push({ ref, args }) } };
  const missing=put('bookings',{verificationProvider:'didit',status:'confirmed',diditSessionId:'missing-contact-session'});
  for (let index = 0; index < 240; index++) put('bookings', {
    verificationProvider: 'didit', status: 'confirmed', guestEmail: 'test@example.invalid',
  });
  const eligible = Array.from({ length: 125 }, (_, index) => put('bookings', {
    verificationProvider: 'didit', status: index % 2 ? 'active' : 'confirmed',
    guestEmail: 'test@example.invalid', diditSessionId: `session-${index}`, diditReconciledAt: 125 - index,
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
  assert.ok(pages >= 5, 'each status stream is scanned in bounded pages');
  assert.equal(tasks.length, 1);
  assert.ok((tables.get('admin_notifications')??[]).some(row=>row.bookingId===missing._id&&row.kind==='verification_failure'),'a bound session with no email produces a durable repair alert');
  assert.equal(tasks[0].ref, 'didit.reconcileOpenSessions');
  const generation = tasks.shift().args.generation;
  await sweep.configurationFailure.handler(ctx, { generation });
  assert.ok((tables.get('admin_notifications') ?? []).some(row => row.title === 'Verification configuration needs attention' && !row.accountId), 'configuration incidents are stored without requiring an account');
  const batch = await sweep.batch.handler(ctx, { generation });
  assert.equal(batch.length, 50, 'provider reads stay capped at 50 per sweep');
  assert.deepEqual(batch.map(row => row.bookingId), eligible.slice(75).reverse().map(row => row._id),
    'the globally oldest eligible sessions win even after many ineligible rows and across both statuses');
  eligible[124].diditReconciledAt++;
  eligible[123].status = 'returned';
  assert.equal((await sweep.batch.handler(ctx, { generation })).length, 48, 'changed candidates are revalidated before provider calls');
  const protectedRental = eligible[122];
  protectedRental.diditEventId = 'newer-webhook';protectedRental.diditEventAt = 42;
  assert.equal(await bookings.setDiditResult.handler(ctx, { bookingId: protectedRental._id, sessionId: protectedRental.diditSessionId, eventId: 'stale-read', status: 'verified', eventAt: 43, poaPostcodes: [], sweepGeneration: generation, expectedEventId: null, expectedEventAt: null, expectedManualDecisionAt: null }), true);
  assert.equal(protectedRental.diditEventId, 'newer-webhook', 'an in-flight provider read cannot overwrite a newer webhook even with a later response timestamp');
  await sweep.finish.handler(ctx, { generation: generation - 1 });
  assert.equal((tables.get('didit_reconcile_sweeps') ?? [])[0].phase, 'dispatch', 'stale runs cannot finish a newer sweep');
  await sweep.finish.handler(ctx, { generation });
  assert.equal((await sweep.batch.handler(ctx, { generation })).length, 0);
  missing.guestEmail='repaired@example.invalid';

  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await sweep.start.handler(ctx, {});
    const stale = tasks.shift().args;
    await sweep.page.handler(ctx, stale);
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
