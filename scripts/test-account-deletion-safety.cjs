const assert = require('node:assert/strict');
const {load, db, put, docs} = require('./lib/rentalTestHarness.cjs');
const {deleteAccount} = load('convex/accounts.ts');
const ctx = {db};

function account(extra = {}) {
  const value = put('accounts', {email: `deletion-${Math.random()}@example.invalid`, ...extra});
  const session = put('sessions', {accountId: value._id, token: `token-${value._id}`, expiresAt: Date.now() + 60_000});
  return {value, session, remove: () => deleteAccount.handler(ctx, {token: session.token})};
}

(async () => {
  const subscribed = account({stripeSubscriptionId: 'sub_test'});
  await assert.rejects(subscribed.remove(), /subscription.*cancelled/i);
  assert.ok(docs.has(subscribed.value._id));
  assert.ok(docs.has(subscribed.session._id));

  for (const table of ['bookings', 'verification_archives', 'credits', 'chat_threads', 'rental_damage_cases', 'chat_attachment_attempts', 'account_admin_notes', 'account_admin_changes']) {
    const renter = account();
    put(table, {accountId: renter.value._id});
    await assert.rejects(renter.remove(), /contact the team.*request deletion/i, table);
    assert.ok(docs.has(renter.value._id), `${table} retains account for review`);
  }
  const guestRenter = account();
  put('bookings', {guestEmail: guestRenter.value.email});
  await assert.rejects(guestRenter.remove(), /contact the team/i);
  const formerlyRestricted = account({lastRestrictedAt: Date.now() - 1000});
  await assert.rejects(formerlyRestricted.remove(), /contact the team/i);

  const uploading = account();
  const upload = put('avatar_upload_ledger', {accountId: uploading.value._id});
  await assert.rejects(uploading.remove(), /photo.*processed/i, 'Pending private uploads must not be orphaned by account deletion');
  assert.ok(docs.has(uploading.value._id));
  assert.ok(docs.has(upload._id));

  const sharedPhoto = account({avatarStorageId: 'shared-storage', avatarOwnedStorageId: 'shared-storage'});
  const legacyReference = account({avatarStorageId: 'shared-storage'});
  await assert.rejects(sharedPhoto.remove(), /safely review your profile photo/i, 'A shared legacy photo cannot be deleted from another account');
  assert.ok(docs.has(sharedPhoto.value._id));
  assert.ok(docs.has(legacyReference.value._id));

  const clean = account();
  const other = account();
  const link = put('account_access_links', {accountId: clean.value._id});
  const device = put('renter_push_subscriptions', {accountId: clean.value._id, sessionId: clean.session._id});
  const orphanDevice = put('renter_push_subscriptions', {accountId: clean.value._id, sessionId: 'expired-session'});
  await clean.remove();
  for (const entry of [clean.value, clean.session, link, device, orphanDevice]) assert.equal(docs.has(entry._id), false);
  assert.ok(docs.has(other.value._id));
  assert.ok(docs.has(other.session._id));
  console.log('Account deletion safeguards passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
