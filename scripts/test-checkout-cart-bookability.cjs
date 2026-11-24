const assert = require("node:assert/strict");
const harness = require("./lib/rentalTestHarness.cjs");

harness.setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
let chatMessages = 0;
harness.setMock("./lib/rentalChat", {
  accountForToken: async () => null,
  postRentalMessage: async () => { chatMessages += 1; return `message-${chatMessages}`; },
});
harness.setMock("./lib/rentalInventory", { assertRentalInventory: async () => {} });
harness.setMock("./lib/pricing", { quote: () => ({ total: 10 }) });
harness.setMock("./adminAuth", { assertAdmin: async () => {} });

const checkoutCarts = harness.load("convex/checkoutCartData.ts");
const ctx = { db: harness.db };
const shareKey = value => value.repeat(43).slice(0, 43);
const lineFor = listing => ({ listingId: listing._id });

(async () => {
  const account = harness.put("accounts", { email: "renter@example.test" });
  const valid = harness.put("listings", {
    active: true,
    stockMappingStatus: "complete",
    components: [{ inventoryUnitId: "unit-1", qty: 1 }],
  });
  const displayOnly = harness.put("listings", { active: true, stockMappingStatus: "complete", components: [] });
  const marketingOnly = harness.put("listings", {
    active: true,
    marketingOnly: true,
    stockMappingStatus: "complete",
    components: [{ inventoryUnitId: "unit-2", qty: 1 }],
  });
  const suppressed = harness.put("listings", {
    active: true,
    suppressed: true,
    stockMappingStatus: "complete",
    components: [{ inventoryUnitId: "unit-3", qty: 1 }],
  });
  const cartCount = () => (harness.tables.get("checkout_carts") ?? []).length;

  await assert.rejects(
    checkoutCarts.create.handler(ctx, {
      email: "renter@example.test",
      shareKey: shareKey("a"),
      lines: [lineFor(displayOnly)],
    }),
    /no longer available to rent/,
  );
  await assert.rejects(
    checkoutCarts.create.handler(ctx, {
      email: "renter@example.test",
      shareKey: shareKey("b"),
      lines: [lineFor(marketingOnly)],
    }),
    /no longer available to rent/,
  );
  await assert.rejects(
    checkoutCarts.create.handler(ctx, {
      email: "renter@example.test",
      shareKey: shareKey("g"),
      lines: [lineFor(suppressed)],
    }),
    /no longer available to rent/,
    "suppressed listings cannot enter a customer checkout cart despite having stock mapping",
  );
  await assert.rejects(
    checkoutCarts.createAdmin.handler(ctx, {
      token: "admin",
      accountId: account._id,
      email: "renter@example.test",
      shareKey: shareKey("c"),
      lines: [lineFor(displayOnly)],
      sendChat: false,
    }),
    /no longer available to rent/,
  );
  await assert.rejects(
    checkoutCarts.createAdmin.handler(ctx, {
      token: "admin",
      accountId: account._id,
      email: "renter@example.test",
      shareKey: shareKey("h"),
      lines: [lineFor(suppressed)],
      sendChat: false,
    }),
    /no longer available to rent/,
    "suppressed listings cannot enter an admin-created checkout cart",
  );
  await assert.rejects(
    checkoutCarts.createAdmin.handler(ctx, {
      token: "admin",
      accountId: account._id,
      email: "renter@example.test",
      shareKey: shareKey("d"),
      lines: [lineFor(marketingOnly)],
      sendChat: false,
    }),
    /no longer available to rent/,
  );
  assert.equal(cartCount(), 0, "non-rentable listings cannot create a shareable checkout cart");

  await checkoutCarts.create.handler(ctx, {
    email: "renter@example.test",
    shareKey: shareKey("e"),
    lines: [lineFor(valid)],
  });
  await checkoutCarts.createAdmin.handler(ctx, {
    token: "admin",
    accountId: account._id,
    email: "renter@example.test",
    shareKey: shareKey("f"),
    lines: [lineFor(valid)],
    sendChat: false,
  });
  assert.equal(cartCount(), 2, "both customer and admin flows accept valid rentable listings");
  valid.active = false;
  await assert.rejects(
    checkoutCarts.create.handler(ctx, {
      email: "renter@example.test",
      shareKey: shareKey("e"),
      lines: [lineFor(valid)],
    }),
    /no longer available to rent/,
    "an idempotent customer retry cannot revive a listing after it becomes unavailable",
  );
  await assert.rejects(
    checkoutCarts.createAdmin.handler(ctx, {
      token: "admin",
      accountId: account._id,
      email: "renter@example.test",
      shareKey: shareKey("f"),
      lines: [lineFor(valid)],
      sendChat: true,
    }),
    /no longer available to rent/,
    "an admin retry cannot send a stale kit link after a listing becomes unavailable",
  );
  const staleCart = await checkoutCarts.get.handler(ctx, { shareKey: shareKey("e") });
  assert.equal(staleCart.available, false);
  assert.equal(staleCart.items.length, 0, "a stale quote cannot display unavailable listings as bookable");
  assert.equal(chatMessages, 0, "a stale admin retry cannot post a chat card");
  assert.equal(cartCount(), 2, "retries do not create duplicate or replacement carts");
  process.stdout.write("PASS checkout cart bookability: customer and admin flows reject display-only listings and accept rentable listings.\n");
})().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
