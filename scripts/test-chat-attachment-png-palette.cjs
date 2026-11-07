const assert = require('node:assert/strict');
const sharp = require('sharp');
const { validateStructure } = require('../services/chat-scanner/scanner.cjs');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const chunk = Buffer.concat([Buffer.from(type), payload]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE(crc32(chunk));
  return Buffer.concat([length, chunk, checksum]);
}

(async () => {
  const image = sharp({ create: { width: 2, height: 2, channels: 3, background: '#abcdef' } });
  const original = await image.clone().png().toBuffer();
  await validateStructure(original, '/dev/shm');
  const payload = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
  const palette = pngChunk('PLTE', Buffer.concat([payload, Buffer.alloc((3 - payload.length % 3) % 3)]));
  const embedded = Buffer.concat([original.subarray(0, 33), palette, original.subarray(33)]);
  assert.equal((await sharp(embedded).metadata()).format, 'png', 'The hidden-payload fixture must be a valid image');
  await assert.rejects(validateStructure(embedded, '/dev/shm'), /metadata requires review/, 'An optional palette cannot carry unscanned data');
  const transparency = Buffer.concat([original.subarray(0, 33), pngChunk('tRNS', payload), original.subarray(33)]);
  assert.equal((await sharp(transparency).metadata()).format, 'png', 'The oversized transparency fixture must parse as an image');
  await assert.rejects(validateStructure(transparency, '/dev/shm'), /metadata requires review/, 'Oversized transparency cannot carry unscanned data');
  const gamma = pngChunk('gAMA', Buffer.from([0, 0, 177, 143]));
  const duplicated = Buffer.concat([original.subarray(0, 33), gamma, gamma, original.subarray(33)]);
  await assert.rejects(validateStructure(duplicated, '/dev/shm'), /metadata requires review/, 'Repeated metadata cannot expand the accepted payload');
  const indexed = await image.clone().png({ palette: true }).toBuffer();
  await assert.rejects(validateStructure(indexed, '/dev/shm'), /metadata requires review/, 'Indexed PNGs require an explicit clean-copy conversion');
  console.log('PASS PNG palette payloads rejected; normal PNG accepted. Synthetic fixtures only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
