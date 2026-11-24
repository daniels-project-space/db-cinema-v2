const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, docs, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
setMock("./adminAuth", { checkAdminToken: token => token === "admin-fixture", assertAdmin: async (_ctx, token) => { if (token !== "admin-fixture") throw new Error("unauthorized"); } });
setMock("./lib/rentalChat", { accountForToken: async () => null, rentalThread: async () => null, postRentalMessage: async () => "message:fixture" });
process.env.ADMIN_TOKEN = "admin-fixture";
process.env.INBOUND_EMAIL_DOMAIN = "inbound.example.invalid";
process.env.INBOUND_EMAIL_SECRET = "email-secret-fixture";
process.env.RESEND_API_KEY = "resend-test-only";
process.env.RESEND_FROM = "DB Cinema Rentals <bookings@dbcinemarentals.com>";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";

const contact = load("convex/contact.ts");
const inbox = load("convex/emailInbox.ts");
const followUp = load("convex/followUp.ts");
const voice = load("convex/voice.ts");
const { BUSINESS_CONTACT_EMAIL } = load("shared/businessEmail.ts");
const securityContact = fs.readFileSync(path.resolve(__dirname, "../public/.well-known/security.txt"), "utf8");
assert.ok(securityContact.includes(`Contact: mailto:${BUSINESS_CONTACT_EMAIL}`), "public security contact uses the canonical monitored business email");
assert.ok(!securityContact.includes("bookings@dbcinemarentals.com"), "retired public contact mailbox is not published in security.txt");

(async () => {
  const scheduled = [];
  const contactCtx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
  const submitted = await contact.submit.handler(contactCtx, {
    name: "Renter Name",
    email: "renter@example.invalid",
    message: "Can you help me choose a lens?",
  });
  const contactId = submitted.id;
  const record = docs.get(String(contactId));
  assert.equal(record.routedTo, "contact-form");
  const thread = [...docs.values()].find(row => row.email === "renter@example.invalid" && row.replyKey);
  assert.ok(thread, "contact form appears in the new email inbox immediately, before Gaffer finishes");
  assert.equal(thread.subject, "Website contact: Renter Name");
  assert.equal(thread.unreadOwner, 1);
  const inbound = [...docs.values()].find(row => row.providerId === `contact-form:${contactId}`);
  assert.equal(inbound.threadId, thread._id);
  assert.equal(inbound.direction, "in");
  assert.equal(inbound.recipient, "dbcinemarentals@gmail.com");
  assert.equal(scheduled.length, 1, "the existing automatic Gaffer response is still scheduled");
  assert.equal(scheduled[0][2].contactId, contactId);

  const uniqueVerifiedAccount = put("accounts", {
    email: "verified-contact@example.invalid",
    emailVerifiedAt: 10,
    name: "Verified contact",
  });
  const verifiedContactRequest = {
    name: "Verified contact",
    email: uniqueVerifiedAccount.email,
    message: "Please help with a current rental.",
    requestId: "verified-contact-request-01",
  };
  const scheduledBeforeVerifiedContact = scheduled.length;
  const verifiedContact = await contact.submit.handler(contactCtx, verifiedContactRequest);
  const verifiedContactThread = [...docs.values()].find(row => row.email === uniqueVerifiedAccount.email && row.replyKey);
  assert.equal(verifiedContactThread.accountId, undefined, "a public form cannot claim a verified account from its typed email alone");
  assert.equal(verifiedContactThread.verifiedRenterEmail, undefined, "unverified contact input remains a standalone mini-contact");
  assert.equal(scheduled.slice(scheduledBeforeVerifiedContact).some(job => String(job[1]).endsWith("copyVerifiedHistory")), false, "anonymous contact input is not mirrored into the renter chat");
  const afterFirstVerifiedContact = { threads: docs.size, scheduled: scheduled.length };
  const retriedVerifiedContact = await contact.submit.handler(contactCtx, verifiedContactRequest);
  assert.equal(retriedVerifiedContact.id, verifiedContact.id, "retry keeps the original standalone contact thread");
  assert.equal(retriedVerifiedContact.duplicate, true);
  assert.equal(docs.size, afterFirstVerifiedContact.threads, "replaying the same request creates no second thread");
  assert.equal(scheduled.length, afterFirstVerifiedContact.scheduled, "replaying the same request schedules no second reply or account mirror");

  const legacyMatchingVerified = put("contact_messages", {
    name: "Verified contact legacy enquiry",
    email: uniqueVerifiedAccount.email,
    message: "A historic public-form message.",
    routedTo: "legacy-email",
    handled: false,
  });
  const legacyMatchingResult = await contact.openCentralThread.handler(contactCtx, { token: "admin-fixture", id: legacyMatchingVerified._id });
  const legacyMatchingThread = docs.get(String(legacyMatchingResult.threadId));
  assert.equal(legacyMatchingThread.accountId, undefined, "staff migration does not upgrade an old public-form email into account ownership");
  assert.equal(legacyMatchingThread.verifiedRenterEmail, undefined);
  assert.equal(scheduled.slice(afterFirstVerifiedContact.scheduled).some(job => String(job[1]).endsWith("copyVerifiedHistory")), false, "legacy public-form history also stays out of renter chat until ownership is proven");

  const ambiguousEmail = "duplicate-contact@example.invalid";
  put("accounts", { email: ambiguousEmail, emailVerifiedAt: 11, name: "Duplicate contact one" });
  put("accounts", { email: ambiguousEmail, emailVerifiedAt: 12, name: "Duplicate contact two" });
  const ambiguousContact = await contact.submit.handler(contactCtx, {
    name: "Duplicate contact",
    email: ambiguousEmail,
    message: "Please help with a rental.",
  });
  const ambiguousContactThread = [...docs.values()].find(row => row.email === ambiguousEmail && row.replyKey);
  assert.equal(ambiguousContactThread.accountId, undefined, "ambiguous verified profiles are not linked to a contact thread");
  assert.equal(ambiguousContactThread.verifiedRenterEmail, undefined);
  assert.ok(verifiedContact.id && ambiguousContact.id);

  await voice.lead.handler(contactCtx, { kind: "callback", name: "Caller", message: "Please call me back." });
  const voiceWithoutEmail = [...docs.values()].find(row => row.name === "Caller" && row.routedTo === "voice-callback");
  assert.equal(voiceWithoutEmail.email, "", "voice requests without an email do not get a fake reply address");

  await contact.markAutoHandled.handler({ db }, { id: contactId });
  const legacyEnquiries = put("contact_messages", { name: "Crew applicant", email: "crew@example.invalid", message: "Crew enquiry", routedTo: "crew", handled: false });
  const collectiveRequest = put("contact_messages", { name: "Community member", email: "community@example.invalid", message: "Community request", routedTo: "collective", handled: false });
  const voiceRequest = put("contact_messages", { name: "Caller", email: "caller@example.invalid", message: "Voice follow-up", routedTo: "voice-outbound", handled: false });
  const oldEmail = put("contact_messages", { name: "Legacy renter", email: "legacy@example.invalid", message: "Please call me about a rental", handled: false });
  const visible = await contact.adminList.handler({ db }, { token: "admin-fixture" });
  assert.equal(visible.items.some(item => item._id === contactId), false, "central contact email is not duplicated in the old Enquiries panel");
  assert.equal(visible.items.some(item => item._id === legacyEnquiries._id), true, "non-email crew/application enquiries keep their existing queue");
  assert.equal(visible.items.some(item => item._id === collectiveRequest._id), true, "community requests remain reachable");
  assert.equal(visible.items.some(item => item._id === voiceRequest._id), true, "voice requests remain reachable");
  assert.equal(visible.items.some(item => item._id === oldEmail._id), true, "untagged historical customer emails can be migrated");

  const legacyCtx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
  const oldVoiceSentinel = put("contact_messages", { name: "Old caller", email: "voice@dbcinemarentals.com", message: "Voice follow-up", routedTo: "voice-callback", handled: false });
  await assert.rejects(() => contact.openCentralThread.handler(legacyCtx, { token: "admin-fixture", id: oldVoiceSentinel._id }), /no renter email address/);
  const migrated = await contact.openCentralThread.handler(legacyCtx, { token: "admin-fixture", id: legacyEnquiries._id });
  assert.ok(migrated.threadId, "legacy enquiries can be moved into the shared conversation inbox");
  assert.equal(docs.get(String(legacyEnquiries._id)).routedTo, "central-email");
  const legacyMessage = [...docs.values()].find(row => row.providerId === `legacy-contact:${legacyEnquiries._id}`);
  assert.equal(legacyMessage.threadId, migrated.threadId);
  assert.equal(legacyMessage.recipient, "dbcinemarentals@gmail.com");
  const replayedMigration = await contact.openCentralThread.handler(legacyCtx, { token: "admin-fixture", id: legacyEnquiries._id });
  assert.equal(replayedMigration.threadId, migrated.threadId, "opening a legacy enquiry twice reuses its existing email thread");
  assert.equal([...docs.values()].filter(row => row.providerId === `legacy-contact:${legacyEnquiries._id}`).length, 1, "legacy migration is idempotent");
  const afterMigration = await contact.adminList.handler({ db }, { token: "admin-fixture" });
  assert.equal(afterMigration.items.some(item => item._id === legacyEnquiries._id), false, "migrated enquiries leave the old queue");

  const orphanedCentralEmail = put("contact_messages", { name: "Orphaned renter", email: "orphan@example.invalid", message: "Please help with my rental", routedTo: "central-email", handled: false });
  const repaired = await contact.openCentralThread.handler(legacyCtx, { token: "admin-fixture", id: orphanedCentralEmail._id });
  assert.ok(repaired.threadId, "a previously marked but incomplete email import can be repaired");
  assert.equal([...docs.values()].filter(row => row.providerId === `legacy-contact:${orphanedCentralEmail._id}`).length, 1);

  const ambiguousLegacy = put("contact_messages", {
    name: "Duplicate contact",
    email: "duplicate-contact@example.invalid",
    message: "A historic rental enquiry.",
    routedTo: "central-email",
    handled: false,
  });
  const ambiguousLegacyResult = await contact.openCentralThread.handler(legacyCtx, { token: "admin-fixture", id: ambiguousLegacy._id });
  const ambiguousLegacyThread = docs.get(String(ambiguousLegacyResult.threadId));
  assert.equal(ambiguousLegacyThread.accountId, undefined, "legacy contact migration also fails closed when the email maps to duplicate verified profiles");
  assert.equal(ambiguousLegacyThread.verifiedRenterEmail, undefined);

  const followUpArgs = { email: "renter@example.invalid", name: "Renter Name", subject: "Following up on your call", text: "Here are the items we discussed.", replyKey: "abcdef0123456789abcdef01" };
  const followUpOwner = put("accounts", { email: followUpArgs.email, emailVerifiedAt: 20, name: "Renter Name" });
  const followUpCtx = { db };
  const prepared = await inbox.prepareGafferFollowUp.handler(followUpCtx, followUpArgs);
  assert.equal(prepared.state, "claimed");
  const replay = await inbox.prepareGafferFollowUp.handler(followUpCtx, followUpArgs);
  assert.equal(replay.state, "busy", "a retry cannot create a second outgoing follow-up while its lease is active");
  const followThread = docs.get(String(prepared.threadId));
  const followMessage = docs.get(String(prepared.outboundId));
  const followOutboxRows = [...docs.values()].filter(row => row.providerId === `out:gaffer-follow-up:${followUpArgs.replyKey}`);
  assert.equal(followOutboxRows.length, 1, "a retry reuses the original outgoing email row");
  assert.equal(followOutboxRows[0].threadId, prepared.threadId, "a retry remains attached to the original email thread");
  assert.equal(followThread.replyKey, followUpArgs.replyKey);
  assert.equal(followThread.accountId, followUpOwner._id, "a unique verified email can still centralize a Gaffer follow-up in the renter account");
  assert.equal(followThread.verifiedRenterEmail, followUpArgs.email);
  assert.equal(followMessage.direction, "out");
  assert.equal(followMessage.state, "processing");
  assert.equal(followMessage.recipient, followUpArgs.email);
  const replyRoute = await inbox.resolveReplyKey.handler({ db }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    replyKey: followUpArgs.replyKey,
    email: followUpArgs.email,
  });
  assert.equal(replyRoute.ok, true);
  assert.equal(replyRoute.threadId, prepared.threadId, "renter email replies resolve to the same new inbox thread");

  const ambiguousFollowUpEmail = "duplicate-follow-up@example.invalid";
  put("accounts", { email: ambiguousFollowUpEmail, emailVerifiedAt: 21, name: "Duplicate owner one" });
  put("accounts", { email: ambiguousFollowUpEmail, emailVerifiedAt: 22, name: "Duplicate owner two" });
  const ambiguousFollowUpArgs = { ...followUpArgs, email: ambiguousFollowUpEmail, replyKey: "abcdef0123456789abcdef02" };
  const ambiguousPrepared = await inbox.prepareGafferFollowUp.handler(followUpCtx, ambiguousFollowUpArgs);
  assert.equal(ambiguousPrepared.state, "claimed");
  const ambiguousFollowThread = docs.get(String(ambiguousPrepared.threadId));
  assert.equal(ambiguousFollowThread.accountId, undefined, "duplicate verified profiles are never assigned arbitrarily to a follow-up");
  assert.equal(ambiguousFollowThread.verifiedRenterEmail, undefined);
  const ambiguousReplay = await inbox.prepareGafferFollowUp.handler(followUpCtx, ambiguousFollowUpArgs);
  assert.equal(ambiguousReplay.state, "busy");
  const ambiguousOutboxRows = [...docs.values()].filter(row => row.providerId === `out:gaffer-follow-up:${ambiguousFollowUpArgs.replyKey}`);
  assert.equal(ambiguousOutboxRows.length, 1, "an ambiguous-identity retry creates no duplicate outbound row");
  assert.equal(ambiguousOutboxRows[0].threadId, ambiguousPrepared.threadId, "ambiguous retries keep the same standalone contact thread");
  assert.equal(ambiguousOutboxRows[0]._id, ambiguousPrepared.outboundId);

  await assert.rejects(() => inbox.prepareGafferFollowUp.handler(followUpCtx, {
    ...ambiguousFollowUpArgs,
    email: "different-recipient@example.invalid",
  }), /does not match its thread/, "a follow-up idempotency key cannot be reused for a different recipient");
  const copyJobs = [];
  await inbox.finishGafferFollowUp.handler({ db, scheduler: { runAfter: async (...args) => copyJobs.push(args) } }, {
    threadId: prepared.threadId,
    outboundId: prepared.outboundId,
    text: followUpArgs.text,
    messageId: "<follow-up@example.invalid>",
  });
  assert.equal(docs.get(String(prepared.outboundId)).state, "sent");
  assert.equal(docs.get(String(prepared.outboundId)).messageId, "<follow-up@example.invalid>");

  const sendOrder = [];
  let deliveredPayload;
  await inbox.sendGafferFollowUp.handler({
    runMutation: async (ref, args) => {
      sendOrder.push(String(ref));
      if (String(ref).endsWith("prepareGafferFollowUp")) return { state: "claimed", threadId: "email_threads-thread", outboundId: "email_messages-out", deliveryKey: `gaffer-follow-up:${args.replyKey}`, to: args.email, name: args.name, subject: args.subject, text: args.text };
      return { ok: true };
    },
    runAction: async (ref, args) => {
      sendOrder.push(String(ref));
      deliveredPayload = args;
      return { sent: true, messageId: "<stable-follow-up@example.invalid>" };
    },
  }, followUpArgs);
  assert(sendOrder[0].endsWith("prepareGafferFollowUp"));
  assert(sendOrder[1].endsWith("sendBusinessReply"));
  assert(sendOrder[2].endsWith("finishGafferFollowUp"));
  assert.equal(deliveredPayload.to, followUpArgs.email);
  assert.equal(deliveredPayload.replyTo, `gaffer+${followUpArgs.replyKey}@resend-inbox.example.invalid`);
  assert.equal(deliveredPayload.deliveryKey, `gaffer-follow-up:${followUpArgs.replyKey}`);

  const replayFollowUpArgs = { ...followUpArgs, email: "retry-follow-up@example.invalid", replyKey: "abcdef0123456789abcdef03" };
  const replayPayloads = [];
  let failReplayFinish = true;
  const sendReplayFollowUp = (args) => inbox.sendGafferFollowUp.handler({
    runMutation: async (ref, mutationArgs) => {
      const name = String(ref).split(".").at(-1);
      if (name === "prepareGafferFollowUp") return inbox.prepareGafferFollowUp.handler({ db }, mutationArgs);
      if (name === "finishGafferFollowUp") {
        if (failReplayFinish) {
          failReplayFinish = false;
          throw new Error("simulated lost follow-up finalization");
        }
        return inbox.finishGafferFollowUp.handler({ db, scheduler: { runAfter: async () => {} } }, mutationArgs);
      }
      if (name === "failGafferFollowUp") return inbox.failGafferFollowUp.handler({ db }, mutationArgs);
      if (name === "markGafferFollowUpUncertain") return inbox.markGafferFollowUpUncertain.handler({ db }, mutationArgs);
      throw new Error(`Unexpected follow-up mutation: ${String(ref)}`);
    },
    runAction: async (ref, actionArgs) => {
      assert.match(String(ref), /emailMailer\.sendBusinessReply$/);
      replayPayloads.push(actionArgs);
      return { sent: true, messageId: `<${actionArgs.deliveryKey}@example.invalid>` };
    },
  }, args);

  const failedFinalize = await sendReplayFollowUp(replayFollowUpArgs);
  assert.deepEqual(failedFinalize, { ok: false, uncertain: true });
  const replayOutbound = [...docs.values()].find(row => row.providerId === `out:gaffer-follow-up:${replayFollowUpArgs.replyKey}`);
  assert.equal(replayOutbound.state, "uncertain", "an accepted follow-up with a lost finalization is paused rather than retried");
  const uncertainOwnerView = await inbox.adminThread.handler({ db }, { token: "admin-fixture", threadId: replayOutbound.threadId });
  assert.equal(uncertainOwnerView.messages.find(message => message._id === replayOutbound._id)?.state, "uncertain", "the admin inbox exposes an unresolved follow-up delivery to the owner");
  assert.equal(uncertainOwnerView.replyDeliveryStatus, "uncertain", "the owner inbox clearly pauses any duplicate reply until delivery is checked");
  await assert.rejects(() => sendReplayFollowUp({ ...replayFollowUpArgs, text: "A regenerated, different follow-up." }), /cannot be reused with different content/);
  assert.equal(replayPayloads.length, 1, "changed follow-up content is rejected before provider delivery under the same idempotency key");
  assert.equal(replayOutbound.text, replayFollowUpArgs.text, "a failed follow-up retains its original outbox text");
  assert.deepEqual(await sendReplayFollowUp(replayFollowUpArgs), { ok: false, uncertain: true });
  assert.equal(replayPayloads.length, 1, "an uncertain follow-up is not resent under the same key");

  const runFollowUpWithTransport = (args, transport) => inbox.sendGafferFollowUp.handler({
    runMutation: async (ref, mutationArgs) => {
      const name = String(ref).split(".").at(-1);
      if (name === "prepareGafferFollowUp") return inbox.prepareGafferFollowUp.handler({ db }, mutationArgs);
      if (name === "finishGafferFollowUp") return inbox.finishGafferFollowUp.handler({ db, scheduler: { runAfter: async () => {} } }, mutationArgs);
      if (name === "failGafferFollowUp") return inbox.failGafferFollowUp.handler({ db }, mutationArgs);
      if (name === "markGafferFollowUpUncertain") return inbox.markGafferFollowUpUncertain.handler({ db }, mutationArgs);
      throw new Error(`Unexpected follow-up mutation: ${String(ref)}`);
    },
    runAction: transport,
  }, args);

  const ambiguousProviderArgs = { ...followUpArgs, email: "ambiguous-provider@example.invalid", replyKey: "abcdef0123456789abcdef04" };
  let ambiguousProviderCalls = 0;
  const ambiguousProviderResult = await runFollowUpWithTransport(ambiguousProviderArgs, async () => {
    ambiguousProviderCalls++;
    return { sent: false, ambiguous: true };
  });
  assert.deepEqual(ambiguousProviderResult, { ok: false, uncertain: true });
  const ambiguousProviderOut = [...docs.values()].find(row => row.providerId === `out:gaffer-follow-up:${ambiguousProviderArgs.replyKey}`);
  assert.equal(ambiguousProviderOut.state, "uncertain", "an ambiguous Resend result is never treated as a retryable rejection");
  assert.deepEqual(await runFollowUpWithTransport(ambiguousProviderArgs, async () => { ambiguousProviderCalls++; return { sent: true }; }), { ok: false, uncertain: true });
  assert.equal(ambiguousProviderCalls, 1, "ambiguous provider outcomes never trigger an automatic resend");

  const thrownProviderArgs = { ...followUpArgs, email: "thrown-provider@example.invalid", replyKey: "abcdef0123456789abcdef05" };
  let thrownProviderCalls = 0;
  const thrownProviderResult = await runFollowUpWithTransport(thrownProviderArgs, async () => {
    thrownProviderCalls++;
    throw new Error("simulated timeout after possible provider handoff");
  });
  assert.deepEqual(thrownProviderResult, { ok: false, uncertain: true });
  const thrownProviderOut = [...docs.values()].find(row => row.providerId === `out:gaffer-follow-up:${thrownProviderArgs.replyKey}`);
  assert.equal(thrownProviderOut.state, "uncertain", "a thrown provider action after handoff is paused for reconciliation");
  assert.deepEqual(await runFollowUpWithTransport(thrownProviderArgs, async () => { thrownProviderCalls++; return { sent: true }; }), { ok: false, uncertain: true });
  assert.equal(thrownProviderCalls, 1, "a retry cannot deliver an uncertain provider call twice");

  const rejectedProviderArgs = { ...followUpArgs, email: "rejected-provider@example.invalid", replyKey: "abcdef0123456789abcdef06" };
  let rejectedProviderCalls = 0;
  const rejectedProviderResult = await runFollowUpWithTransport(rejectedProviderArgs, async () => {
    rejectedProviderCalls++;
    return { sent: false, ambiguous: false };
  });
  assert.deepEqual(rejectedProviderResult, { ok: false, rejected: true }, "only a definitive provider rejection remains retryable");
  const rejectedProviderOut = [...docs.values()].find(row => row.providerId === `out:gaffer-follow-up:${rejectedProviderArgs.replyKey}`);
  assert.equal(rejectedProviderOut.state, "failed");
  assert.match(rejectedProviderOut.error, /^Definite provider rejection:/);
  assert.deepEqual(await runFollowUpWithTransport(rejectedProviderArgs, async () => {
    rejectedProviderCalls++;
    return { sent: true, messageId: "<recovered-follow-up@example.invalid>" };
  }), { ok: true });
  assert.equal(rejectedProviderCalls, 2, "a definite rejection is safely retryable");
  assert.equal(rejectedProviderOut.state, "sent");

  const staleProcessingArgs = { ...followUpArgs, email: "stale-processing@example.invalid", replyKey: "abcdef0123456789abcdef07" };
  const staleProcessing = await inbox.prepareGafferFollowUp.handler({ db }, staleProcessingArgs);
  const staleProcessingOut = docs.get(String(staleProcessing.outboundId));
  staleProcessingOut.leaseUntil = Date.now() - 1;
  assert.deepEqual(await inbox.prepareGafferFollowUp.handler({ db }, staleProcessingArgs), { state: "uncertain" }, "an expired processing lease cannot be reclaimed after an unknown provider handoff");
  assert.equal(staleProcessingOut.state, "uncertain");

  delete process.env.INBOUND_REPLY_ADDRESS;
  let staleRouteCalls = 0;
  await assert.rejects(inbox.sendGafferFollowUp.handler({
    runMutation: async () => { staleRouteCalls++; return { state: "claimed" }; },
    runAction: async () => { staleRouteCalls++; return { sent: true }; },
  }, followUpArgs), /reply route is not configured/);
  assert.equal(staleRouteCalls, 0, "a stale legacy domain cannot create or send a new follow-up");
  process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";

  const invoked = [];
  const publicSend = await followUp.send.handler({
    runMutation: async ref => { invoked.push(String(ref)); return { allowed: true }; },
    runAction: async (ref, args) => { invoked.push(String(ref)); return { ok: true }; },
  }, { email: followUpArgs.email, name: followUpArgs.name, subject: followUpArgs.subject, summary: followUpArgs.text });
  assert.match(publicSend, /^Sent it to renter@example\.invalid/);
  assert(invoked.some(ref => ref.endsWith("sendGafferFollowUp")), "voice follow-up sends through the durable email inbox outbox");
  assert(!invoked.some(ref => ref.endsWith("_record")), "new follow-ups no longer create the separate legacy-only record");
  assert.equal(followUp._record, undefined, "the old standalone follow-up writer is retired");
  assert.equal(followUp.adminList, undefined, "the old follow-up admin list is retired in favor of the shared email inbox");

  const accountPanel = fs.readFileSync(path.join(__dirname, "../src/components/admin/AccountAdmin.tsx"), "utf8");
  const adminPage = fs.readFileSync(path.join(__dirname, "../src/app/admin/page.tsx"), "utf8");
  const rentalInbox = fs.readFileSync(path.join(__dirname, "../src/components/admin/RentalInbox.tsx"), "utf8");
  const inboundRoute = fs.readFileSync(path.join(__dirname, "../src/app/api/email/inbound/route.ts"), "utf8");
  const notify = fs.readFileSync(path.join(__dirname, "../convex/notify.ts"), "utf8");
  const contactAlert = notify.slice(notify.indexOf("export const contactAlert"), notify.indexOf("export const contactAutoReply"));
  const businessEmail = fs.readFileSync(path.join(__dirname, "../shared/businessEmail.ts"), "utf8");
  const voiceSource = fs.readFileSync(path.join(__dirname, "../convex/voice.ts"), "utf8");
  const contactSource = fs.readFileSync(path.join(__dirname, "../convex/contact.ts"), "utf8");
  const checkoutPage = fs.readFileSync(path.join(__dirname, "../src/app/checkout/page.tsx"), "utf8");
  const site = fs.readFileSync(path.join(__dirname, "../src/lib/site.ts"), "utf8");
  const invoiceDocument = fs.readFileSync(path.join(__dirname, "../src/lib/invoice/InvoiceDocument.tsx"), "utf8");
  const invoiceSource = fs.readFileSync(path.join(__dirname, "../convex/invoice.ts"), "utf8");
  const mailerSource = fs.readFileSync(path.join(__dirname, "../convex/lib/mailer.ts"), "utf8");
  const swapAdjustmentDocument = fs.readFileSync(path.join(__dirname, "../src/lib/invoice/SwapAdjustmentDocument.tsx"), "utf8");
  const emailLink = fs.readFileSync(path.join(__dirname, "../src/components/EmailLink.tsx"), "utf8");
  const gafferSource = fs.readFileSync(path.join(__dirname, "../src/lib/gaffer.ts"), "utf8");
  assert.doesNotMatch(accountPanel, /mailto:\$\{selected\.email\}/, "the customer profile cannot launch an untracked admin email");
  assert.doesNotMatch(adminPage, /mailto:\$\{m\.email\}/, "legacy enquiries cannot launch untracked admin email");
  assert.match(adminPage, /api\.contact\.openCentralThread/, "legacy enquiries are imported into a tracked email thread before replying");
  assert.doesNotMatch(adminPage, /Open in Messages|Enquiries \(/, "legacy enquiry cards are removed from the duplicate admin page");
  assert.match(adminPage, /attemptedLegacyEnquiries/, "older enquiries are migrated automatically into tracked email threads");
  assert.match(adminPage, /row\.routedTo == null \|\| row\.routedTo === "central-email"/, "automatic migration is limited to untagged old email and orphaned central-email rows");
  assert.match(adminPage, /data-testid="admin-other-requests"/, "crew, community and voice requests remain available in the new Messages workspace");
  assert.match(adminPage, /Open conversation/, "an admin can deliberately move a non-email request into the tracked inbox");
  assert.match(adminPage, /canReplyToOtherRequest/, "requests without a real renter address never get a misleading reply action");
  assert.match(voiceSource, /email: email \|\| ""/, "voice callbacks without an email do not use a fake sender address");
  assert.match(contactSource, /no renter email address to reply to/, "the backend rejects old fake voice reply addresses too");
  assert.match(accountPanel, /data-testid="admin-open-email-thread"/, "the profile opens the tracked email inbox");
  assert.match(adminPage, /focusEmail=\{focusEmailAddress\}/, "the admin page passes the selected renter email into Messages");
  assert.match(rentalInbox, /setStage\("emails"\)/, "the renter email action opens the shared Emails stage");
  assert.match(rentalInbox, /thread\.email\.trim\(\)\.toLowerCase\(\) === address/, "the shared inbox selects the renter's tracked email thread");
  assert.match(rentalInbox, /Open DB Cinema inbox/, "admins can open the canonical Gmail account from the shared email panel");
  assert.match(rentalInbox, /CONTACT_EMAIL/, "the new email UI reads the single canonical business mailbox setting");
  assert.doesNotMatch(rentalInbox, /dbcinemarentals@gmail\.com/, "the new email UI does not duplicate the business mailbox literal");
  assert.match(rentalInbox, /replies return to this tracked email thread/, "email reply guidance matches the private per-thread Reply-To route");
  assert.match(rentalInbox, /Per-thread reply routing is configured; live delivery still needs a test\./, "configured routing is not presented as proven provider delivery");
  assert.doesNotMatch(rentalInbox, /Standard replies go to \$\{emailInbox\.replyToAddress/, "the shared forwarding alias is not mislabeled as the reply destination");
  assert.match(inboundRoute, /api\.emailInbox\.sendAssistantReply/, "contact-form replies use Gaffer's tracked email thread outbox");
  assert.match(inboundRoute, /function inboundRecipient\(/, "legacy inbound replies fall back to the configured central receiving route");
  assert.doesNotMatch(inboundRoute, /INBOUND_EMAIL_DOMAIN|`gaffer\+\$\{replyKey\}/, "retired domain-based reply aliases cannot create fake recipient addresses");
  assert.match(notify, /api\/email\/inbound/, "automatic contact replies enter the same signed Gaffer email workflow");
  assert.doesNotMatch(contactAlert, /Reply to this email to answer .* directly/, "team alerts cannot bypass the tracked customer conversation");
  assert.doesNotMatch(contactAlert, /undefined,\s*a\.email/, "the team alert no longer routes direct replies around the shared inbox");
  assert.match(contactAlert, /Admin → Messages → Other requests/, "crew and collective alerts link to their actual queue instead of the Emails inbox");
  assert.match(contactAlert, /open it as a conversation/, "staff are directed to create a tracked email conversation before replying");
  assert.match(checkoutPage, /account\.token \? "\/account\?conversation=general#chat" : "\/contact"/, "checkout help stays in the renter support chat or tracked contact form instead of relying on an obsolete mailbox");
  assert.match(businessEmail, /BUSINESS_CONTACT_EMAIL\s*=\s*"dbcinemarentals@gmail\.com"/, "the Gmail address is the canonical business contact address");
  assert.match(site, /CONTACT_EMAIL\s*=\s*BUSINESS_CONTACT_EMAIL/, "public contact pages inherit the canonical business email");
  assert.match(emailLink, /CONTACT_EMAIL/, "public email links use the canonical address");
  assert.match(gafferSource, /tracked Gaffer conversation/, "Gaffer routes ordinary support into the tracked contact conversation");
  assert.match(gafferSource, /Only if the customer explicitly asks to email us, provide \[Email the team\]\(mailto:\$\{CONTACT_EMAIL\}\)/, "Gaffer offers the centralized email only when the renter requests email");
  assert.match(gafferSource, /Always try to resolve the renter's question first/, "Gaffer attempts the answer before a contact handoff");
  assert.match(invoiceDocument, /CONTACT_EMAIL/, "rental invoices use the same canonical business contact address");
  assert.match(swapAdjustmentDocument, /CONTACT_EMAIL/, "adjustment invoices use the same canonical business contact address");
  assert.match(invoiceSource, /sendRentalContextEmail\(/, "invoice emails enter the tracked rental email thread");
  assert.match(mailerSource, /https:\/\/api\.resend\.com\/emails/, "website sending uses the Resend API, not Gmail OAuth/SMTP");
  assert.doesNotMatch(invoiceSource, /whichever of Gmail\/Resend is configured/i, "invoice transport documentation cannot imply Gmail is a website sending credential");
  const currentContactSurfaces = [
    "../src/app/contact/page.tsx",
    "../src/app/checkout/page.tsx",
    "../src/app/legal/[slug]/page.tsx",
    "../shared/legalDocuments.ts",
    "../shared/legal-history/2026-11-v27.ts",
    "../shared/rentalEmail.ts",
    "../shared/returnStatement.ts",
    "../src/lib/invoice/InvoiceDocument.tsx",
    "../src/lib/invoice/SwapAdjustmentDocument.tsx",
    "../src/components/EmailLink.tsx",
    "../src/components/rentals/RentalConversation.tsx",
    "../src/lib/gaffer.ts",
    "../scripts/gaffer-system-prompt.js",
    "../scripts/gaffer-knowledge.js",
    "../convex/invoice.ts",
    "../convex/notify.ts",
  ].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
  assert.doesNotMatch(currentContactSurfaces, /bookings@dbcinemarentals\.com/i, "active public, invoice, legal, checkout and chat surfaces cannot regress to the retired public mailbox");

  const ownerReplyThread = put("email_threads", {
    email: "owner-reply@example.invalid",
    subject: "A rental question",
    status: "open",
  });
  const ownerReplyInbound = put("email_messages", {
    threadId: ownerReplyThread._id,
    direction: "in",
    sender: ownerReplyThread.email,
    recipient: "dbcinemarentals@gmail.com",
    subject: ownerReplyThread.subject,
    text: "Can you confirm availability?",
    at: Date.now(),
    messageId: "<owner-reply-inbound@example.invalid>",
    references: [],
    state: "received",
  });
  const ownerReplyId = "12345678-1234-1234-1234-123456789abc";
  const ownerReplyText = "Yes, the kit is available.";
  const providerKeys = [];
  const acceptedProviderKeys = new Set();
  let acceptedEmailCount = 0;
  let failOwnerReplyFinish = true;
  const sendOwnerEmailReply = (replyId = ownerReplyId, text = ownerReplyText) => inbox.sendOwnerReply.handler({
    runQuery: async () => ({ thread: ownerReplyThread, recent: [ownerReplyInbound] }),
    runMutation: async (ref, args) => {
      const name = String(ref).split(".").at(-1);
      if (name === "reserveOwnerReply") return inbox.reserveOwnerReply.handler({ db }, args);
      if (name === "finishOwnerReply") {
        if (failOwnerReplyFinish) {
          failOwnerReplyFinish = false;
          throw new Error("simulated lost finish response");
        }
        return inbox.finishOwnerReply.handler({ db, scheduler: { runAfter: async () => {} } }, args);
      }
      if (name === "markChatOwnerReplyUncertain") return inbox.markChatOwnerReplyUncertain.handler({ db }, args);
      if (name === "markEmailReplyRetryable") return inbox.markEmailReplyRetryable.handler({ db }, args);
      if (name === "markSendFailed") return inbox.markSendFailed.handler({ db }, args);
      throw new Error(`Unexpected owner-reply mutation: ${String(ref)}`);
    },
    runAction: async (ref, args) => {
      assert.match(String(ref), /emailMailer\.sendBusinessReply$/);
      providerKeys.push(args.deliveryKey);
      if (!acceptedProviderKeys.has(args.deliveryKey)) {
        acceptedProviderKeys.add(args.deliveryKey);
        acceptedEmailCount += 1;
      }
      return { sent: true, messageId: `<${args.deliveryKey}@example.invalid>` };
    },
  }, { token: "admin-fixture", threadId: ownerReplyThread._id, replyId, text });

  assert.deepEqual(await sendOwnerEmailReply(), { ok: false, uncertain: true });
  const reservedOwnerReply = [...docs.values()].find(row => row.providerId === `out:email-owner:${ownerReplyThread._id}:${ownerReplyId}`);
  assert.equal(reservedOwnerReply.state, "uncertain", "provider acceptance with a lost database response must be reconciled before retry");
  reservedOwnerReply.leaseUntil = Date.now() - 1;
  assert.deepEqual(await sendOwnerEmailReply(), { ok: false, uncertain: true });
  assert.equal(providerKeys.length, 1, "an uncertain reply is not resent after its provider idempotency window");
  assert.equal(acceptedEmailCount, 1);
  assert.equal(reservedOwnerReply.state, "uncertain");
  assert.deepEqual(await sendOwnerEmailReply(), { ok: false, uncertain: true });
  assert.equal(providerKeys.length, 1, "an uncertain reply remains blocked across action retries");
  await assert.rejects(() => sendOwnerEmailReply(ownerReplyId, "Changed text with the old request ID."), /same email reply text/);
  await assert.rejects(() => sendOwnerEmailReply("invalid", ownerReplyText), /Invalid email reply request/);

  async function ownerReplyFixture(suffix, providerMode) {
    const ownerThread = put("email_threads", {
      email: `owner-${suffix}@example.invalid`,
      subject: `Owner ${suffix} reply`,
      status: "open",
    });
    const ownerInbound = put("email_messages", {
      threadId: ownerThread._id,
      direction: "in",
      sender: ownerThread.email,
      recipient: "dbcinemarentals@gmail.com",
      subject: ownerThread.subject,
      text: "Can you confirm this?",
      at: Date.now(),
      messageId: `<owner-${suffix}-inbound@example.invalid>`,
      references: [],
      state: "received",
    });
    const replyId = `92345678-1234-1234-1234-${suffix === "thrown" ? "123456789abc" : suffix === "ambiguous" ? "223456789abc" : "323456789abc"}`;
    let providerCalls = 0;
    let currentProviderMode = providerMode;
    const send = () => inbox.sendOwnerReply.handler({
      runQuery: async () => ({ thread: ownerThread, recent: [ownerInbound] }),
      runMutation: async (ref, args) => {
        const name = String(ref).split(".").at(-1);
        if (name === "reserveOwnerReply") return inbox.reserveOwnerReply.handler({ db }, args);
        if (name === "finishOwnerReply") return inbox.finishOwnerReply.handler({ db, scheduler: { runAfter: async () => {} } }, args);
        if (name === "markChatOwnerReplyUncertain") return inbox.markChatOwnerReplyUncertain.handler({ db }, args);
        if (name === "markEmailReplyRetryable") return inbox.markEmailReplyRetryable.handler({ db }, args);
        throw new Error(`Unexpected ${suffix} owner reply mutation: ${name}`);
      },
      runAction: async (_ref, args) => {
        providerCalls++;
        if (currentProviderMode === "throw") throw new Error("provider action lost its response");
        if (currentProviderMode === "ambiguous") return { sent: false, ambiguous: true };
        if (currentProviderMode === "rejected") return { sent: false, ambiguous: false };
        return { sent: true, messageId: `<${args.deliveryKey}@example.invalid>` };
      },
    }, { token: "admin-fixture", threadId: ownerThread._id, replyId, text: "We are checking this for you." });
    return { ownerThread, ownerInbound, replyId, send, setProviderMode: mode => { currentProviderMode = mode; }, get providerCalls() { return providerCalls; } };
  }

  for (const mode of ["throw", "ambiguous"]) {
    const owner = await ownerReplyFixture(mode, mode);
    assert.deepEqual(await owner.send(), { ok: false, uncertain: true });
    const outbox = [...docs.values()].find(row => row.threadId === owner.ownerThread._id && row.direction === "out");
    assert.equal(outbox.state, "uncertain", `${mode} human reply outcomes are marked uncertain immediately`);
    outbox.leaseUntil = Date.now() - 1;
    assert.deepEqual(await owner.send(), { ok: false, uncertain: true });
    assert.equal(owner.providerCalls, 1, `${mode} human reply outcomes cannot be retried after lease expiry`);
    const ownerView = await inbox.adminThread.handler({ db }, { token: "admin-fixture", threadId: owner.ownerThread._id });
    assert.equal(ownerView.replyDeliveryStatus, "uncertain", `${mode} human reply outcomes are visible in the existing owner inbox`);
  }

  const ownerRejected = await ownerReplyFixture("rejected", "rejected");
  await assert.rejects(() => ownerRejected.send(), /could not be sent/);
  const rejectedOwnerOutbox = [...docs.values()].find(row => row.threadId === ownerRejected.ownerThread._id && row.direction === "out");
  assert.equal(rejectedOwnerOutbox.state, "failed");
  assert.match(rejectedOwnerOutbox.error, /^Definite provider rejection:/);
  ownerRejected.setProviderMode("sent");
  assert.deepEqual(await ownerRejected.send(), { ok: true }, "a definite provider rejection can safely retry the same human reply request");
  assert.equal(ownerRejected.providerCalls, 2);

  const conflictingReplyId = "22345678-1234-1234-1234-123456789abc";
  put("email_messages", {
    threadId: "email_threads-other",
    direction: "out",
    recipient: "someone-else@example.invalid",
    text: ownerReplyText,
    providerId: `out:email-owner:${ownerReplyThread._id}:${conflictingReplyId}`,
    state: "failed",
  });
  await assert.rejects(() => sendOwnerEmailReply(conflictingReplyId), /does not match its thread/);
  assert.match(rentalInbox, /replyId: attempt\.replyId/, "the admin keeps the request ID when retrying the same draft");

  function automaticReplyFixture(suffix, providerResult, failFinish = false) {
    const automaticThread = put("email_threads", {
      email: `automatic-${suffix}@example.invalid`,
      subject: `Automatic ${suffix} reply`,
      replyKey: "fedcba9876543210fedcba98",
      status: "open",
    });
    const automaticInbound = put("email_messages", {
      threadId: automaticThread._id,
      direction: "in",
      sender: automaticThread.email,
      recipient: "dbcinemarentals.com",
      subject: automaticThread.subject,
      text: "Can you help?",
      at: Date.now(),
      providerId: `resend-inbound-${suffix}-fixture`,
      messageId: `<automatic-${suffix}-inbound@example.invalid>`,
      references: [],
      state: "processing",
    });
    automaticThread.latestInboundMessageId = automaticInbound._id;
    const payloads = [];
    let failFinishOnce = failFinish;
    const send = (text, humanRequested = false) => inbox.sendAssistantReply.handler({
      runMutation: async (ref, args) => {
        const name = String(ref).split(".").at(-1);
        if (name === "claimAutomaticReply") return inbox.claimAutomaticReply.handler({ db }, args);
        if (name === "finishAutomaticReply") {
          if (failFinishOnce) {
            failFinishOnce = false;
            throw new Error("simulated lost automatic reply finalization");
          }
          return inbox.finishAutomaticReply.handler({ db }, args);
        }
        if (name === "markAutomaticReplyUncertain") return inbox.markAutomaticReplyUncertain.handler({ db }, args);
        if (name === "markEmailReplyRetryable") return inbox.markEmailReplyRetryable.handler({ db }, args);
        throw new Error(`Unexpected automatic-reply mutation: ${String(ref)}`);
      },
      runAction: async (ref, args) => {
        assert.match(String(ref), /emailMailer\.sendBusinessReply$/);
        payloads.push(args);
        if (providerResult === "throw") throw new Error("provider action lost its response");
        return providerResult === "ambiguous"
          ? { sent: false, ambiguous: true }
          : providerResult === "rejected"
            ? { sent: false, ambiguous: false }
            : { sent: true, messageId: `<${args.deliveryKey}@example.invalid>` };
      },
    }, {
      secret: process.env.INBOUND_EMAIL_SECRET,
      threadId: automaticThread._id,
      inboundId: automaticInbound._id,
      text,
      humanRequested,
    });
    return { automaticThread, automaticInbound, payloads, send };
  }

  const automaticFinalize = automaticReplyFixture("finalize", "sent", true);
  assert.deepEqual(await automaticFinalize.send("Original Gaffer response."), { ok: false, uncertain: true });
  const savedAutomaticReply = [...docs.values()].find(row => row.providerId === `out:email-auto:${automaticFinalize.automaticInbound.providerId}`);
  assert.equal(savedAutomaticReply.state, "uncertain", "accepted automatic reply with lost finalization is marked uncertain immediately");
  assert.equal(automaticFinalize.automaticInbound.state, "uncertain", "the inbound event is also closed against duplicate processing");
  savedAutomaticReply.leaseUntil = Date.now() - 1;
  assert.deepEqual(await automaticFinalize.send("A different regenerated answer.", true), { ok: false, uncertain: true });
  assert.equal(automaticFinalize.payloads.length, 1, "automatic follow-up retries never resend an uncertain Gaffer reply");
  assert.equal(savedAutomaticReply.text, "Original Gaffer response.");
  assert.equal(savedAutomaticReply.humanRequested, false, "an uncertain reply remains bound to its original content and handoff state");
  assert.deepEqual(await inbox.claimInbound.handler({ db }, { secret: process.env.INBOUND_EMAIL_SECRET, inboundId: automaticFinalize.automaticInbound._id, humanRequested: false }), { state: "done" }, "Resend retries are acknowledged after the uncertain send is safely fenced");
  const automaticOwnerView = await inbox.adminThread.handler({ db }, { token: "admin-fixture", threadId: automaticFinalize.automaticThread._id });
  assert.equal(automaticOwnerView.replyDeliveryStatus, "uncertain", "the owner sees an unresolved automatic reply in the existing email thread");

  for (const mode of ["ambiguous", "throw"]) {
    const automatic = automaticReplyFixture(mode, mode);
    assert.deepEqual(await automatic.send("Please check this for me."), { ok: false, uncertain: true });
    const outbox = [...docs.values()].find(row => row.providerId === `out:email-auto:${automatic.automaticInbound.providerId}`);
    assert.equal(outbox.state, "uncertain", `${mode} automatic send outcomes are surfaced as uncertain`);
    outbox.leaseUntil = Date.now() - 1;
    assert.deepEqual(await automatic.send("A regenerated answer."), { ok: false, uncertain: true });
    assert.equal(automatic.payloads.length, 1, `${mode} automatic outcomes cannot be retried after lease expiry`);
    const ownerView = await inbox.adminThread.handler({ db }, { token: "admin-fixture", threadId: automatic.automaticThread._id });
    assert.equal(ownerView.replyDeliveryStatus, "uncertain", `${mode} automatic outcomes remain visible in the owner inbox`);
  }

  const automaticDefinite = automaticReplyFixture("rejected", "rejected");
  assert.deepEqual(await automaticDefinite.send("Try this reply."), { ok: false, rejected: true });
  const rejectedOutbox = [...docs.values()].find(row => row.providerId === `out:email-auto:${automaticDefinite.automaticInbound.providerId}`);
  assert.equal(rejectedOutbox.state, "failed");
  assert.match(rejectedOutbox.error, /^Definite provider rejection:/);
  assert.deepEqual(await automaticDefinite.send("Regenerated response."), { ok: false, rejected: true }, "only an explicit provider rejection is re-entered for a safe retry");
  assert.equal(automaticDefinite.payloads.length, 2);

  console.log("PASS email centralization: contact submissions and Gaffer replies/follow-ups share tracked threads; only legacy email rows auto-migrate; other request types stay available in Messages; profile email opens the central inbox; duplicate direct-reply pages stay removed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  delete process.env.ADMIN_TOKEN;
  delete process.env.INBOUND_EMAIL_DOMAIN;
  delete process.env.INBOUND_EMAIL_SECRET;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.INBOUND_REPLY_ADDRESS;
});
