const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const harness = require('./lib/rentalTestHarness.cjs');
global.crypto ??= webcrypto;
const { load, db, docs, put, setMock, tables } = harness;
const routes = [];
const sentMail = [];
setMock('convex/server', { ...require('convex/server'), httpRouter: () => ({ route: route => routes.push(route) }) });
setMock('./lib/mailer', {
  sendMail: async mail => { sentMail.push(mail); return true; },
  sendBusinessMailTracked: async mail => { sentMail.push(mail); return { sent: true, ambiguous: false, resendEmailId: 'synthetic-return-email' }; },
});
process.env.INVOICE_SECRET = 'synthetic-private-invoice-signing-secret';
process.env.APP_URL = 'https://completion.example.invalid';
process.env.CONVEX_SITE_URL = 'https://synthetic-deployment.convex.site';
process.env.INBOUND_REPLY_ADDRESS = 'support@example.invalid';
const bookings = load('convex/bookings.ts');
const invoice = load('convex/invoice.ts');
const emailInbox = load('convex/emailInbox.ts');
load('convex/http.ts');
const route = routes.find(entry => entry.path === '/return-evidence' && entry.method === 'GET');
const postRoute = routes.find(entry => entry.path === '/return-evidence' && entry.method === 'POST');
const now = Date.now();
const renterEmail = 'damage-renter@example.invalid';
const fileBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x28, 0x41, 0x42]);
const fileHash = createHash('sha256').update(fileBytes).digest('hex');
const marker = 'application/vnd.dbcinema.chat-0123456789abcdef0123456789abcdef';
const account = put('accounts', { email: renterEmail, name: 'Synthetic Renter' });
const returnedAt = now - 1000;
const statement = {
  number: 'DBC-R-EVIDENCE', issuedAt: now, actualReturnedAt: returnedAt,
  supplierName: 'DB Cinema Rentals', customerName: 'Synthetic Renter', customerEmail: renterEmail,
  lineItems: [], subtotal: 100, discount: 0, deliveryFee: 0, creditApplied: 0, checkoutPaid: 100,
  securityPaid: 0, securityRefunded: 0, damageTotal: 25, damageFromHold: 25,
  damageNote: 'Casing damage found at return.', lateAssessed: 0, lateWaived: 0, lateBreakdown: [],
};
const booking = put('bookings', { status: 'returned', accountId: account._id, guestEmail: renterEmail, depositHoldCapturedForDamage: 25, returnStatement: statement });
const attachment = put('chat_attachment_attempts', {
  status: 'published', accountId: account._id, bookingId: booking._id, admin: false,
  storageId: 'storage-evidence-1', messageId: 'messages-evidence-1', marker, sha256: fileHash,
  size: fileBytes.length, contentType: 'image/jpeg', name: 'front-panel.jpg',
});
const message = put('messages', { _id: attachment.messageId, accountId: account._id, bookingId: booking._id, meta: { attachmentId: attachment._id }, sender: 'renter' });
const metadata = put('_storage', { _id: attachment.storageId, size: fileBytes.length, contentType: marker, sha256: fileHash });
const caseRecord = put('rental_damage_cases', {
  bookingId: booking._id, accountId: account._id, itemKey: 'camera-body-1', title: 'Sony FX3',
  status: 'open', openedAt: returnedAt, requestId: `return-claim-${booking._id}-${returnedAt}-camera-body-1`,
  claimAmountPence: 2500, claimReason: 'Casing damage found at return.', claimBasis: 'severe_cosmetic_damage', claimEvidenceIds: [attachment._id],
});
put('chat_case_archives', { caseId: caseRecord._id, bookingId: booking._id, accountId: account._id, archivedAt: returnedAt });
booking.returnDecision = {
  actualReturnedAt: returnedAt, damageKept: 25, damageNote: statement.damageNote, claimBasis: 'severe_cosmetic_damage',
  claimItemKey: 'camera-body-1', claimEvidenceIds: [attachment._id], claimCaseId: caseRecord._id, chargeLate: false,
  inspection: [{ key: 'camera-body-1', title: 'Sony FX3', condition: 'damaged', details: statement.damageNote }],
};
let pdf;
global.fetch = async (url, options) => {
  assert.equal(url, `https://completion.example.invalid/api/invoice/${booking._id}?phase=return`);
  assert.equal(options.headers['x-invoice-key'], process.env.INVOICE_SECRET);
  return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
};
const ctx = {
  db,
  scheduler: { runAfter: async () => {} },
  storage: { get: async storageId => storageId === attachment.storageId ? new Blob([fileBytes]) : null },
  runMutation: async (ref, args) => {
    if (ref === 'emailInbox.prepareReturnStatementEmail') return emailInbox.prepareReturnStatementEmail.handler(ctx, args);
    if (ref === 'emailInbox.finishReturnStatementEmail') return emailInbox.finishReturnStatementEmail.handler(ctx, args);
    return bookings[ref.split('.')[1]].handler(ctx, args);
  },
  runQuery: async (ref, args) => bookings[ref.split('.')[1]].handler(ctx, args),
};

function request(url, init) { return new Request(url, init); }
function extractToken(html) {
  const match = html.match(/https:\/\/synthetic-deployment\.convex\.site\/return-evidence\?token=([A-Za-z0-9_.-]+)/);
  assert(match, 'return email contains a signed private evidence link');
  return match[1];
}

(async () => {
  const React = require('react');
  const { Document, Page, Text, renderToBuffer } = await import('@react-pdf/renderer');
  pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(Page, null, React.createElement(Text, null, 'Synthetic return statement.'))));
  const evidenceContext = await bookings.returnStatementEvidenceContext.handler({ db }, { bookingId: booking._id });
  assert.equal(evidenceContext.fileCount, 1);
  assert.equal(evidenceContext.caseId, caseRecord._id);
  assert.notEqual(evidenceContext.recipientHash, createHash('sha256').update(renterEmail.trim().toLowerCase()).digest('hex'), 'recipient email is keyed before entering the signed token');
  assert.equal(await bookings.returnEvidenceLinkFiles.handler({ db }, {
    bookingId: booking._id, caseId: caseRecord._id, expiresAt: evidenceContext.expiresAt, recipientHash: evidenceContext.recipientHash,
  }).then(value => value.files.length), 1);
  const issuedAt = statement.issuedAt;
  statement.issuedAt = Date.now() - 31 * 24 * 60 * 60_000;
  assert.equal(await bookings.returnStatementEvidenceContext.handler({ db }, { bookingId: booking._id }), null, 'expired evidence does not block or reopen access');
  statement.issuedAt = issuedAt;

  await invoice.returnSettlementEmail.handler(ctx, { bookingId: booking._id });
  assert.equal(booking.returnStatementEmailStatus, 'sent');
  const email = sentMail[0];
  assert.equal(email.to, renterEmail);
  assert(email.html.includes('View damage evidence'));
  assert(email.html.includes('confirm the email used for the rental'));
  assert.equal(email.attachments.length, 1, 'Only the bounded return PDF is attached; evidence bytes stay out of email');
  assert(!email.html.includes(attachment.storageId), 'Email does not expose a raw storage identifier');
  assert(!email.html.includes(fileHash), 'Email does not expose file integrity metadata');
  const token = extractToken(email.html);

  const landing = await route.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?token=${token}`));
  const landingHtml = await landing.text();
  assert.equal(landing.status, 200);
  assert(landingHtml.includes('type="email"'));
  assert(!landingHtml.includes('front-panel.jpg'), 'Unauthenticated landing page reveals no filenames');
  assert.match(landing.headers.get('cache-control'), /no-store/);
  assert.match(landing.headers.get('x-robots-tag'), /noindex/);

  const wrongEmail = await postRoute.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=wrong%40example.invalid',
  }));
  assert((await wrongEmail.text()).includes('did not match this rental'));
  const verified = await postRoute.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(renterEmail)}`,
  }));
  const verifiedHtml = await verified.text();
  assert.equal(verified.status, 200);
  assert(verifiedHtml.includes('Sony FX3'));
  assert(verifiedHtml.includes('front-panel.jpg'));
  const download = verifiedHtml.match(/https:\/\/synthetic-deployment\.convex\.site\/return-evidence\?download=([A-Za-z0-9_.-]+)/)?.[1];
  assert(download, 'email-confirmed page mints a short-lived file-specific token');
  const fileResponse = await route.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?download=${download}`));
  assert.equal(fileResponse.status, 200);
  assert.match(fileResponse.headers.get('content-disposition'), /front-panel\.jpg/);
  assert.match(fileResponse.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), fileBytes);

  const tampered = await route.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?token=${token.slice(0, -1)}x`));
  assert.equal(tampered.status, 404, 'tampered tokens fail closed');
  const bodyTooLarge = await postRoute.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${'x'.repeat(1100)}`,
  }));
  assert.equal(bodyTooLarge.status, 413, 'email confirmation input is bounded');

  const wrongRental = put('bookings', { status: 'returned', accountId: account._id, returnStatement: statement, returnDecision: booking.returnDecision });
  assert.equal(await bookings.returnEvidenceLinkFiles.handler({ db }, {
    bookingId: wrongRental._id, caseId: caseRecord._id, expiresAt: evidenceContext.expiresAt, recipientHash: evidenceContext.recipientHash,
  }), null, 'a link cannot cross rental ownership');
  const wrongRentalToken = await load('shared/returnEvidenceLink.ts').signReturnEvidenceLink({
    v: 1, bookingId: wrongRental._id, caseId: caseRecord._id, expiresAt: evidenceContext.expiresAt,
    recipientHash: evidenceContext.recipientHash,
  }, process.env.INVOICE_SECRET);
  const wrongRentalResponse = await route.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?token=${wrongRentalToken}`));
  assert.equal(wrongRentalResponse.status, 404, 'HTTP delivery fails closed for a case token bound to another rental');
  const validDownloadClaims = await load('shared/returnEvidenceLink.ts').signReturnEvidenceLink({
    v: 1, bookingId: booking._id, caseId: caseRecord._id, expiresAt: evidenceContext.expiresAt,
    recipientHash: evidenceContext.recipientHash, fileIndex: 0, downloadExpiresAt: Date.now() + 60_000,
  }, process.env.INVOICE_SECRET);
  ctx.storage.get = async () => new Blob([Buffer.from('different bytes')]);
  const corrupted = await route.handler(ctx, request(`https://synthetic-deployment.convex.site/return-evidence?download=${validDownloadClaims}`));
  assert.equal(corrupted.status, 404, 'stored evidence is re-hashed before transfer');
  assert.equal(tables.get('email_messages').filter(message => message.providerId === `return-statement:${booking._id}`).length, 1);
  assert(docs.has(attachment.messageId));
  console.log('PASS return evidence delivery: renter-bound expiring link, archived same-rental case validation, integrity-checked private download, bounded email/form, synthetic recipient only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
