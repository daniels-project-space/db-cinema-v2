const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const reminders = load('convex/rentalChatReminders.ts');
const jobs = [];
const ctx = { db, scheduler: { runAfter: async (delay, ref, args) => jobs.push({ delay, ref, args }) } };
const originalNow = Date.now;
let now = Date.UTC(2032, 8, 1);
Date.now = () => now;

(async () => {
  try {
    const poison = put('bookings', { status: 'confirmed' });
    const good = put('bookings', { status: 'confirmed' });
    const failedPlan = put('rental_chat_reminder_plans', { bookingId: poison._id, state: 'pending', recoverAt: now, attempts: 0 });
    const goodPlan = put('rental_chat_reminder_plans', { bookingId: good._id, state: 'pending', recoverAt: now, attempts: 0 });
    const originalGet = db.get;
    db.get = async id => { if (id === poison._id) throw new Error('injected booking read failure'); return originalGet(id); };
    for (let attempt = 0; attempt < 3; attempt++) {
      await reminders.recover.handler(ctx, {});
      const run = jobs.splice(0).filter(job => job.ref === 'rentalChatReminders.executePlan');
      for (const job of run) {
        try { await reminders.executePlan.handler(ctx, job.args); } catch (error) { assert.match(error.message, /injected/); }
      }
      if (attempt === 0) assert.equal(goodPlan.state, 'done', 'healthy peer progresses despite poisoned plan');
      now += 30000;
    }
    await reminders.recover.handler(ctx, {});
    assert.equal(failedPlan.state, 'failed', 'poisoned plan becomes actionable after three bounded attempts');
    const failureReports = jobs.filter(job => job.ref === 'rentalChatReminders.reportFailure');
    assert.equal(failureReports.length, 1, 'one terminal report is scheduled');
    assert(!JSON.stringify(failureReports).includes('injected booking read failure'), 'provider details are not exposed in report arguments');
    db.get = originalGet;
    await reminders.executePlan.handler(ctx, { planId: goodPlan._id });
    assert.equal(goodPlan.state, 'done', 'completed plan replay is harmless');
    await reminders.recover.handler(ctx, {});
    assert.equal(jobs.filter(job => job.ref === 'rentalChatReminders.reportFailure').length, 1, 'recovery replay does not schedule another terminal report');
    assert.equal((tables.get('messages') ?? []).length, 0);
    console.log('PASS independent failure injection: isolated plan, healthy peer, three retries, terminal alert and replay.');
  } finally { Date.now = originalNow; }
})().catch(error => { console.error(error); process.exitCode = 1; });
