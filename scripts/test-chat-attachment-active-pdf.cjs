const assert = require("node:assert/strict");
const { validateStructure } = require("../services/chat-scanner/scanner.cjs");

function makePdf({ active = false } = {}) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${active ? " /OpenAction 4 0 R" : ""} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ];
  if (active) objects.push("<< /S /JavaScript /JS (app.alert\\(active\\)) >>");

  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(document)?.[1]);
  assert.equal(document.slice(start, start + 5), "xref\n", "The synthetic PDF has a correct cross-reference offset");
  for (const offset of offsets.slice(1)) assert.match(document.slice(offset, offset + 10), /^\d+ 0 obj/);
  return Buffer.from(document);
}

(async () => {
  const fixtures = [
    ["static PDF", makePdf()],
    ["active JavaScript PDF", makePdf({ active: true })],
    ["malformed PDF", Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog")],
  ];
  for (const [label, bytes] of fixtures) {
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", `${label} fixture starts with the PDF signature`);
    await assert.rejects(validateStructure(bytes), /PDF attachments require further security validation/, `${label} must fail closed`);
  }
  console.log("PASS static, active-JavaScript, and malformed PDFs are rejected before parsing or scanner storage; synthetic fixtures only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
