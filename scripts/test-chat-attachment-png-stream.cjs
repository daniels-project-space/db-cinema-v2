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
function chunk(type, data) {
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, checksum]);
}
(async () => {
  const clean = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#abcdef' } }).png().toBuffer();
  await validateStructure(clean, '/dev/shm');
  for (const [width, height] of [[1, 1], [1, 1000], [1000, 1], [17, 19], [320, 240]]) {
    for (const progressive of [false, true]) {
      const valid = await sharp({ create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png({ progressive }).toBuffer();
      await validateStructure(valid, '/dev/shm');
    }
  }
  const offset = clean.indexOf('IDAT') - 4, length = clean.readUInt32BE(offset), end = offset + 12 + length;
  const sentinel = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
  const compressed = clean.subarray(offset + 8, offset + 8 + length), middle = Math.floor(compressed.length / 2);
  const split = Buffer.concat([clean.subarray(0, offset), chunk('IDAT', compressed.subarray(0, middle)), chunk('IDAT', compressed.subarray(middle)), clean.subarray(end)]);
  await validateStructure(split, '/dev/shm');
  const hidden = Buffer.concat([clean.subarray(0, offset), chunk('IDAT', Buffer.concat([clean.subarray(offset + 8, offset + 8 + length), sentinel])), clean.subarray(end)]);
  assert.equal((await sharp(hidden).metadata()).format, 'png');
  await assert.rejects(validateStructure(hidden, '/dev/shm'), /stream|structure/, 'PNG image data cannot contain unused trailing compressed bytes');
  const header = Buffer.from(clean.subarray(16, 29));
  header.writeUInt32BE(20000001, 0); header.writeUInt32BE(1, 4);
  const huge = Buffer.concat([clean.subarray(0, 8), chunk('IHDR', header), clean.subarray(33)]);
  await assert.rejects(validateStructure(huge, '/dev/shm'), /pixel limit|Image validation failed/i, 'Pixel limits apply before image data is decompressed');
  console.log('PASS PNG stream rejects unused data inside IDAT; ordinary image accepted. Synthetic fixture only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
