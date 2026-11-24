const assert = require("node:assert/strict");
const { isChatAttachmentType, isChatAttachmentNameMatched, isConvertiblePhoneImage, CHAT_ATTACHMENT_ACCEPT } = require("../shared/chatAttachmentPolicy.ts");
const { validateStructure } = require("../services/chat-scanner/scanner.cjs");
const sharp = require("sharp");

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
    ["image/heic", "phone-photo.heic"],
    ["image/heif", "phone-photo.heif"],
    ["image/avif", "phone-photo.avif"],
    ["image/heic-sequence", "phone-photo.heic"],
    ["text/plain", "message.html"],
    ["text/plain", "message.pdf"],
    ["image/png", "message.txt"],
    ["image/jpeg", "message.png"],
    ["image/svg+xml", "image.svg"],
  ];
  for (const [type, name] of rejected) {
    assert.equal(isChatAttachmentType(type) && isChatAttachmentNameMatched(name, type), false, `${name} cannot be uploaded as ${type}`);
  }
  for (const [type, name] of [["image/heic", "camera.HEIC"], ["image/heif", "phone.heif"], ["image/avif", "photo.avif"], ["", "phone.heic"], ["application/octet-stream", "phone.heif"]]) {
    assert.equal(isConvertiblePhoneImage(type, name), true, `${name} is eligible for browser-side conversion`);
    assert.equal(isChatAttachmentType(type), false, `${name} must be normalized before reaching the scanner allowlist`);
  }
  for (const [type, name] of [["image/heic", "photo.heif"], ["image/heif", "photo.heic"], ["application/pdf", "photo.heic"], ["", "photo.pdf"], ["image/heic-sequence", "burst.heic"]]) {
    assert.equal(isConvertiblePhoneImage(type, name), false, `${name} cannot bypass exact phone-image MIME and extension matching`);
  }
  assert.match(CHAT_ATTACHMENT_ACCEPT, /\.heic/);
  assert.match(CHAT_ATTACHMENT_ACCEPT, /\.heif/);
  assert.match(CHAT_ATTACHMENT_ACCEPT, /\.avif/);
  assert.match(require("../shared/chatAttachmentPolicy.ts").CHAT_ATTACHMENT_HELP, /JPG, PNG, WebP/);

  assert.equal(await validateStructure(Buffer.from("Pickup note: bring the case.\n", "utf8")), "text/plain");
  assert.equal(await validateStructure(Buffer.alloc(1024 * 1024, 0x61)), "text/plain", "The 1 MB text limit is inclusive");
  for (const [format, contentType] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
    const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#b08055" } }).toFormat(format).toBuffer();
    assert.equal(await validateStructure(image), contentType, `A valid camera-friendly ${format.toUpperCase()} image passes structural validation`);
  }
  for (const image of [
    Buffer.from("00000018667479706865696300000000", "hex"),
    Buffer.from("00000018667479706865697800000000", "hex"),
    Buffer.from("00000018667479706176696600000000", "hex"),
  ]) await assert.rejects(validateStructure(image), "HEIC, HEIF and AVIF payloads remain unsupported until a qualified decoder and scanning path exist");
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

  console.log("PASS chat attachment policy and scanner structure checks: TXT accepted through 1 MB; MIME/extension mismatches, unsafe text, unsupported types, and representative PDF fixtures remain rejected.");
})().catch(error => { console.error(error); process.exitCode = 1; });
