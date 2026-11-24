const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');

const chat = load('convex/chat.ts');
const ctx = { db, scheduler: { runAfter: async () => 'scheduled' } };

async function fixture(suffix) {
  const now = Date.now();
  const account = put('accounts', { email: `${suffix}@example.invalid` });
  const booking = put('bookings', { accountId: account._id, guestEmail: account.email });
  const token = `token-${suffix}`;
  put('sessions', { token, accountId: account._id, expiresAt: now + 60_000 });
  for (let index = 0; index < 31; index++) {
    put('messages', { accountId: account._id, sender: 'bot', text: 'Reply', at: now - 20_000 + index });
  }
  for (let index = 0; index < 6; index++) {
    put('messages', { accountId: account._id, bookingId: booking._id, sender: 'renter', text: `Question ${index}`, at: now - 10_000 + index });
  }
  return { token, booking };
}

(async () => {
  const rental = await fixture('rental');
  await assert.rejects(chat.send.handler(ctx, { token: rental.token, bookingId: rental.booking._id, text: 'Another question' }), /too fast/);
  const support = await fixture('support');
  await assert.rejects(chat.recordGafferUserMessage.handler(ctx, { token: support.token, text: 'Another question', requestId: 'support-rate-limit-test-0001' }), /too fast/);
  const now = Date.now();
  const account = put('accounts', { email: 'retry@example.invalid' });
  put('sessions', { token: 'retry-token', accountId: account._id, expiresAt: now + 60_000 });
  put('messages', { accountId: account._id, sender: 'renter', text: 'Old question', at: now - 31_000 });
  for (let index = 0; index < 5; index++) {
    put('messages', { accountId: account._id, sender: 'renter', text: `Question ${index}`, at: now - 1_000 + index });
  }
  const args = { token: 'retry-token', text: 'Last allowed question', requestId: 'support-rate-limit-retry-0001' };
  const sent = await chat.recordGafferUserMessage.handler(ctx, args);
  const retried = await chat.recordGafferUserMessage.handler(ctx, args);
  assert.equal(retried.messageId, sent.messageId);
  assert.equal(retried.duplicate, true);
  await assert.rejects(chat.send.handler(ctx, { token: 'retry-token', text: 'One too many' }), /too fast/);
  console.log('PASS account-wide chat rate limit across conversations and mixed message traffic.');
})().catch(error => { console.error(error); process.exitCode = 1; });
