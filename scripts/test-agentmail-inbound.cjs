const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');

process.env.INBOUND_EMAIL_SECRET = 'fixture-inbound';
process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.invalid';
process.env.AGENTMAIL_INBOX_ADDRESS = 'booking@agentmail.to';
process.env.AGENTMAIL_WEBHOOK_SECRET = 'whsec_' + Buffer.from('fixture-key').toString('base64');
let received = [], replies = [];
class FixtureClient {
  async mutation(name, args) {
    if (name === 'emailInbox.ingest') { received.push(args); return { inboundId: 'inbound', threadId: 'thread' }; }
    if (name === 'emailInbox.claimInbound') return { state: 'claimed', history: [{ role: 'user', content: 'Can you help?' }] };
    throw Error(`Unexpected mutation ${name}`);
  }
  async action(name, args) {
    if (name === 'emailInbox.sendAssistantReply') { replies.push(args); return { ok: true }; }
    throw Error(`Unexpected action ${name}`);
  }
}
setMock('convex/browser', { ConvexHttpClient: FixtureClient });
setMock('@/lib/gaffer', { handleChat: async () => ({ reply: 'We can help.', cards: [], humanRequested: false }) });
setMock('@/lib/site', { CONTACT_EMAIL: 'support@example.invalid' });
setMock('@/lib/inboundEmail', load('src/lib/inboundEmail.ts'));
const route = load('src/app/api/email/inbound/route.ts');
const event = { event_type: 'message.received', event_id: 'event-1', message: {
  inbox_id: 'booking@agentmail.to', message_id: '<message@example.invalid>', from: 'Customer <customer@example.invalid>',
  subject: 'Rental enquiry', extracted_text: 'Can you help?', references: [], headers: {},
} };
async function deliver(value, signed = true) {
  const raw = JSON.stringify(value), id = 'fixture', timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from('fixture-key')).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return route.POST({ nextUrl: new URL('https://example.invalid/api/email/inbound'), headers: new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signed ? signature : 'invalid'}` }), text: async () => raw });
}
(async () => {
  assert.equal((await deliver(event, false)).status, 401);
  assert.equal(received.length, 0);
  assert.equal((await deliver({ ...event, message: { ...event.message, inbox_id: 'other@agentmail.to' } })).status, 400);
  assert.equal((await deliver({ ...event, message: { ...event.message, headers: { 'auto-submitted': 'auto-replied' } } })).status, 200);
  assert.equal(received.length, 0);
  assert.equal((await deliver(event)).status, 200);
  assert.equal(received[0].providerId, 'agentmail:<message@example.invalid>');
  assert.equal(received[0].from, 'customer@example.invalid');
  assert.equal(received[0].to, 'booking@agentmail.to');
  assert.equal(replies.length, 1);
  process.env.AGENTMAIL_API_KEY = 'fixture-key';
  global.fetch = async () => ({ ok: true, json: async () => event.message });
  assert.equal((await deliver({ ...event, message: { ...event.message, extracted_text: undefined } })).status, 200);
  assert.equal(received.length, 2, 'a signed notification with no body fetches the matching provider message');
  global.fetch = async () => ({ ok: true, json: async () => ({ ...event.message, inbox_id: 'other@agentmail.to' }) });
  assert.equal((await deliver({ ...event, message: { ...event.message, extracted_text: undefined } })).status, 400);
  assert.equal(received.length, 2, 'a mismatched retrieved message must not be processed');
  console.log('PASS authenticated AgentMail webhook, inbox binding, automation filtering and Gaffer dispatch; synthetic transport.');
})().catch(error => { console.error(error); process.exitCode = 1; });
