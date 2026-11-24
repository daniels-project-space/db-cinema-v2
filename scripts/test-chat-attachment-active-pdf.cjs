const assert = require("node:assert/strict");
const fs = require("node:fs"), crypto = require("node:crypto");
const { validateStructure, createScannerServer } = require("../services/chat-scanner/scanner.cjs");

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
    ["leading whitespace PDF", Buffer.concat([Buffer.from(" \n"), makePdf({ active: true })])],
    ["long prefix PDF", Buffer.concat([Buffer.alloc(1024, 32), makePdf({ active: true })])],
    ["malformed PDF", Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog")],
  ];
  for (const [label, bytes] of fixtures) {
    assert.notEqual(bytes.indexOf(Buffer.from("%PDF-")), -1, `${label} fixture contains the PDF signature`);
    await assert.rejects(validateStructure(bytes), /PDF attachments require further security validation/, `${label} must fail closed`);
  }
  for (const activeText of ["<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>", "<!doctype html><script>alert(1)</script>", "<?xml version='1.0'?><script>alert(1)</script>"]) assert.equal(await validateStructure(Buffer.from(activeText)), "text/plain", "Active markup is treated as text, not sanitized or approved as an active document");
  await assert.rejects(validateStructure(Buffer.from("For reference, a PDF can start with %PDF-1.7.")), /PDF attachments require further security validation/, "The fail-closed literal guard can also reject explanatory text");
  const tmpDir=fs.mkdtempSync('/dev/shm/dbc-pdf-guard-'),token='synthetic-private-scanner-token-32-characters',server=createScannerServer({token,socketPath:'/tmp/nonexistent-pdf-test-clamd.sock',tmpDir});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    for (const [label, body] of fixtures) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/scan`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/octet-stream','x-scan-nonce':'a'.repeat(32),'x-content-sha256':crypto.createHash('sha256').update(body).digest('hex')},body});
      assert.equal(response.status,422,`${label} is rejected by the real scanner HTTP service`);
    }
    assert.deepEqual(fs.readdirSync(tmpDir),[],"Rejected PDFs leave no private scanner files");
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(tmpDir,{recursive:true,force:true}); }
  console.log("PASS static, active-JavaScript, and malformed PDFs are rejected before parsing or scanner storage; synthetic fixtures only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
