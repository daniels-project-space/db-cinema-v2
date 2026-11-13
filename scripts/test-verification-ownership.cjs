const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const claims = load('convex/accountClaims.ts');
const archive = load('convex/verificationArchive.ts');
const { linkVerificationCopies } = load('convex/lib/verificationOwnership.ts');
const { agreementsForSecurityPolicy } = load('src/lib/legal.ts');
const { IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION } = load('shared/rentalSecurity.ts');
const acceptedDocuments = agreementsForSecurityPolicy(IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION);
function attachAcceptedAccountTerms(booking, acceptedAt = Date.now()) {
  booking.agreementSignedAt = acceptedAt;
  booking.agreementDocs = acceptedDocuments.map(({kind,version}) => ({kind,version}));
  booking.agreementSnapshot = JSON.stringify({
    format: 1,
    version: acceptedDocuments.find(doc => doc.kind === 'rental-agreement').version,
    acceptedAt,
    signer: booking.agreementName,
    documents: acceptedDocuments.map(doc => ({...doc,text:{title:doc.title,updated:'November 2026',sections:[]}})),
    particulars: {timeZone:'Europe/London',lineItems:[]},
  });
  return acceptedAt;
}
process.env.ADMIN_TOKEN = 'ownership-test';

(async () => {
  const scheduled = [];
  const ctx = { db, storage:{delete:async()=>{}},scheduler: { runAfter: async (_delay, ref, args) => scheduled.push({ ref, args }) } };
  const booking = put('bookings', { status: 'pending_payment', guestEmail: 'late-account@example.invalid', guestName: 'Rental customer', agreementName:'Rental Customer', diditSessionId: 'pre-account-session' });
  const signedAt=attachAcceptedAccountTerms(booking);
  await archive.queueVerificationArchive(ctx, booking);
  const saved = tables.get('verification_archives')[0];
  assert.equal(saved.accountId, undefined);
  const lease=await archive.claim.handler(ctx,{archiveId:saved._id});
  const identityHash='a'.repeat(64),addressHash='b'.repeat(64);
  put('_storage',{_id:'owned-file',sha256:identityHash,size:100,contentType:'image/jpeg'});
  put('_storage',{_id:'owned-address',sha256:addressHash,size:90,contentType:'image/png'});
  await archive.save.handler(ctx, { archiveId: saved._id,generation:lease.generation, kind: 'identity-0-front_image', storageId: 'owned-file', sha256: identityHash, size: 100, contentType: 'image/jpeg' });
  await archive.save.handler(ctx, { archiveId: saved._id,generation:lease.generation, kind: 'address-0', storageId: 'owned-address', sha256: addressHash, size: 90, contentType: 'image/png' });
  await archive.finish.handler(ctx, { archiveId: saved._id,generation:lease.generation, complete: true });
  const copy = tables.get('verification_documents')[0];
  assert.equal(copy.accountId, undefined);
  assert.equal(await claims.ensurePaidBookingAccount(ctx, booking), null, 'Unpaid rentals cannot acquire an account');
  await db.patch(booking._id, { status: 'confirmed' });
  const account = await claims.ensurePaidBookingAccount(ctx, booking);
  assert.equal(account.accountTermsVersion,acceptedDocuments.find(doc=>doc.kind==='terms').version,'Auto-created paid-booking account stores the exact accepted Terms version');
  assert.equal(account.accountTermsAcceptedAt,signedAt,'Terms acceptance time comes from the signed booking');
  assert.equal(account.privacyNoticeVersion,acceptedDocuments.find(doc=>doc.kind==='privacy').version,'Auto-created paid-booking account stores the exact accepted Privacy Notice version');
  assert.equal(account.privacyNoticeAcknowledgedAt,signedAt,'Privacy acknowledgement time comes from the signed booking');
  assert.equal(saved.accountId, account._id, 'Paid account creation attaches an earlier archive');
  assert.equal(copy.accountId, account._id, 'Earlier document metadata follows the same owner');
  assert.equal(saved.status, 'complete');
  assert.equal(copy.storageId, 'owned-file');
  assert.equal(copy.sha256, identityHash);
  assert.equal((await archive.accountDocuments.handler(ctx, { token: 'ownership-test', accountId: account._id }))[0].documents[0].id, copy._id, 'Existing copies become visible through the actual account query');
  await db.patch(account._id,{accountTermsVersion:'pre-existing-terms',accountTermsAcceptedAt:signedAt-1234,privacyNoticeVersion:'pre-existing-privacy',privacyNoticeAcknowledgedAt:signedAt-1234});
  await claims.ensurePaidBookingAccount(ctx, booking);
  assert.equal(account.accountTermsVersion,'pre-existing-terms','A retry never overwrites an existing account Terms acceptance');
  assert.equal(account.privacyNoticeVersion,'pre-existing-privacy','A retry never overwrites an existing account Privacy Notice acceptance');
  assert.equal(tables.get('verification_archives').length, 1, 'Payment replay creates no extra archive');
  await archive.queueVerificationArchive(ctx,booking);assert.equal(saved.status,'complete','a routine check does not reopen a complete archive');await archive.queueVerificationArchive(ctx,booking,true);const lateLease=await archive.claim.handler(ctx,{archiveId:saved._id});
  await archive.save.handler(ctx, { archiveId: saved._id,generation:lateLease.generation, kind: 'address-0', storageId: 'late-worker-file', sha256: 'late-worker-hash', size: 90, contentType: 'image/png' });
  assert.equal(tables.get('verification_documents').find(document=>document.storageId==='late-worker-file').accountId, account._id, 'A capture finishing after account creation uses current archive ownership');

  // Historical account-linked rentals may still contain unlinked archives.
  const old = put('bookings', { status: 'active', accountId: account._id, guestEmail: 'old-mailbox@example.invalid', diditSessionId: 'old-linked-session' });
  const oldArchive = put('verification_archives', { bookingId: old._id, sessionId: old.diditSessionId, status: 'pending', attempts: 0 });
  const oldCopy = put('verification_documents', { archiveId: oldArchive._id, bookingId: old._id, sessionId: old.diditSessionId, storageId: 'old-owned-file', sha256: 'old-hash' });
  await archive.queueVerificationArchive(ctx, old);
  assert.equal(oldArchive.accountId, account._id);
  assert.equal(oldCopy.accountId, account._id);
  assert.equal(oldArchive.status, 'pending');
  assert.equal(tables.get('verification_archives').length, 2);
  const mailboxOwner = put('accounts', { email: old.guestEmail });
  await assert.rejects(() => linkVerificationCopies(ctx, old._id, mailboxOwner._id), /do not belong/);
  assert.equal(oldArchive.accountId, account._id, 'Reused email cannot take permanently owned copies');

  const malformed = put('bookings', { status: 'active', accountId: account._id });
  const unlinked = put('verification_archives', { bookingId: malformed._id, sessionId: 'malformed', status: 'complete' });
  const foreignCopy = put('verification_documents', { archiveId: unlinked._id, bookingId: malformed._id, sessionId: unlinked.sessionId, accountId: mailboxOwner._id });
  await assert.rejects(() => linkVerificationCopies(ctx, malformed._id, account._id), /owner or rental binding/);
  assert.equal(unlinked.accountId, undefined, 'A conflicting copy prevents partial archive repair');
  assert.equal(foreignCopy.accountId, mailboxOwner._id);

  const missingConsent=put('bookings',{status:'confirmed',guestEmail:'missing-consent@example.invalid',agreementName:'Missing Consent'});
  assert.equal(await claims.ensurePaidBookingAccount(ctx,missingConsent),null,'Missing signed account terms/privacy never bootstraps an account');
  assert.equal((tables.get('accounts')??[]).some(row=>row.email===missingConsent.guestEmail),false,'Missing consent leaves no orphan account');
  const staleConsent=put('bookings',{status:'confirmed',guestEmail:'stale-consent@example.invalid',agreementName:'Stale Consent'});
  attachAcceptedAccountTerms(staleConsent);
  const staleSnapshot=JSON.parse(staleConsent.agreementSnapshot);
  staleSnapshot.documents.find(doc=>doc.kind==='privacy').version='old-privacy-version';
  staleConsent.agreementSnapshot=JSON.stringify(staleSnapshot);
  assert.equal(await claims.ensurePaidBookingAccount(ctx,staleConsent),null,'A booking whose signed snapshot disagrees with its recorded versions cannot create an account');
  assert.equal((tables.get('accounts')??[]).some(row=>row.email===staleConsent.guestEmail),false,'Stale consent leaves no orphan account');
  foreignCopy.accountId = undefined; foreignCopy.sessionId = 'wrong-session';
  await assert.rejects(() => linkVerificationCopies(ctx, malformed._id, account._id), /owner or rental binding/);
  foreignCopy.sessionId = unlinked.sessionId; unlinked.accountId = mailboxOwner._id;
  await assert.rejects(() => linkVerificationCopies(ctx, malformed._id, account._id), /archive owner/);
  assert.equal(foreignCopy.accountId, undefined);
  const closed = put('bookings', { status: 'returned', accountId: account._id, returnedAt: Date.now() - 31 * 86400000 });
  const removed = put('verification_archives', { bookingId: closed._id, sessionId: 'removed-session', status: 'deleted', deletedAt: Date.now() });
  const removedAt = removed.deletedAt;
  await linkVerificationCopies(ctx, closed._id, account._id);
  assert.equal(removed.accountId, account._id, 'Deleted audit metadata can acquire its permanent owner');
  assert.equal(removed.status, 'deleted'); assert.equal(removed.deletedAt, removedAt, 'Ownership repair cannot restart retention or resurrect deleted bytes');
  console.log('PASS verification ownership: pre-account copies attach at paid creation, private query visibility, unchanged bytes/integrity, late worker completion, replay, historical repair and foreign owner/session rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
