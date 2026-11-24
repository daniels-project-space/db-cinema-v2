const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { createCleanChatImage } = load("src/lib/chatImageCopy.ts");

class TestFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = Date.now();
  }
}

(async () => {
  const originalFile = global.File;
  const originalBitmap = global.createImageBitmap;
  const originalDocument = global.document;
  global.File = TestFile;
  let decodedSource;
  let bitmapClosed = false;
  let drawnSource;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: image => { drawnSource = image; } }),
    toBlob: callback => callback(new Blob(["normalized pixels"], { type: "image/png" })),
  };
  global.document = { createElement: name => {
    assert.equal(name, "canvas");
    return canvas;
  } };
  global.createImageBitmap = async (file, options) => {
    decodedSource = { type: file.type, name: file.name, options };
    const bitmap = { width: 2400, height: 1600, close: () => { bitmapClosed = true; } };
    return bitmap;
  };

  try {
    for (const [type, name] of [
      ["image/heic", "phone-photo.heic"],
      ["image/heif", "phone-photo.heif"],
      ["image/avif", "phone-photo.avif"],
      ["", "phone-photo.heic"],
      ["application/octet-stream", "phone-photo.heif"],
    ]) {
      const source = new TestFile(["synthetic source bytes"], name, { type });
      const normalized = await createCleanChatImage(source, "converted");
      assert.equal(normalized.type, "image/png", "The server receives a scanner-allowlisted normalized image");
      assert.equal(normalized.name, "phone-photo-converted.png");
      assert.equal(await normalized.text(), "normalized pixels", "The original container bytes and metadata are not copied");
      assert.deepEqual(decodedSource, { type, name, options: { imageOrientation: "from-image" } });
      assert.equal(drawnSource.width, 2400);
      assert.equal(drawnSource.height, 1600);
      assert.equal(bitmapClosed, true, "Decoded phone-image memory is released after conversion");
      bitmapClosed = false;
    }

    await assert.rejects(
      createCleanChatImage(new TestFile(["%PDF-1.7"], "document.pdf", { type: "application/pdf" })),
      /supported phone photo/,
      "PDFs cannot enter the image conversion path",
    );

    global.createImageBitmap = async () => ({
      width: 5000,
      height: 5000,
      close: () => { bitmapClosed = true; },
    });
    await assert.rejects(
      createCleanChatImage(new TestFile(["synthetic source bytes"], "large.heic", { type: "image/heic" }), "converted"),
      /too large to prepare safely/,
    );
    assert.equal(bitmapClosed, true, "Oversized decoded images also release browser memory");

    console.log("PASS HEIC/HEIF/AVIF normalization: browser-decoded pixels become clean PNGs; PDFs and oversized images remain blocked.");
  } finally {
    if (originalFile === undefined) delete global.File;
    else global.File = originalFile;
    if (originalBitmap === undefined) delete global.createImageBitmap;
    else global.createImageBitmap = originalBitmap;
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
