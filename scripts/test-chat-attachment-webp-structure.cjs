const assert = require('node:assert/strict');
const sharp = require('sharp');
const { validateStructure } = require('../services/chat-scanner/scanner.cjs');

function withChunks(original, chunks) {
  const bytes = Buffer.concat([original, ...chunks]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

(async () => {
  const image = sharp({ create: { width: 3, height: 3, channels: 3, background: '#abcdef' } });
  const lossy = await image.clone().webp().toBuffer();
  const lossless = await image.clone().webp({ lossless: true }).toBuffer();
  const alpha = await sharp({ create: { width: 3, height: 3, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).webp().toBuffer();
  const alphaLossless = await sharp({ create: { width: 3, height: 3, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer();
  for (const valid of [lossy, lossless, alpha, alphaLossless]) await validateStructure(valid, '/dev/shm');
  const duplicate = withChunks(lossy, [lossy.subarray(12)]);
  assert.equal((await sharp(duplicate).metadata()).format, 'webp', 'The hidden-payload fixture must still parse as WebP');
  await assert.rejects(validateStructure(duplicate, '/dev/shm'), /structure/, 'A second image chunk must not be carried as hidden data');
  const secondType = withChunks(lossy, [lossless.subarray(12)]);
  await assert.rejects(validateStructure(secondType, '/dev/shm'), /structure/, 'Mixed lossy and lossless payloads are not a single still image');
  console.log('PASS WebP still-image chunk structure: valid lossy, lossless and alpha images; duplicate image payloads rejected. Synthetic fixtures only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
