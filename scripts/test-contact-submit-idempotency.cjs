const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");

const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (delay, ref, args) => scheduled.push({ delay, ref, args }) } };
const contact = load("convex/contact.ts");
const { createClientRequestId } = load("src/lib/clientRequestId.ts");

(async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    let randomCall = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues(bytes) { randomCall += 1; bytes.fill(randomCall); return bytes; } },
    });
    const fallbackSafeIds = [createClientRequestId(), createClientRequestId()];
    assert.ok(fallbackSafeIds.every(id => /^[a-f0-9]{36}$/.test(id)), "browsers without randomUUID still get a valid cryptographic retry key");
    assert.notEqual(fallbackSafeIds[0], fallbackSafeIds[1]);
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    const noCryptoId = createClientRequestId();
    assert.match(noCryptoId, /^[a-zA-Z0-9_-]{16,80}$/, "the non-secret idempotency key remains valid when Web Crypto is unavailable");
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
    else delete globalThis.crypto;
  }

  const contactPage = fs.readFileSync(path.join(__dirname, "../src/app/contact/page.tsx"), "utf8");
  const renterChat = fs.readFileSync(path.join(__dirname, "../src/components/rentals/RentalConversation.tsx"), "utf8");
  const chatBoundary = fs.readFileSync(path.join(__dirname, "../src/components/rentals/ChatErrorBoundary.tsx"), "utf8");
  const contactError = fs.readFileSync(path.join(__dirname, "../src/app/contact/error.tsx"), "utf8");
  assert.match(contactPage, /createClientRequestId\(\)/, "the contact form uses the compatibility-safe retry id");
  assert.match(contactPage, /ChatErrorBoundary fallbackHref=\{`mailto:\$\{BUSINESS_CONTACT_EMAIL\}`\}/, "support chat rendering failures have a direct monitored-email fallback");
  assert.match(chatBoundary, /this\.props\.fallbackHref \?\? "\/contact"/, "other chat surfaces retain their normal contact fallback");
  assert.match(contactError, /Try again/, "contact route crashes offer an in-place retry");
  assert.match(contactError, /EmailLink label="Email support"/, "contact route crashes retain a mailto recovery link with a clipboard fallback");
  assert.match(renterChat, /href="\/contact"[^>]*>[\s\S]*?Contact form/, "failed renter chat sends offer a direct route to the support form");
  assert.match(renterChat, /Email support/, "failed renter chat sends offer direct email recovery");
  assert.match(contactPage, /Email support instead/, "failed support-form sends offer direct email recovery");
  assert.match(renterChat, /createClientRequestId\(\)/, "chat sends and attachments use the compatibility-safe retry id");
  assert.doesNotMatch(contactPage + renterChat, /crypto\.randomUUID\(\)/, "a missing randomUUID implementation cannot stop contact or chat submission");

  const request = {
    name: "Kevin Johnson",
    email: "kevin@example.invalid",
    message: "I cannot open my rental support conversation.",
    requestId: "contact-request-0001",
  };
  const first = await contact.submit.handler(ctx, request);
  const repeated = await contact.submit.handler(ctx, request);
  assert.equal(first.duplicate, false);
  assert.equal(repeated.id, first.id, "an uncertain response can be retried without creating a second enquiry");
  assert.equal(repeated.duplicate, true);
  assert.equal(tables.get("contact_messages").length, 1);
  assert.equal(tables.get("email_threads").length, 1);
  assert.equal(tables.get("email_messages").length, 1);
  assert.equal(scheduled.length, 1, "retry does not queue another automatic Gaffer response");
  const beforeHoneypot = tables.get("contact_messages").length;
  const suppressed = await contact.submit.handler(ctx, { ...request, requestId: "contact-support-autofill-001", hp: "autofilled company" });
  assert.deepEqual(suppressed, { id: null, suppressed: true }, "a filled honeypot is distinguished from a stored submission");
  assert.equal(tables.get("contact_messages").length, beforeHoneypot, "honeypot suppression cannot masquerade as a stored message");
  await assert.rejects(
    contact.submit.handler(ctx, { ...request, message: "A different enquiry" }),
    /no longer matches/,
    "a request key cannot be reused for changed content",
  );
  console.log("PASS contact form retries: one enquiry, one email thread, one Gaffer job, payload-bound request keys.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
