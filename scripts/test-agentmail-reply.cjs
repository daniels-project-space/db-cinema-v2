const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const { sendBusinessReply } = load('convex/emailMailer.ts');
process.env.AGENTMAIL_API_KEY = 'fixture-key';
process.env.AGENTMAIL_INBOX_ADDRESS = 'booking@agentmail.to';
const args = { deliveryKey: 'email-auto:fixture', agentMailMessageId: '<inbound@example.invalid>', to: 'customer@example.invalid',
  subject: 'Re: booking', html: '<p>Here to help.</p>', replyTo: 'elsewhere@example.invalid', cc: ['owner@example.invalid'], references: [] };
let requests = [];
global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ message_id: '<reply@example.invalid>' }) }; };
(async () => {
  const result = await sendBusinessReply.handler({}, args);
  assert.deepEqual(result, { sent: true, messageId: '<reply@example.invalid>' });
  assert.match(requests[0].url, /inboxes\/booking%40agentmail\.to\/messages\/%3Cinbound%40example\.invalid%3E\/reply$/);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.to, 'customer@example.invalid');
  assert.deepEqual(body.cc, ['owner@example.invalid']);
  assert.equal(body.reply_to, 'booking@agentmail.to');
  assert.match(requests[0].options.headers['idempotency-key'], /^[a-f0-9]{64}$/);
  global.fetch = async () => ({ ok: false });
  assert.deepEqual(await sendBusinessReply.handler({}, args), { sent: false }, 'failed AgentMail sends must not silently switch providers');
  delete process.env.AGENTMAIL_API_KEY;
  assert.deepEqual(await sendBusinessReply.handler({}, args), { sent: false });
  console.log('PASS AgentMail reply addressing, idempotency and failure handling; synthetic transport.');
})().catch(error => { console.error(error); process.exitCode = 1; });
