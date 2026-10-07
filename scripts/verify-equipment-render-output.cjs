/* Read-only verification. Finished image bytes stay in R2; only evidence is saved. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '../docs/design/rental-experience');
const base = 'https://jovial-camel-68.convex.site/api/v1/projects/db-cinema-rentals';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--pilot' || !/^[1-9][0-9]?$/.test(args[1]))) {
  console.error('Usage: node scripts/verify-equipment-render-output.cjs [--pilot 1..99]');
  process.exit(1);
}
const pilot = args.length ? Number(args[1]) : 1;
const prefix = pilot === 1 ? 'ernie-pilot' : `ernie-pilot-${pilot}`;
async function main() {
  if (!process.env.DBC_RENDER_TOKEN) throw Error('Inject MANAGEMENT_API_TOKEN as DBC_RENDER_TOKEN through the vault.');
  const submitted = JSON.parse(fs.readFileSync(path.join(root, `${prefix}-receipt.json`)));
  const request = JSON.parse(fs.readFileSync(path.join(root, `${prefix}-request.json`)));
  assert.match(submitted.jobId, /^[a-z0-9]{32}$/);
  assert.equal(submitted.workflowId, request.workflowId);
  assert.equal(submitted.imageContractSha256, request.request.imageContractSha256);
  const headers = { Authorization: `Bearer ${process.env.DBC_RENDER_TOKEN}` };
  async function read(operation) {
    const response = await fetch(`${base}/${operation}?jobId=${submitted.jobId}`, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`${operation} returned HTTP ${response.status}; keep following the same job.`);
    return response.json();
  }
  const status = await read('jobs');
  assert.equal(status.status, 'completed', 'Job is not completed; do not accept output yet.');
  assert.equal(status.workflowId, request.workflowId);
  assert.equal(status.outputBucket, 're-db-cinema-rentals-1f518ftgxs');
  assert.equal(status.outputPrefix, 'projects/db-cinema-rentals');
  const output = await read('ernie-batches/output'); // Server rehashes PNG and validates native receipt before signing.
  assert.equal(output.candidates.length, request.request.candidates.length);
  const seen = new Set();
  const verified = [];
  for (const candidate of output.candidates) {
    const intended = request.request.candidates.find(item => item.id === candidate.candidateId);
    assert(intended && !seen.has(candidate.candidateId), 'Unknown or duplicated candidate.');
    seen.add(candidate.candidateId);
    assert.equal(candidate.bucket, status.outputBucket);
    assert.equal(candidate.key, `${status.outputPrefix}/workflows/${request.workflowId}/jobs/${submitted.jobId}/outputs/candidates/${intended.id}.png`);
    assert.equal(candidate.contentType, 'image/png');
    assert.match(candidate.sha256, /^[a-f0-9]{64}$/);
    assert.match(candidate.nativeReceiptSha256, /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(candidate.bytes) && candidate.bytes > 24 && candidate.bytes <= 20000000);
    const url = new URL(candidate.url);
    assert.equal(url.protocol, 'https:');
    const response = await fetch(url, { headers: candidate.requiredHeaders, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, 'Signed image read failed.');
    const hash = createHash('sha256');
    let bytes = 0, prefix = Buffer.alloc(0);
    for await (const chunk of response.body) {
      bytes += chunk.length;
      assert(bytes <= candidate.bytes, 'Image exceeds receipt length.');
      hash.update(chunk);
      if (prefix.length < 24) prefix = Buffer.concat([prefix, Buffer.from(chunk).subarray(0, 24 - prefix.length)]);
    }
    assert.equal(bytes, candidate.bytes);
    assert.equal(hash.digest('hex'), candidate.sha256);
    assert.equal(prefix.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(prefix.readUInt32BE(8), 13);
    assert.equal(prefix.subarray(12, 16).toString(), 'IHDR');
    assert.equal(prefix.readUInt32BE(16), intended.width);
    assert.equal(prefix.readUInt32BE(20), intended.height);
    verified.push({ candidateId: intended.id, bucket: candidate.bucket, key: candidate.key, bytes, sha256: candidate.sha256,
      width: intended.width, height: intended.height, nativeReceiptSha256: candidate.nativeReceiptSha256,
      pngIndependentlyStreamVerified: true, nativeReceiptServerRevalidated: true, visualAccepted: false });
  }
  const evidence = { checkedAt: new Date().toISOString(), jobId: submitted.jobId, workflowId: submitted.workflowId,
    imageContractSha256: submitted.imageContractSha256, status: status.status, usage: status.usage,
    candidates: verified, acceptedForTiles: false };
  const target = path.join(root, `${prefix}-output-verification.json`);
  if (fs.existsSync(target)) {
    const previous = JSON.parse(fs.readFileSync(target));
    const sameArtifacts = previous.jobId === evidence.jobId && previous.imageContractSha256 === evidence.imageContractSha256 &&
      previous.candidates?.length === verified.length && verified.every(candidate => previous.candidates.some(old =>
        old.candidateId === candidate.candidateId && old.bucket === candidate.bucket && old.key === candidate.key && old.sha256 === candidate.sha256));
    if (sameArtifacts && previous.visualReview) evidence.visualReview = previous.visualReview;
  }
  fs.writeFileSync(target, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
