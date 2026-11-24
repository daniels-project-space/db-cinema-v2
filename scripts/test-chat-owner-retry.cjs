const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const rentalChat = load('convex/rentalChat.ts');
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => { scheduled.push(args); return 'scheduled'; } } };
process.env.ADMIN_TOKEN = 'synthetic-team-admin';

(async () => {
  const account = put('accounts', { email: 'owner-retry@example.invalid' });
  const args = { token: 'synthetic-team-admin', accountId: account._id, text: 'Your booking is ready.', requestId: 'owner-chat-retry-test-0001' };
  await rentalChat.sendOwner.handler(ctx, args);
  const initialSchedules = scheduled.length;
  await rentalChat.sendOwner.handler(ctx, args);
  assert.equal((tables.get('messages') ?? []).filter(row => row.accountId === account._id && row.sender === 'owner').length, 1);
  assert.equal(scheduled.length, initialSchedules, 'A retry must not schedule a duplicate notification');
  await assert.rejects(rentalChat.sendOwner.handler(ctx, { ...args, text: 'A different message' }), /retry/);
  console.log('PASS admin chat reply retry deduplication.');
})().catch(error => { console.error(error); process.exitCode = 1; });
