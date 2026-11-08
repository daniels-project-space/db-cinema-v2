const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { validateStructure } = require('../services/chat-scanner/scanner.cjs');

const objects = [
  '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  '<< /S /JavaScript /JS (app.alert\\(\"active content\"\\)) >>',
];
let document = '%PDF-1.4\n';
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(document));
  document += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(document);
document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const directory = fs.mkdtempSync('/dev/shm/dbc-pdf-regression-');
const fixture = directory + '/active.pdf';
fs.writeFileSync(fixture, document, { mode: 0o600 });
const parsed = spawnSync('/usr/bin/mutool', ['info', fixture], { encoding: 'utf8' });
assert.equal(parsed.status, 0, 'The active-content fixture must be a valid PDF');
assert.equal(parsed.stderr, '');
fs.unlinkSync(fixture);
validateStructure(Buffer.from(document), directory)
  .then(() => { throw Error('An active PDF was accepted'); })
  .catch(error => {
    assert.match(error.message, /PDF attachments require further security validation/);
    assert.deepEqual(fs.readdirSync(directory), []);
    console.log('PASS active PDF is rejected; synthetic fixture only.');
  })
  .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
