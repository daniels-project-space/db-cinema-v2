const assert = require("node:assert/strict");
const { load, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

const inventoryChecks = [];
const chatMessages = [];
let inventoryError = null;
let emailAttempts = 0;
const emailResults = [false, true];
const emailPayloads = [];
setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
setMock("./lib/rentalInventory", { assertRentalInventory: async (_ctx, lines) => { if (inventoryError) throw inventoryError; inventoryChecks.push(lines); } });
setMock("./lib/pricing", { quote: (_pricing, days) => ({ total: days * 100 }) });
setMock("../shared/rentalDuration", { rentalPricingDays: () => 2 });
setMock("./lib/catalogImages", { listingImages: listing => listing.imageSources ?? [] });
setMock("./lib/rentalChat", {
  accountForToken: async () => null,
  postRentalMessage: async (ctx, message) => {
    chatMessages.push(message);
    return ctx.db.insert("messages", { ...message, at: Date.now() });
  },
});
process.env.RESEND_API_KEY = "fixture-resend-key";
process.env.RESEND_FROM = "DB Cinema Rentals <bookings@dbcinemarentals.com>";
process.env.INBOUND_REPLY_ADDRESS = "reply@dbcinemarentals.com";
process.env.APP_URL = "https://dbcinemarentals.com";

process.env.ADMIN_TOKEN = "fixture-admin-token";
const data = load("convex/checkoutCartData.ts");
const carts = load("convex/checkoutCarts.ts");
const inbox = load("convex/emailInbox.ts");
const { checkoutCartUrl } = load("shared/checkoutCartUrl.ts");
const account = put("accounts", { email: "renter@example.invalid", name: "Fixture Renter" });
const listing = put("listings", {
  title: "Sony FX3 camera",
  slug: "sony-fx3-camera",
  active: true,
  stockMappingStatus: "complete",
  components: [{ inventoryUnitId: "fx3-body-1", qty: 1 }],
  pricing: { daily: 100 },
  depositAmount: 50,
  imageSources: ["https://images.example.invalid/sony-fx3.jpg"],
});
const ctx = { db: require("./lib/rentalTestHarness.cjs").db };

const args = {
  token: process.env.ADMIN_TOKEN,
  accountId: account._id,
  email: account.email,
  shareKey: "a".repeat(43),
  lines: [{ listingId: listing._id }],
  sendChat: true,
};

(async () => {
  assert.equal(checkoutCartUrl("x".repeat(43), "https://dbcinemarentals.com/base"), `https://dbcinemarentals.com/cart/quote/${"x".repeat(43)}`);
  assert.equal(checkoutCartUrl("x".repeat(43), "http://localhost:3000"), `http://localhost:3000/cart/quote/${"x".repeat(43)}`);
  assert.throws(() => checkoutCartUrl("x".repeat(43), "http://dbcinemarentals.com"), /not configured securely/);
  assert.throws(() => checkoutCartUrl("bad", "https://dbcinemarentals.com"), /link is invalid/);
  await assert.rejects(data.createAdmin.handler(ctx, { ...args, token: "wrong-token" }), /unauthorized/);
  assert.equal((tables.get("checkout_carts") ?? []).length, 0, "unauthorized users cannot create share links");

  await assert.rejects(data.create.handler(ctx, {
    email: account.email,
    shareKey: "b".repeat(43),
    lines: [{ listingId: listing._id, start: Date.UTC(2026, 10, 6) }],
  }), /both rental dates/);

  await data.create.handler(ctx, { email: account.email, shareKey: "c".repeat(43), lines: [{ listingId: listing._id }] });
  const undated = await data.get.handler(ctx, { shareKey: "c".repeat(43) });
  assert.equal(undated.needsDates, true);
  assert.equal(undated.available, null, "availability is not claimed without dates");
  assert.equal(undated.items[0].total, null);
  assert.equal(undated.items[0].heroImage, listing.imageSources[0], "shared carts use the real listing image");
  assert.equal(inventoryChecks.length, 0, "an undated basket does not reserve or check stock");

  await assert.rejects(data.createAdmin.handler(ctx, { ...args, shareKey: "d".repeat(43), email: "other@example.invalid" }), /email changed/);
  const shared = await data.createAdmin.handler(ctx, args);
  assert.equal(shared.chatSent, true);
  assert.equal(chatMessages.length, 1);
  assert.equal(chatMessages[0].meta.kind, "checkout_cart");
  assert.equal(chatMessages[0].meta.items[0].heroImage, listing.imageSources[0]);
  assert.equal(chatMessages[0].meta.path, `/cart/quote/${args.shareKey}`);
  assert.equal(chatMessages[0].meta.total, undefined, "undated carts never invent a quote");
  assert.equal((tables.get("reservations") ?? []).length, 0, "building and sharing a basket never holds inventory");

  const repeated = await data.createAdmin.handler(ctx, args);
  assert.equal(repeated.chatSent, true);
  assert.equal(chatMessages.length, 1, "retrying the same share key never duplicates the chat card");

  const dated = await data.get.handler(ctx, { shareKey: args.shareKey, start: Date.UTC(2026, 10, 6), end: Date.UTC(2026, 10, 7) });
  assert.equal(dated.needsDates, false);
  assert.equal(dated.available, true);
  assert.equal(dated.items[0].total, 200);
  assert.equal(inventoryChecks.length, 1, "availability is checked only after dates are supplied");
  assert.equal((tables.get("reservations") ?? []).length, 0, "availability checks remain read-only");
  inventoryError = new Error("Rental Manager inventory service temporarily unavailable");
  const uncertainAvailability = await data.get.handler(ctx, { shareKey: args.shareKey, start: Date.UTC(2026, 10, 6), end: Date.UTC(2026, 10, 7) });
  assert.equal(uncertainAvailability.available, null, "an inventory-system failure is not misreported as sold out");
  assert.equal(uncertainAvailability.availabilityCheckFailed, true);
  inventoryError = Object.assign(new Error("Sony FX3 is already reserved"), { code: "RENTAL_INVENTORY_UNAVAILABLE" });
  const unavailable = await data.get.handler(ctx, { shareKey: args.shareKey, start: Date.UTC(2026, 10, 6), end: Date.UTC(2026, 10, 7) });
  assert.equal(unavailable.available, false, "a genuine inventory conflict remains unavailable");
  assert.equal(unavailable.availabilityCheckFailed, false);
  inventoryError = null;

  const emailContext = {
    db: ctx.db,
    runMutation: async (reference, mutationArgs) => inbox[String(reference).split(".").pop()].handler(emailContext, mutationArgs),
    runAction: async (reference, payload) => {
      assert.match(String(reference), /sendBusinessReply/);
      emailAttempts++;
      emailPayloads.push(payload);
      const outcome = emailResults.shift();
      if (outcome instanceof Error) throw outcome;
      return typeof outcome === "object" ? outcome : outcome ? { sent: true, messageId: `<kit-${emailAttempts}@mail.example.invalid>` } : { sent: false };
    },
  };
  const actionCtx = {
    runMutation: async (_reference, mutationArgs) => data.createAdmin.handler(ctx, mutationArgs),
    runAction: async (_reference, actionArgs) => inbox.sendCheckoutCartEmail.handler(emailContext, actionArgs),
  };
  const cartCountBeforeUnsafeLink = (tables.get("checkout_carts") ?? []).length;
  const chatCountBeforeUnsafeLink = chatMessages.length;
  process.env.APP_URL = "http://dbcinemarentals.com";
  await assert.rejects(carts.adminShare.handler(actionCtx, { ...args, shareKey: "z".repeat(43), delivery: "chat" }), /not configured securely/);
  assert.equal((tables.get("checkout_carts") ?? []).length, cartCountBeforeUnsafeLink, "an insecure base URL is rejected before a cart or chat card is created");
  assert.equal(chatMessages.length, chatCountBeforeUnsafeLink);
  process.env.APP_URL = "https://dbcinemarentals.com";
  const actionArgs = { ...args, shareKey: "e".repeat(43), delivery: "both" };
  const first = await carts.adminShare.handler(actionCtx, actionArgs);
  assert.equal(first.chatSent, true);
  assert.equal(first.emailSent, false, "email delivery failure is surfaced without undoing the chat card");
  assert.equal(chatMessages.length, 2);
  const retry = await carts.adminShare.handler(actionCtx, { ...actionArgs, delivery: "email" });
  assert.equal(retry.emailSent, true);
  assert.equal(emailPayloads[1].subject,emailPayloads[0].subject,'A definite rejection retry keeps the original subject bound to its idempotency key');
  assert.deepEqual(emailPayloads[1].references,emailPayloads[0].references,'A definite rejection retry preserves original email threading');
  assert.equal(chatMessages.length, 2, "retrying email does not duplicate the chat card");
  assert.equal(emailAttempts, 2);
  assert.match(emailPayloads[0].html, /href="https:\/\/dbcinemarentals\.com\/cart\/quote\//);
  assert.match(emailPayloads[0].html, />Review your kit</);
  const outbox = tables.get("email_messages");
  assert.equal(outbox.length, 1, "email retry reuses one centrally tracked outbox row");
  assert.equal(outbox[0].state, "sent");
  const emailThread = tables.get("email_threads").find(thread => thread._id === outbox[0].threadId);
  assert.equal(emailPayloads[0].replyTo, `gaffer+${emailThread.replyKey}@dbcinemarentals.com`, "rental-kit email replies return to their central thread through its private alias");
  const sharedCart = tables.get("checkout_carts").find(cart => cart.shareKey === actionArgs.shareKey);
  assert.equal(outbox[0].profileMessageId, sharedCart.adminChatMessageId, "the chat card is linked to the email instead of duplicated in chat");

  emailResults.push(true);
  const customerActionCtx = {
    runMutation: async (_reference, mutationArgs) => data.create.handler(ctx, mutationArgs),
    runAction: async (_reference, actionArgs) => inbox.sendCheckoutCartEmail.handler(emailContext, actionArgs),
  };
  const outboxBeforeUnsafeEmail = tables.get("email_messages").length;
  process.env.APP_URL = "http://dbcinemarentals.com";
  await assert.rejects(inbox.sendCheckoutCartEmail.handler(emailContext, { email: "guest@example.invalid", shareKey: "y".repeat(43) }), /not configured securely/);
  assert.equal(tables.get("email_messages").length, outboxBeforeUnsafeEmail, "email rejects insecure checkout links before recording an outbound message");
  process.env.APP_URL = "https://dbcinemarentals.com";
  const customerEmail = await carts.email.handler(customerActionCtx, { email: "guest@example.invalid", lines: [{ listingId: listing._id }] });
  assert.match(customerEmail.url, /\/cart\/quote\//);
  assert.equal(emailAttempts, 3, "the customer-facing Gaffer email path also uses the central mail provider");
  assert.equal(tables.get("email_messages").length, 2, "each outgoing cart email is present in the central inbox");
  const retryShareKey = "r".repeat(43);
  emailResults.push(true);
  let loseFirstResponse = true;
  const retryActionCtx = {
    runMutation: async (_reference, mutationArgs) => data.create.handler(ctx, mutationArgs),
    runAction: async (_reference, actionArgs) => {
      const result = await inbox.sendCheckoutCartEmail.handler(emailContext, actionArgs);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("Connection dropped after the provider accepted the email.");
      }
      return result;
    },
  };
  await assert.rejects(carts.email.handler(retryActionCtx, { email: "retry@example.invalid", shareKey: retryShareKey, lines: [{ listingId: listing._id }] }), /could not be confirmed/);
  const attemptsAfterAcceptedEmail = emailAttempts;
  const retriedEmail = await carts.email.handler(retryActionCtx, { email: "retry@example.invalid", shareKey: retryShareKey, lines: [{ listingId: listing._id }] });
  assert.equal(retriedEmail.shareKey, retryShareKey, "the caller can retry a saved cart with the same secure key");
  assert.equal(emailAttempts, attemptsAfterAcceptedEmail, "a retry after provider acceptance returns the sent receipt without emailing again");
  assert.equal(tables.get("email_messages").filter(row => row.recipient === "retry@example.invalid").length, 1, "an uncertain response cannot duplicate the tracked email");
  const ambiguousKey = "q".repeat(43), ambiguousArgs = { email: "ambiguous@example.invalid", shareKey: ambiguousKey, lines: [{ listingId: listing._id }] };
  emailResults.push({ sent: false, ambiguous: true });
  await assert.rejects(carts.email.handler(customerActionCtx, ambiguousArgs), /delivery is unclear/);
  const ambiguousOutbox=(tables.get("email_messages")??[]).find(row=>row.providerId===`out:checkout-cart:${ambiguousKey}`);assert.equal(ambiguousOutbox.state,"uncertain");
  const attemptsBeforeAmbiguousRetry=emailAttempts;await assert.rejects(carts.email.handler(customerActionCtx, ambiguousArgs), /delivery is unclear/);assert.equal(emailAttempts,attemptsBeforeAmbiguousRetry,"ambiguous delivery never silently resends");
  await assert.rejects(carts.email.handler(customerActionCtx, {...ambiguousArgs,shareKey:"n".repeat(43)}), /delivery is unclear/);assert.equal(emailAttempts,attemptsBeforeAmbiguousRetry,"a new cart key cannot bypass an unresolved email in the same thread");
  const thrownKey="p".repeat(43),thrownArgs={email:"thrown@example.invalid",shareKey:thrownKey,lines:[{listingId:listing._id}]};emailResults.push(new Error("provider response lost"));
  await assert.rejects(carts.email.handler(customerActionCtx,thrownArgs),/delivery is unclear/);assert.equal((tables.get("email_messages")??[]).find(row=>row.providerId===`out:checkout-cart:${thrownKey}`).state,"uncertain");
  const finishKey="s".repeat(43),finishArgs={email:"finish@example.invalid",shareKey:finishKey,lines:[{listingId:listing._id}]};emailResults.push(true);
  const failedFinishContext={...emailContext,runMutation:async(ref,mutationArgs)=>{if(String(ref).endsWith("finishOwnerReply"))throw Error("synthetic database response loss");return emailContext.runMutation(ref,mutationArgs)}};
  const failedFinishCartCtx={runMutation:customerActionCtx.runMutation,runAction:async(_ref,args)=>inbox.sendCheckoutCartEmail.handler(failedFinishContext,args)};
  await assert.rejects(carts.email.handler(failedFinishCartCtx,finishArgs),/delivery is unclear/);assert.equal((tables.get("email_messages")??[]).find(row=>row.providerId===`out:checkout-cart:${finishKey}`).state,"uncertain");
  const afterFinishLoss=emailAttempts;await assert.rejects(carts.email.handler(customerActionCtx,finishArgs),/delivery is unclear/);assert.equal(emailAttempts,afterFinishLoss,"lost post-send persistence cannot trigger a second provider send");
  const busyKey="m".repeat(43),busyArgs={email:"busy@example.invalid",shareKey:busyKey,lines:[{listingId:listing._id}]};await data.create.handler(ctx,busyArgs);await inbox.reserveCheckoutCartEmail.handler(emailContext,{email:busyArgs.email,shareKey:busyKey,text:`Your rental kit is ready.\n\nReview your kit: ${checkoutCartUrl(busyKey)}\n\nThis private link expires in seven days. Availability and final pricing are checked at checkout; opening the link does not reserve items or take payment.`});
  await assert.rejects(carts.email.handler(customerActionCtx,busyArgs),/still sending/,"a leased send cannot be reported as success");
  assert.equal((tables.get("reservations") ?? []).length, 0);
  const now = Date.now();
  for (let index = 0; index < 101; index++) put("checkout_carts", { shareKey: String(index).padStart(43, "x"), email: "expired@example.invalid", accountId: account._id, lines: [{ listingId: listing._id }], createdAt: now - 8 * 86400000, expiresAt: now - 1 });
  const activeCart = put("checkout_carts", { shareKey: "a".repeat(42) + "b", email: "active@example.invalid", lines: [{ listingId: listing._id }], createdAt: now, expiresAt: now + 86400000 });
  const cleanupTasks = [];
  const cleanupCtx = { db: ctx.db, scheduler: { runAfter: async (...task) => cleanupTasks.push(task) } };
  const firstCleanup = await data.purgeExpired.handler(cleanupCtx, {});
  assert.equal(firstCleanup.deleted, 100, "cart expiry cleanup is bounded to 100 records per run");
  assert.equal(cleanupTasks.length, 1, "a full cleanup batch schedules exactly one continuation");
  assert.equal(await ctx.db.get(activeCart._id) != null, true, "unexpired kit links are retained");
  const secondCleanup = await data.purgeExpired.handler(cleanupCtx, {});
  assert.equal(secondCleanup.deleted, 1, "the continuation deletes the remaining expired record");
  assert.equal(cleanupTasks.length, 1, "a short final page does not schedule unnecessary work");
  console.log("PASS checkout basket sharing: secure links, optional dates, image cards, truthful availability, paged catalogue, bounded expiry cleanup, and idempotent chat/email retry.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
