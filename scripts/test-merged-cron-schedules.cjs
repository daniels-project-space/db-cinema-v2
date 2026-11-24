const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const jobs = load('convex/crons.ts').default.crons;
const names = Object.values(jobs).map(job => job.name);
assert.equal(new Set(names).size, names.length, 'A handler must not be scheduled twice');
for (const [job, reference, interval] of [
  ['schedule-rental-chat-reminders', 'rentalChatReminders.backfill', { hours: 1, type: 'interval' }],
  ['recover-rental-chat-reminders', 'rentalChatReminders.recover', { minutes: 2, type: 'interval' }],
  ['purge-rental-chat-reminder-metadata', 'rentalChatReminders.purgeMetadata', { hours: 24, type: 'interval' }],
  ['admin-push-recovery', 'adminPushDelivery.retryDue', { minutes: 2, type: 'interval' }],
  ['rental-email-provider-status', 'rentalEmailDelivery.checkProviderDue', { minutes: 5, type: 'interval' }],
]) {
  assert.equal(jobs[job]?.name, reference);
  assert.deepEqual(jobs[job].schedule, interval);
  const [file, handler] = reference.split('.');
  assert.equal(typeof load(`convex/${file}.ts`)[handler]?.handler, 'function', `${reference} must be registered`);
}
console.log('PASS merged schedules: unique handlers, reminder recovery, admin push and provider checks.');
