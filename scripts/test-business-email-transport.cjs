const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const h = require('./lib/rentalTestHarness.cjs');

delete process.env.SUPPORT_EMAIL_FROM;

const action = h.load('convex/emailMailer.ts').sendBusinessReply;
const args = {
  deliveryKey: 'fixture-key',
  to: 'renter@example.invalid',
  subject: 'Re: rental',
  html: 'Hello',
  replyTo: ['replies@example.invalid', 'owner@example.invalid'],
  inReplyTo: '<incoming@example.invalid>',
  references: ['<incoming@example.invalid>'],
};

(async () => {
  let dispatched;
  const ctx = {
    runAction: async (reference, payload) => {
      dispatched = { reference, payload };
      return { sent: true, providerId: 'gmail-provider-id' };
    },
  };

  const result = await action.handler(ctx, args);
  assert.ok(dispatched.reference, 'the mailer dispatches through the internal Gmail action');
  assert.deepEqual(dispatched.payload.mail, {
    deliveryKey: args.deliveryKey,
    from: 'Bookings <bookings@dbcinemarentals.com>',
    to: args.to,
    subject: args.subject,
    html: args.html,
    replyTo: args.replyTo,
    inReplyTo: args.inReplyTo,
    references: args.references,
  });

  const digest = createHash('sha256').update(args.deliveryKey).digest('hex');
  assert.deepEqual(result, {
    sent: true,
    messageId: '<rental-' + digest + '@dbcinemarentals.com>',
  });

  const unavailable = await action.handler({
    runAction: async () => ({ sent: false }),
  }, args);
  assert.deepEqual(unavailable, { sent: false });

  console.log('[business email] Gmail action dispatches support replies and honors delivery failures');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
