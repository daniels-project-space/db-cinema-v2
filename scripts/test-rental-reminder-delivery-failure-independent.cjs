const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const reminders = load('convex/rentalChatReminders.ts');
const { londonRentalInstant } = load('shared/rentalWindow.ts');
const jobs = [];
const ctx = { db, scheduler: { runAfter: async (delay, ref, args) => jobs.push({ delay, ref, args }) } };
const originalNow = Date.now;
const originalGet = db.get;
const day = Date.UTC(2032, 8, 1);
const pickup = londonRentalInstant(day, '10:00');
let now = pickup - 7200000;
Date.now = () => now;

(async () => {
  try {
    const account = put('accounts', { email: 'delivery@example.invalid', emailVerifiedAt: now - 10000 });
    const base = { accountId: account._id, guestEmail: account.email, status: 'confirmed', fulfilment: 'pickup', paidConfirmedAt: now - 10000, verificationProvider: 'didit', idVerificationSource: 'didit', idVerifyStatus: 'verified', idVerifiedAt: now - 10000, verificationChecks: { identity: 'approved', selfie: 'approved', address: 'approved' }, lineItems: [{ listingId: 'camera', title: 'Camera', qty: 1, start: day, end: day + 86400000, pickupTime: '10:00', returnTime: '18:00' }] };
    const poison = put('bookings', base);
    const good = put('bookings', base);
    await reminders.scheduleRentalChatReminders(ctx, poison);
    await reminders.scheduleRentalChatReminders(ctx, good);
    const rows = tables.get('rental_chat_reminders');
    const failed = rows.find(row => row.bookingId === poison._id && row.kind === 'pickup');
    const healthy = rows.find(row => row.bookingId === good._id && row.kind === 'pickup');
    assert(failed && healthy);
    jobs.length = 0;
    now = failed.dueAt;
    db.get = async id => { if (id === poison._id) throw new Error('injected delivery read failure'); return originalGet(id); };
    for (let attempt = 0; attempt < 3; attempt++) {
      await reminders.recover.handler(ctx, {});
      const dispatches = jobs.splice(0).filter(job => job.delay === 0 && job.ref === 'rentalChatReminders.deliver');
      for (const job of dispatches) {
        try { await reminders.deliver.handler(ctx, job.args); } catch (error) { assert.match(error.message, /injected delivery/); }
      }
      if (attempt === 0) assert.equal(healthy.state, 'sent', 'healthy delivery is not blocked by a poisoned occurrence');
      now += 30000;
    }
    await reminders.recover.handler(ctx, {});
    assert.equal(failed.state, 'failed', 'poisoned delivery stops after three attempts');
    const reports = jobs.filter(job => job.ref === 'rentalChatReminders.reportFailure');
    assert.equal(reports.length, 1, 'one terminal delivery report is scheduled');
    assert(!JSON.stringify(reports).includes('injected delivery read failure'));
    db.get = originalGet;
    await reminders.deliver.handler(ctx, { reminderId: healthy._id });
    await reminders.deliver.handler(ctx, { reminderId: failed._id });
    await reminders.recover.handler(ctx, {});
    const messages = (tables.get('messages') ?? []).filter(message => message.meta?.kind === 'rental_chat_reminder');
    assert.equal(messages.length, 1, 'replayed successful and failed deliveries do not duplicate or send');
    assert.equal(messages[0].bookingId, good._id);
    assert.equal(jobs.filter(job => job.ref === 'rentalChatReminders.reportFailure').length, 1);
    console.log('PASS independent delivery failure: healthy peer, bounded retries, alert and replay.');
  } finally { Date.now = originalNow; db.get = originalGet; }
})().catch(error => { console.error(error); process.exitCode = 1; });
