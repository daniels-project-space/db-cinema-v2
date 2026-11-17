const assert = require("node:assert/strict");
const { isChatAttachmentType, isChatAttachmentNameMatched } = require("../shared/chatAttachmentPolicy.ts");
const { validateStructure } = require("../services/chat-scanner/scanner.cjs");

(async () => {
  const accepted = [
    ["image/jpeg", "camera.jpg"], ["image/jpeg", "camera.jpeg"],
    ["image/png", "note.png"], ["image/webp", "frame.webp"],
    ["text/plain", "pickup.txt"],
  ];
  for (const [type, name] of accepted) {
    assert.equal(isChatAttachmentType(type), true, `${type} is allowlisted`);
    assert.equal(isChatAttachmentNameMatched(name, type), true, `${name} matches ${type}`);
  }

  const rejected = [
    ["application/pdf", "invoice.pdf"],
    ["text/html", "message.html"],
    ["application/octet-stream", "payload.bin"],
    ["text/plain", "message.html"],
    ["text/plain", "message.pdf"],
    ["image/png", "message.txt"],
    ["image/jpeg", "message.png"],
    ["image/svg+xml", "image.svg"],
  ];
  for (const [type, name] of rejected) {
    assert.equal(isChatAttachmentType(type) && isChatAttachmentNameMatched(name, type), false, `${name} cannot be uploaded as ${type}`);
  }

  assert.equal(await validateStructure(Buffer.from("Pickup note: bring the case.\n", "utf8")), "text/plain");
  assert.equal(await validateStructure(Buffer.alloc(1024 * 1024, 0x61)), "text/plain", "The 1 MB text limit is inclusive");
  for (const bytes of [
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from("bad\u0000text", "utf8"),
    Buffer.from("bad\u001btext", "utf8"),
    Buffer.from("unsafe\u202e.txt", "utf8"),
    Buffer.alloc(1024 * 1024 + 1, 0x61),
    Buffer.from([0x7f, 0x00, 0x01, 0x02]),
  ]) {
    await assert.rejects(validateStructure(bytes), "Malformed, control-bearing, bidi-control or oversized text/binary data is rejected");
  }

  const pdfFixtures = [
    Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >>\n%%EOF"),
    Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF"),
    Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /Names << /EmbeddedFiles >>"),
  ];
  for (const pdf of pdfFixtures) await assert.rejects(validateStructure(pdf), /PDF attachments require further security validation/);

  console.log("PASS chat attachment policy and scanner structure checks: TXT accepted through 1 MB; MIME/extension mismatches, unsafe text, unsupported types, and every PDF remain rejected.");
})().catch(error => { console.error(error); process.exitCode = 1; });
