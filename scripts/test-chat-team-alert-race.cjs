const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const rentalChat = load('convex/rentalChat.ts');
const { acknowledgeConversationBatch } = load('convex/adminNotifications.ts');
const { postRentalMessage } = load('convex/lib/rentalChat.ts');
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
process.env.ADMIN_TOKEN = 'synthetic-team-admin';

async function exercise(action) {
  const account = put('accounts', { email: `${action}@example.invalid` });
  put('chat_threads', { accountId: account._id, escalated: false, updatedAt: Date.now() + 30000 });
  const previous = put('messages', { accountId: account._id, sender: 'renter', text: 'Earlier message', at: Date.now() + 29999 });
  const priorAlerts = Array.from({ length: 125 }, () => put('admin_notifications', { eventKey: `renter-message:${previous._id}`, kind: 'renter_message', accountId: account._id, title: 'Test', body: 'Test', createdAt: Date.now(), read: false }));
  if (action === 'sendOwner') await rentalChat.sendOwner.handler(ctx, { token: 'synthetic-team-admin', accountId: account._id, text: 'Team reply' });
  else await rentalChat.setHandler.handler(ctx, { token: 'synthetic-team-admin', accountId: account._id, gaffer: false });
  const newId = await postRentalMessage(ctx, { accountId: account._id, sender: 'renter', text: 'A later message' });
  const laterAlert = (await db.query('admin_notifications').withIndex('by_event', query => query.eq('eventKey', `renter-message:${newId}`)).first());
  const batches = scheduled.splice(0).filter(entry => entry[1] === 'adminNotifications.acknowledgeConversationBatch');
  assert(batches.length, 'the old alert backlog must schedule a continuation');
  while (batches.length) {
    await acknowledgeConversationBatch.handler(ctx, batches.shift()[2]);
    for (const entry of scheduled.splice(0)) if (entry[1] === 'adminNotifications.acknowledgeConversationBatch') batches.push(entry);
  }
  assert.equal(priorAlerts.filter(alert => alert.read).length, 125, `${action} must clear its earlier alerts`);
  assert.equal(laterAlert.read, false, `${action} must not clear the later message`);
}

(async () => {
  await exercise('sendOwner');
  await exercise('setHandler');
  console.log('PASS team reply and handler-change alert races: delayed batches preserve later messages.');
})().catch(error => { console.error(error); process.exitCode = 1; });
