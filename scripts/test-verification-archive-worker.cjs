/** Run the actual download/save worker with bounded provider and storage failures. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const archive = load('convex/verificationArchive.ts');
const worker = load('convex/verificationArchiveWorker.ts');
process.env.DIDIT_API_KEY = 'fixture-only';
process.env.DIDIT_WORKFLOW_ID = 'fixture-workflow';
const originalFetch = global.fetch;
const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const address = Buffer.from('%PDF-1.7\nfixture evidence\n%%EOF');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let counter = 0;
async function run(options = {}) {
  const booking = put('bookings', { status: 'confirmed',diditSessionId:'fixture-session' });
  const job = put('verification_archives', {
    bookingId: booking._id, sessionId: 'fixture-session', email: 'fixture@example.invalid',
    status: 'pending', attempts: 0, dueAt: Date.now(), createdAt: Date.now(), ...options.archive,
  });
  const stored = new Map(), removed = [], requests = [];
  const report = {
    session_id: job.sessionId, vendor_data: `dbc-booking-${booking._id}`,
    contact_details: { email: job.email }, workflow_id: process.env.DIDIT_WORKFLOW_ID,
    session_kind: 'user', id_verifications: [{ front_image: 'https://media.didit.me/id' }],
    poa_verifications: [{ document_file: 'https://media.didit.me/address' }],
    ...options.report,
  };
  if (options.existing) {
    put('verification_documents', { archiveId: job._id, bookingId: booking._id,
      kind: 'identity-0-front_image', storageId: 'old-file', sha256: sha(image),
      size: image.length, contentType: 'image/jpeg', savedAt: 123 });
    if (options.existing !== 'missing') stored.set('old-file', new Blob([options.existing === 'corrupt' ? Buffer.from('bad!') : image]));
  }
  const storage = {
    store: async blob => { const id = `file-${++counter}`; stored.set(id, options.corruptStore ? new Blob(['broken']) : blob); return id; },
    get: async id => stored.get(id) ?? null,
    delete: async id => { removed.push(id); if(!stored.has(id))throw Error('Storage object not found');stored.delete(id); },
  };
  const scheduled = [];
  const mutationCtx = { db:{...db,system:{get:async id=>stored.has(id)?{_id:id}:null}},storage,scheduler: { runAfter: async (delay, ref, args) => scheduled.push({delay,ref,args}) } };
  const ctx = { storage,
    runQuery: async (_, args) => archive.context.handler(mutationCtx, args),
    runMutation: async (ref, args) => archive[ref.split('.').at(-1)].handler(mutationCtx, args),
  };
  global.fetch = async (url, init) => {
    requests.push({ url, redirect: init.redirect });
    if (url.includes('/decision/')) return new Response(JSON.stringify(report), { status: options.providerError ? 503 : 200 });
    assert.equal(init.redirect, 'error', 'Provider document redirects cannot escape the host boundary');
    if (url.endsWith('/address') && options.addressError) return new Response('', { status: 403 });
    return new Response(url.endsWith('/id') ? image : address,
      options.oversize ? { headers: { 'content-length': String(16 * 1024 * 1024) } } : {});
  };
  await worker.capture.handler(ctx, { archiveId: job._id });
  const documents = (tables.get('verification_documents') ?? []).filter(d => d.archiveId === job._id);
  if (job.status === "complete") { assert.equal(booking.rmv2SyncStatus, "pending"); assert(scheduled.some(call => call.ref === "rmv2_webhook.push" && call.args.bookingId === booking._id), "Archive completion must deliver fresh approval readiness"); }
  return { job,booking, documents, stored, removed, requests,ctx,mutationCtx,report };
}
(async () => {
  const oldWorkflow=await run({archive:{workflowId:'original-case-workflow'},report:{workflow_id:'original-case-workflow'}});
  assert.equal(oldWorkflow.job.status,'complete','old provider workflow remains valid after configuration changes');
  assert.equal(oldWorkflow.documents.length,2);
  const changedWorkflow=await run({archive:{workflowId:'original-case-workflow'}});
  assert.equal(changedWorkflow.job.status,'pending','current workflow cannot replace an archive’s original case identity');
  assert.equal(changedWorkflow.documents.length,0);
  const good = await run();
  assert.equal(good.job.status, 'complete'); assert.equal(good.documents.length, 2);
  for (const d of good.documents) assert.equal(sha(Buffer.from(await good.stored.get(d.storageId).arrayBuffer())), d.sha256);
  const partial=await run({report:{poa_verifications:[]}});
  assert.equal(partial.job.status,'pending');assert.equal(partial.documents.length,1,'Identity is saved while address is still missing');
  assert.equal(sha(Buffer.from(await partial.stored.get(partial.documents[0].storageId).arrayBuffer())),sha(image));
  await assert.rejects(()=>archive.assertVerificationArchive(partial.mutationCtx,partial.booking),/fully archived/,'A partial archive never permits handover');
  partial.report.poa_verifications=[{document_file:'https://media.didit.me/address'}];
  await archive.queueVerificationArchive(partial.mutationCtx,{...partial.booking,diditSessionId:partial.job.sessionId},true);
  await worker.capture.handler(partial.ctx,{archiveId:partial.job._id});
  assert.equal(partial.job.status,'complete','A later document event completes the same archive');
  const completed=(tables.get('verification_documents')??[]).filter(d=>d.archiveId===partial.job._id);
  assert.equal(completed.length,2);assert.equal(completed[0].storageId,partial.documents[0].storageId,'Already intact identity bytes are retained');
  const addressOnly=await run({report:{id_verifications:[]}});assert.equal(addressOnly.job.status,'pending');assert.equal(addressOnly.documents.length,1);assert.equal(addressOnly.documents[0].kind,'address-0');
  const siblingFailure=await run({report:{id_verifications:[{front_image:'https://evil.invalid/id'}]}});
  assert.equal(siblingFailure.documents.length,1,'A failed identity download cannot discard a healthy address copy');assert.equal(siblingFailure.job.status,'pending');
  for (const existing of ['valid', 'missing', 'corrupt']) {
    const result = await run({ existing });
    assert.equal(result.job.status, 'complete'); assert.equal(result.documents.length, 2);
    const identity = result.documents.find(d => d.kind.startsWith('identity'));
    assert.equal(identity.savedAt, 123, 'Repair preserves the original archive audit date');
    assert.equal(sha(Buffer.from(await result.stored.get(identity.storageId).arrayBuffer())), sha(image));
    if (existing === 'valid') assert.equal(identity.storageId, 'old-file');
    else { assert.notEqual(identity.storageId, 'old-file'); assert(result.removed.includes('old-file')); }
  }
  for (const options of [
    { providerError: true }, { report: { vendor_data: 'another-booking' } },
    { report: { contact_details: { email: 'other@example.invalid' } } },
    { report: { workflow_id: 'wrong-workflow' } }, { report: { poa_verifications: [] } },
    { report: { id_verifications: [{ front_image: 'https://evil.invalid/id' }] } },
    { addressError: true }, { oversize: true }, { corruptStore: true },
  ]) {
    const result = await run(options);
    assert.equal(result.job.status, 'pending', 'Incomplete or mismatched evidence must never satisfy the handover gate');
    assert.equal(result.job.attempts, 1); assert(result.job.dueAt > Date.now());
    assert(!JSON.stringify(result.job).includes('https://'), 'Provider links are not saved in failure messages');
    if (options.corruptStore) assert.equal(result.stored.size, 0, 'Readback failure removes the unusable copy');
  }
  // A stale repair must not replace a newer worker's verified storage object.
  const duplicate = good.documents[0], currentStorageId = duplicate.storageId;
  await archive.save.handler({ db, storage: { delete: async id => good.removed.push(id) } }, {
    archiveId: good.job._id,generation:good.job.generation, kind: duplicate.kind, sha256: duplicate.sha256,
    size: duplicate.size, contentType: duplicate.contentType, storageId: 'stale-copy', replaceStorageId: 'old-version',
  });
  assert.equal(duplicate.storageId, currentStorageId);
  assert(good.removed.includes('stale-copy'));
  const raced=await run({report:{poa_verifications:[]}});
  raced.job.dueAt=Date.now();const lease=await archive.claim.handler(raced.mutationCtx,{archiveId:raced.job._id});
  assert(lease);assert.equal(await archive.claim.handler(raced.mutationCtx,{archiveId:raced.job._id}),null,'Concurrent workers cannot share an active lease');
  await archive.queueVerificationArchive(raced.mutationCtx,{...raced.booking,diditSessionId:raced.job.sessionId},true);
  await archive.finish.handler(raced.mutationCtx,{archiveId:raced.job._id,generation:lease.generation,complete:true});
  assert.equal(raced.job.status,'pending','An older report cannot complete the newer document event');
  assert.equal(await archive.save.handler(raced.mutationCtx,{archiveId:raced.job._id,generation:lease.generation,kind:'address-0',storageId:'stale-revision',sha256:sha(address),size:address.length,contentType:'application/pdf'}),false);
  assert(raced.removed.includes('stale-revision'),'Stale revision bytes are discarded');
  const newer=await archive.claim.handler(raced.mutationCtx,{archiveId:raced.job._id});assert(newer.generation>lease.generation);
  raced.job.leaseUntil=Date.now()-1;raced.job.dueAt=Date.now();const recovered=await archive.claim.handler(raced.mutationCtx,{archiveId:raced.job._id});assert(recovered.generation>newer.generation,'Killed worker leases recover without trusting stale completion');
  await archive.finish.handler(raced.mutationCtx,{archiveId:raced.job._id,generation:newer.generation,complete:true});assert.equal(raced.job.status,'pending');
  const failedOwner=put('accounts',{email:'archive-failure@example.invalid'});await db.patch(raced.booking._id,{accountId:failedOwner._id});
  raced.job.attempts=12;raced.job.leaseUntil=Date.now()-1;raced.job.dueAt=Date.now();
  assert.equal(await archive.claim.handler(raced.mutationCtx,{archiveId:raced.job._id}),null,'Repeated killed workers cannot exceed the bounded attempt limit');
  assert.equal(raced.job.status,'attention');
  const alert=(tables.get('admin_notifications')??[]).find(n=>n.bookingId===raced.booking._id&&n.kind==='verification_archive');
  assert(alert&&alert.accountId===failedOwner._id,'Exhausted copying reaches the actual admin notification feed and rental');
  console.log('PASS actual archive worker: complete copies, intact dedupe, missing/corrupt repair, stale repair, binding and download/storage failures.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
