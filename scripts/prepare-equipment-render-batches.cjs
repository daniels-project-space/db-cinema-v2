// Offline preparation only. This script never calls Render Engine or submits jobs.
const fs = require('node:fs');
const crypto = require('node:crypto');
const dir = 'docs/design/rental-experience/';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = name => JSON.parse(fs.readFileSync(dir + name, 'utf8'));
const inventory = read('master-inventory.json');
const previous = read('ernie-reviewed-candidates.json');
const { projectName, workflowId, profileRevisionSha256, imageContract } = previous;
if (projectName !== 'db-cinema-rentals' || !workflowId ||
    imageContract.width !== 1264 || imageContract.height !== 848 ||
    imageContract.steps !== 50 || imageContract.cfg !== 4 ||
    imageContract.precision !== 'bf16' ||
    imageContract.promptEnhancer !== 'ernie-native-v1' ||
    imageContract.modelManifestSha256 !== profileRevisionSha256) {
  throw Error('Equipment lane quality/identity contract changed; review required');
}
if (new Set(inventory.items.map(i => i.id)).size !== inventory.items.length) {
  throw Error('Duplicate inventory IDs');
}
const owned = inventory.items.filter(i => i.owned === true && i.isMarketingOnly !== true);
const candidates = owned.filter(i => i.verifiedDescription).sort((a, b) => a.id.localeCompare(b.id)).map(i => {
  if (!i.descriptionProvenance || !/^[a-f0-9]{64}$/.test(i.sourceEvidenceSha256)) {
    throw Error(`Missing source provenance: ${i.id}`);
  }
  const renderIdentitySha256 = digest({
    inventoryId: i.id, evidence: i.sourceEvidenceSha256,
    prompt: i.heroPrompt, imageContract,
  });
  return {
    inventoryId: i.id, canonicalName: i.name, evidenceSha256: i.sourceEvidenceSha256,
    renderIdentitySha256, id: i.id, prompt: i.heroPrompt,
    seed: Math.max(1, Number.parseInt(renderIdentitySha256.slice(0, 8), 16)),
    width: imageContract.width, height: imageContract.height,
    compositionBlockers: i.compositionBlockers ?? [],
    referenceAccepted: i.cachedReferenceReview?.some(r => r.accepted) === true,
  };
});
const eligible = candidates.filter(c => !c.compositionBlockers.length);
const sourceHash = digest(candidates.map(c => c.renderIdentitySha256));
const sourceId = `equipment-hero-v2-${sourceHash.slice(0, 24)}`;
const readiness = 'Unsubmitted draft: live price, staging/release semantics, configuration and appearance/output acceptance must be checked before execution';
const catalog = {
  projectName, workflowId, profileRevisionSha256, imageContract,
  sourceId, idempotencyKey: `dbc-equipment-hero-v2:${sourceHash}`,
  candidates, readiness, submitted: false,
};
const batches = [];
for (let start = 0; start < eligible.length; start += 16) {
  const chunk = eligible.slice(start, start + 16);
  const batchHash = digest({ workflowId, profileRevisionSha256, identities: chunk.map(c => c.renderIdentitySha256) });
  batches.push({
    sourceId: `equipment-hero-v2-${batchHash.slice(0, 24)}`,
    idempotencyKey: `dbc-equipment-hero-v2:${batchHash}`,
    inventoryIds: chunk.map(c => c.inventoryId),
    // Exact candidate fields allowed by the v2 API; internal evidence stays in catalog.
    candidates: chunk.map(({ id, prompt, seed, width, height }) => ({ id, prompt, seed, width, height })),
    dispatchReady: false, submitted: false,
  });
}
const prepared = {
  version: 2, projectName, workflowId, profileRevisionSha256, imageContract,
  imageContractSha256: digest(imageContract), output: { contentType: 'image/png' },
  ownedCount: owned.length, describedCount: candidates.length,
  remainingDescriptionReview: owned.filter(i => !i.verifiedDescription).map(i => ({ id: i.id, name: i.name })),
  configurationBlocked: candidates.filter(c => c.compositionBlockers.length).map(c => ({ inventoryId: c.inventoryId, canonicalName: c.canonicalName, blockers: c.compositionBlockers })),
  readiness, dispatchReady: false, submitted: false, batches,
  // No invented price ceiling. A live reviewed quote is needed to construct maxCostUsd.
  maxCostUsd: null,
};
const outputs = { 'ernie-reviewed-candidates.json': catalog, 'ernie-prepared-batches.json': prepared };
for (const [name, value] of Object.entries(outputs)) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(dir + name, 'utf8') !== text) throw Error(`Stale generated brief: ${name}`);
  } else fs.writeFileSync(dir + name, text);
}
console.log(JSON.stringify({ owned: owned.length, described: candidates.length,
  configurationBlocked: prepared.configurationBlocked.length,
  prepared: eligible.length, batches: batches.map(b => b.candidates.length),
  remainingDescriptionReview: prepared.remainingDescriptionReview.length,
  submitted: false, noProviderWrites: true }));
