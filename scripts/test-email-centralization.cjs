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

  const followUpArgs = { email: "renter@example.invalid", name: "Renter Name", subject: "Following up on your call", text: "Here are the items we discussed.", replyKey: "abcdef0123456789abcdef01" };
  const followUpCtx = { db };
  const prepared = await inbox.prepareGafferFollowUp.handler(followUpCtx, followUpArgs);
  assert.equal(prepared.state, "claimed");
  const replay = await inbox.prepareGafferFollowUp.handler(followUpCtx, followUpArgs);
  assert.equal(replay.state, "busy", "a retry cannot create a second outgoing follow-up while its lease is active");
  const followThread = docs.get(String(prepared.threadId));
  const followMessage = docs.get(String(prepared.outboundId));
  assert.equal(followThread.replyKey, followUpArgs.replyKey);
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
      if (String(ref).endsWith("prepareGafferFollowUp")) return { state: "claimed", threadId: "email_threads-thread", outboundId: "email_messages-out", deliveryKey: `gaffer-follow-up:${args.replyKey}` };
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
  assert.equal(deliveredPayload.replyTo, "support@resend-inbox.example.invalid");
  assert.equal(deliveredPayload.deliveryKey, `gaffer-follow-up:${followUpArgs.replyKey}`);

  delete process.env.INBOUND_REPLY_ADDRESS;
  let staleRouteCalls = 0;
  await assert.rejects(inbox.sendGafferFollowUp.handler({
    runMutation: async () => { staleRouteCalls++; return { state: "claimed" }; },
    runAction: async () => { staleRouteCalls++; return { sent: true }; },
  }, followUpArgs), /reply route is not configured/);
  assert.equal(staleRouteCalls, 0, "a stale legacy domain cannot create or send a new follow-up");

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
  const site = fs.readFileSync(path.join(__dirname, "../src/lib/site.ts"), "utf8");
  const invoiceDocument = fs.readFileSync(path.join(__dirname, "../src/lib/invoice/InvoiceDocument.tsx"), "utf8");
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
  assert.match(inboundRoute, /api\.emailInbox\.sendAssistantReply/, "contact-form replies use Gaffer's tracked email thread outbox");
  assert.match(inboundRoute, /function inboundRecipient\(/, "legacy inbound replies fall back to the configured central receiving route");
  assert.doesNotMatch(inboundRoute, /INBOUND_EMAIL_DOMAIN|`gaffer\+\$\{replyKey\}/, "retired domain-based reply aliases cannot create fake recipient addresses");
  assert.match(notify, /api\/email\/inbound/, "automatic contact replies enter the same signed Gaffer email workflow");
  assert.doesNotMatch(contactAlert, /Reply to this email to answer .* directly/, "team alerts cannot bypass the tracked customer conversation");
  assert.doesNotMatch(contactAlert, /undefined,\s*a\.email/, "the team alert no longer routes direct replies around the shared inbox");
  assert.match(contactAlert, /tracked conversation/, "the team alert routes staff to the centralized email conversation");
  assert.match(businessEmail, /BUSINESS_CONTACT_EMAIL\s*=\s*"dbcinemarentals@gmail\.com"/, "the Gmail address is the canonical business contact address");
  assert.match(site, /CONTACT_EMAIL\s*=\s*BUSINESS_CONTACT_EMAIL/, "public contact pages inherit the canonical business email");
  assert.match(emailLink, /CONTACT_EMAIL/, "public email links use the canonical address");
  assert.match(gafferSource, /tracked Gaffer conversation/, "Gaffer routes ordinary support into the tracked contact conversation");
  assert.doesNotMatch(gafferSource, /mailto:\$\{CONTACT_EMAIL\}/, "Gaffer does not bypass conversation tracking with a direct mail link");
  assert.match(invoiceDocument, /CONTACT_EMAIL/, "rental invoices use the same canonical business contact address");
  assert.match(swapAdjustmentDocument, /CONTACT_EMAIL/, "adjustment invoices use the same canonical business contact address");

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
