const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');
let providerCalls = 0, prompt;
setMock('@openrouter/ai-sdk-provider', { createOpenRouter: () => () => ({}) });
setMock('ai', { generateObject: async options => { providerCalls++; prompt = options.prompt; return { object: { answer: 'The address check is waiting.' } }; } });
const { answer } = load('convex/adminGaffer.ts');
const { ownerDraftContext } = load('convex/rentalChat.ts');
const { selectedRentalRequests } = load('convex/adminGafferRequests.ts');
const { checkoutEvidence } = load('convex/adminGafferPayment.ts');
const oldToken = process.env.ADMIN_TOKEN, oldKey = process.env.OPENROUTER_API_KEY, oldSessionFlag = process.env.ADMIN_SESSION_CUSTOMER_READ_V2, oldBillingFlag = process.env.ADMIN_SESSION_BILLING_PORTAL_V2;
process.env.ADMIN_TOKEN = 'admin-fixture'; process.env.OPENROUTER_API_KEY = 'provider-fixture';
const account = put('accounts', { email: 'first@example.invalid' });
const other = put('accounts', { email: 'other@example.invalid' });
const booking = put('bookings', { accountId: account._id, guestEmail: account.email, status: 'confirmed', total: 120, currency: 'gbp', checkoutPaidAt: 123456, checkoutExpectedAmountPence: 12000, checkoutPaymentAmountPence: 12000, checkoutPaymentCurrency: 'gbp', checkoutPaymentStatus: 'paid', stripePaymentIntentId: 'pi_PRIVATE' });
put('rental_change_requests', { accountId: account._id, bookingId: booking._id, kind: 'cancel', status: 'pending', detail: 'PRIVATE REQUEST NOTE' });
put('rental_change_requests', { accountId: other._id, bookingId: booking._id, kind: 'refund', status: 'pending', detail: 'FOREIGN PRIVATE NOTE' });
put('rental_change_requests', { accountId: account._id, bookingId: booking._id, kind: 'dates', status: 'declined', detail: 'DECLINED' });
put('booking_change_requests', { accountId: account._id, bookingId: booking._id, type: 'extend', status: 'awaiting_payment' });
let contextReads = 0;
const context = { db };
const ctx = { runQuery: async (ref, args) => {
  if (ref === 'rentalChat.ownerDraftContext') return ownerDraftContext.handler(context, args);
  if (ref === 'chat._gafferContext') {
    contextReads++;
    assert.equal(args.accountId, account._id); assert.equal(args.focusBookingId, booking._id);
    return { booking: { status: 'confirmed', verification: { checks: { address: 'waiting' } }, items: [{ title: 'Camera', qty: 1 }] },
      email: 'private@example.invalid', messages: [{ text: 'PRIVATE CHAT MESSAGE' }], location: 'PRIVATE PICKUP ADDRESS',
      membership: { active: false }, accountCredit: { available: 0 } };
  }
  if (ref === 'adminGafferRequests.selectedRentalRequests') return selectedRentalRequests.handler(context, args);
  if (ref === 'adminGafferPayment.checkoutEvidence') return checkoutEvidence.handler(context, args);
  throw Error(`Unexpected query ${ref}`);
} };
const args = { token: 'admin-fixture', accountId: account._id, bookingId: booking._id, question: 'What is the address verification status?' };
(async () => {
  await assert.rejects(answer.handler(ctx, { ...args, token: 'renter-token' }), /unauthorized/);
  await assert.rejects(answer.handler(ctx, { ...args, accountId: other._id }), /Conversation unavailable/);
  await assert.rejects(answer.handler(ctx, { ...args, question: '  ' }), /Ask a question/);
  assert.equal(contextReads, 0); assert.equal(providerCalls, 0, 'unauthorized or invalid requests never reach private facts or the model');
  await assert.rejects(selectedRentalRequests.handler(context, { token: 'renter-token', accountId: account._id, bookingId: booking._id }), /unauthorized/);
  await assert.rejects(selectedRentalRequests.handler(context, { token: 'admin-fixture', accountId: other._id, bookingId: booking._id }), /Conversation unavailable/);
  await assert.rejects(checkoutEvidence.handler(context, { token: 'renter-token', accountId: account._id, bookingId: booking._id }), /unauthorized/);
  await assert.rejects(checkoutEvidence.handler(context, { token: 'admin-fixture', accountId: other._id, bookingId: booking._id }), /Conversation unavailable/);
  const result = await answer.handler(ctx, args);
  assert.equal(result.answer, 'The address check is waiting.'); assert(Number.isSafeInteger(result.checkedAt));
  assert.equal(contextReads, 1); assert.equal(providerCalls, 1);
  const sent = JSON.parse(prompt);
  assert.equal(sent.rental.verification.checks.address, 'waiting');
  assert.equal(sent.rental.items[0].title, 'Camera');
  assert.deepEqual(sent.rental.requests.renterRequests, [{ kind: 'cancel', status: 'pending', execution: null }]);
  assert.deepEqual(sent.rental.requests.bookingChanges, [{ type: 'extend', status: 'awaiting_payment' }]);
  assert.equal(sent.rental.requests.incomplete, false);
  assert.deepEqual(sent.rental.checkoutEvidence, { state: 'recorded_checkout_evidence', recordedAt: 123456, recordedCardAmountPence: 12000, currency: 'GBP', source: 'saved_booking_record', currentProviderStatusChecked: false });
  assert(!prompt.includes('pi_PRIVATE'), 'provider identifiers never leave the application');
  await db.patch(booking._id, { checkoutPaymentAmountPence: 1000 });
  assert.equal((await checkoutEvidence.handler(context, { token: 'admin-fixture', accountId: account._id, bookingId: booking._id })).state, 'not_established', 'a mismatch is not proof of payment or proof of failure');
  process.env.ADMIN_SESSION_BILLING_PORTAL_V2 = 'enabled';
  await assert.rejects(checkoutEvidence.handler(context, { token: 'admin-fixture', accountId: account._id, bookingId: booking._id }), /migration is not ready/);
  delete process.env.ADMIN_SESSION_BILLING_PORTAL_V2;
  assert(!prompt.includes('PRIVATE REQUEST NOTE')); assert(!prompt.includes('FOREIGN PRIVATE NOTE'));
  for (let index = 0; index < 26; index++) put('rental_change_requests', { accountId: account._id, bookingId: booking._id, kind: 'dates', status: 'declined' });
  assert.equal((await selectedRentalRequests.handler(context, { token: 'admin-fixture', accountId: account._id, bookingId: booking._id })).incomplete, true, 'bounded history is never represented as complete');
  process.env.ADMIN_SESSION_CUSTOMER_READ_V2 = 'enabled';
  await assert.rejects(selectedRentalRequests.handler(context, { token: 'admin-fixture', accountId: account._id, bookingId: booking._id }), /migration is not ready/);
  delete process.env.ADMIN_SESSION_CUSTOMER_READ_V2;
  assert(!prompt.includes('PRIVATE CHAT MESSAGE')); assert(!prompt.includes('private@example.invalid'));
  assert(!prompt.includes('PRIVATE PICKUP ADDRESS')); assert(!prompt.includes('admin-fixture'));
  assert.equal(ctx.runMutation, undefined, 'the assistant has no mutation caller');
  console.log('PASS private admin Gaffer: admin-only scope, foreign-account denial, live selected-rental facts, minimal provider context and read-only operation. Synthetic provider only.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (oldToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = oldToken;
  if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
  if (oldSessionFlag === undefined) delete process.env.ADMIN_SESSION_CUSTOMER_READ_V2; else process.env.ADMIN_SESSION_CUSTOMER_READ_V2 = oldSessionFlag;
  if (oldBillingFlag === undefined) delete process.env.ADMIN_SESSION_BILLING_PORTAL_V2; else process.env.ADMIN_SESSION_BILLING_PORTAL_V2 = oldBillingFlag;
});
