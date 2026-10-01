const assert = require("node:assert/strict");
const {
  load,
  db,
  put,
  tables,
  setMock,
} = require("./lib/rentalTestHarness.cjs");
const { londonDay, DAY } = load("convex/lib/kitPlanning.ts");
const { expandKitCart, mergeKitLines } = load("shared/kitCart.ts");
const { basketKey, stopMatchingRecovery } = load(
  "convex/lib/checkoutRecovery.ts",
);
const plans = load("convex/kitPlans.ts"),
  waitlist = load("convex/waitlist.ts"),
  recovery = load("convex/checkoutRecovery.ts");
const account = put("accounts", { email: "planner@rental-test.invalid" }),
  other = put("accounts", { email: "other@rental-test.invalid" });
put("sessions", {
  token: "a",
  accountId: account._id,
  expiresAt: Date.now() + DAY,
});
put("sessions", {
  token: "b",
  accountId: other._id,
  expiresAt: Date.now() + DAY,
});
put("sessions", { token: "expired", accountId: account._id, expiresAt: 0 });
const unit = put("inventory_units", { quantityOwned: 3 }),
  listing = put("listings", {
    title: "Camera",
    slug: "camera",
    active: true,
    pricing: { daily: 100 },
    depositAmount: 1000,
    components: [{ inventoryUnitId: unit._id, qty: 1 }],
    r2Images: ["https://example.invalid/camera.jpg"],
  });
const listing2 = put("listings", {
  title: "Shared-body kit",
  slug: "body-kit",
  active: true,
  pricing: { daily: 150 },
  depositAmount: 1500,
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});
const start = londonDay() + 30 * DAY,
  end = start + DAY,
  ctx = { db, scheduler: { runAfter: async () => {} } };
(async () => {
  const booked = put("bookings", {
    guestEmail: account.email,
    status: "returned",
    lineItems: [
      { listingId: listing._id, qty: 2, start: 1, end: 2, lineTotal: 1 },
      { listingId: listing2._id, qty: 1, start: 1, end: 2, lineTotal: 1 },
    ],
    removedItems: [{ listingId: "removed", qty: 1 }],
  });
  const source = await plans.source.handler(ctx, {
    token: "a",
    bookingId: booked._id,
  });
  assert.equal(
    source.lines.reduce((n, l) => n + l.qty, 0),
    3,
  );
  assert.ok(!JSON.stringify(source).includes("removed"));
  await assert.rejects(
    () => plans.source.handler(ctx, { token: "b", bookingId: booked._id }),
    /not available/,
  );
  await assert.rejects(
    () =>
      plans.save.handler(ctx, {
        token: "expired",
        title: "Bad",
        lines: [{ listingId: listing._id, qty: 1 }],
      }),
    /sign in/,
  );
  let quote = await plans.preview.handler(ctx, {
    lines: source.lines,
    start,
    end,
  });
  assert.equal(quote.available, true);
  assert.equal(quote.subtotal, 700, "fresh real pricing, not historic £1");
  const cart = expandKitCart(quote.lines);
  assert.equal(cart.length, 3);
  assert.equal(new Set(cart.map((x) => x.key)).size, 3);
  assert.equal(
    cart.reduce((n, i) => n + i.total, 0),
    700,
  );
  const hold = put("reservations", {
    inventoryUnitId: unit._id,
    status: "hold",
    holdExpiresAt: Date.now() - 1,
    start,
    end,
    qty: 3,
  });
  assert.equal(
    (await plans.preview.handler(ctx, { lines: source.lines, start, end }))
      .available,
    true,
    "expired holds do not block kit",
  );
  await db.patch(hold._id, { holdExpiresAt: Date.now() + DAY });
  assert.equal(
    (await plans.preview.handler(ctx, { lines: source.lines, start, end }))
      .available,
    false,
    "shared physical stock is aggregated",
  );
  await db.delete(hold._id);
  assert.equal(
    (
      await plans.preview.handler(ctx, {
        lines: source.lines,
        start: start + 1,
        end,
      })
    ).available,
    false,
  );
  assert.equal(
    (
      await plans.preview.handler(ctx, {
        lines: source.lines,
        start,
        end: start + 366 * DAY,
      })
    ).available,
    false,
  );
  assert.equal(
    (
      await plans.preview.handler(ctx, {
        lines: [{ listingId: listing._id, qty: 0 }],
        start,
        end,
      })
    ).available,
    false,
  );
  const planId = await plans.save.handler(ctx, {
    token: "a",
    title: "Shoot <one>",
    lines: source.lines,
    start,
    end,
  });
  await assert.rejects(
    () => plans.remove.handler(ctx, { token: "b", planId }),
    /not found/,
  );
  const shareKey = await plans.share.handler(ctx, {
    token: "a",
    planId,
    enabled: true,
  });
  assert.equal(shareKey.length, 48);
  const pub = await plans.source.handler(ctx, { shareKey });
  for (const field of [
    "email",
    "accountId",
    "shareKey",
    "token",
    "storeCredit",
  ])
    assert.ok(!Object.keys(pub).includes(field));
  assert.equal(pub.lines.length, 2);
  await plans.share.handler(ctx, { token: "a", planId, enabled: false });
  assert.equal(
    await plans.source.handler(ctx, { shareKey }),
    null,
    "revoke closes published quote",
  );
  const merged = mergeKitLines([
    { listingId: "a", qty: 1 },
    { listingId: "a", qty: 2 },
  ]);
  assert.deepEqual(merged, [{ listingId: "a", qty: 3 }]);
  await waitlist.add.handler(ctx, {
    token: "a",
    email: other.email,
    listingId: listing._id,
    start,
    end,
  });
  const alert = tables.get("availability_waitlist")[0];
  assert.equal(
    alert.email,
    account.email,
    "signed-in destination cannot be spoofed",
  );
  const lease = await waitlist._claim.handler(ctx, { id: alert._id });
  assert.ok(lease);
  assert.equal(
    await waitlist._claim.handler(ctx, { id: alert._id }),
    null,
    "concurrent cron cannot claim same message",
  );
  await waitlist._finish.handler(ctx, {
    id: alert._id,
    leaseUntil: lease.leaseUntil,
    sent: false,
  });
  assert.equal(alert.notified, false, "failed mail remains retryable");
  const retry = await waitlist._claim.handler(ctx, { id: alert._id });
  await waitlist._finish.handler(ctx, {
    id: alert._id,
    leaseUntil: retry.leaseUntil,
    sent: true,
  });
  assert.equal(alert.notified, true);
  assert.ok(alert.deliveredAt);
  await assert.rejects(
    () => waitlist.cancel.handler(ctx, { token: "b", id: alert._id }),
    /not found/,
  );
  const sameDay = put("availability_waitlist", {
    email: account.email,
    listingId: listing._id,
    start: londonDay(),
    end: londonDay(),
    notified: false,
  });
  assert.ok(
    await waitlist._claim.handler(ctx, { id: sameDay._id }),
    "today survives midnight expiry bug",
  );
  await waitlist.cancel.handler(ctx, { token: "a", id: sameDay._id });
  assert.equal(await waitlist._claim.handler(ctx, { id: sameDay._id }), null);
  const lines = [{ listingId: listing._id, qty: 2, start, end }],
    rId = await recovery.sync.handler(ctx, {
      token: "a",
      enabled: true,
      lines,
    });
  assert.ok(rId);
  assert.equal(
    await recovery.sync.handler(ctx, { token: "a", enabled: true, lines }),
    rId,
    "same basket does not reset timer or resend",
  );
  await assert.rejects(
    () => recovery.resume.handler(ctx, { token: "expired", id: rId }),
    /sign in/,
  );
  assert.equal(
    await recovery.resume.handler(ctx, { token: "b", id: rId }),
    null,
    "resume private to owning account",
  );
  const r = await db.get(rId);
  await db.patch(rId, { dueAt: Date.now() - 1 });
  process.env.RENTAL_CHECKOUT_ENABLED = "false";
  assert.equal(
    await recovery._claim.handler(ctx, { id: rId }),
    null,
    "cannot email a disabled checkout",
  );
  process.env.RENTAL_CHECKOUT_ENABLED = "true";
  let c = await recovery._claim.handler(ctx, { id: rId });
  assert.ok(c);
  assert.equal(await recovery._claim.handler(ctx, { id: rId }), null);
  await recovery._finish.handler(ctx, {
    id: rId,
    leaseUntil: c.leaseUntil,
    sent: false,
  });
  assert.equal(r.state, "waiting");
  assert.ok(r.dueAt > Date.now());
  await db.patch(rId, { dueAt: Date.now() - 1 });
  c = await recovery._claim.handler(ctx, { id: rId });
  await recovery.sync.handler(ctx, { token: "a", enabled: false, lines: [] });
  await recovery._finish.handler(ctx, {
    id: rId,
    leaseUntil: c.leaseUntil,
    sent: true,
  });
  assert.equal(r.state, "stopped", "opt-out wins over delayed receipt");
  const id2 = await recovery.sync.handler(ctx, {
    token: "a",
    enabled: true,
    lines: [{ listingId: listing._id, qty: 1, start, end }],
  });
  assert.equal(
    basketKey([{ listingId: listing._id, qty: 2, start, end }]),
    basketKey([
      { listingId: listing._id, qty: 1, start, end },
      { listingId: listing._id, qty: 1, start, end },
    ]),
  );
  await stopMatchingRecovery(
    ctx,
    account.email,
    [{ listingId: listing._id, qty: 1, start, end }],
    booked._id,
  );
  assert.equal((await db.get(id2)).state, "stopped");
  assert.equal(
    await recovery.sync.handler(ctx, {
      token: "a",
      enabled: true,
      lines: [{ listingId: listing._id, qty: 1, start, end }],
    }),
    null,
    "another browser cannot re-arm booked/cancelled basket",
  );

  // External Hygglo reservations carry no website booking ID.
  const external = put("reservations", {
    inventoryUnitId: unit._id,
    status: "confirmed",
    start,
    end,
    qty: 3,
  });
  assert.equal(
    (
      await plans.preview.handler(ctx, {
        lines: [{ listingId: listing._id, qty: 1 }],
        start,
        end,
      })
    ).available,
    false,
  );
  await db.patch(external._id, {
    start: start - 10 * DAY,
    end: start - 8 * DAY,
    qty: 99,
  });
  assert.equal(
    (
      await plans.preview.handler(ctx, {
        lines: [{ listingId: listing._id, qty: 1 }],
        start,
        end,
      })
    ).available,
    true,
    "unrelated historical overbooking cannot block future dates",
  );
  await db.delete(external._id);
  let accepted = false;
  const sentMail = [];
  setMock("./lib/mailer", {
    sendMail: async (mail) => {
      sentMail.push(mail);
      return accepted;
    },
    OWNER_EMAIL: () => "owner@rental-test.invalid",
  });
  const notify = load("convex/notify.ts"),
    recoveryMail = load("convex/checkoutRecoveryMail.ts");
  const functions = { waitlist, checkoutRecovery: recovery };
  const actionCtx = {
    ...ctx,
    runQuery: async (ref, args) => {
      const [group, name] = ref.split(".");
      return functions[group][name].handler(ctx, args);
    },
    runMutation: async (ref, args) => {
      const [group, name] = ref.split(".");
      return functions[group][name].handler(ctx, args);
    },
    runAction: async (ref, args) => {
      assert.equal(ref, "notify.waitlistEmail");
      return notify.waitlistEmail.handler(ctx, args);
    },
  };
  await waitlist.add.handler(ctx, {
    token: "a",
    email: account.email,
    listingId: listing2._id,
    start,
    end,
  });
  assert.equal(
    (await waitlist.checkAndNotify.handler(actionCtx, {})).sent,
    0,
    "action observes actual false delivery result",
  );
  accepted = true;
  assert.equal((await waitlist.checkAndNotify.handler(actionCtx, {})).sent, 1);
  const mail = sentMail.at(-1);
  assert.ok(mail.html.includes("?start="));
  assert.ok(!mail.html.includes("Shoot <one>"));
  const recovery3 = await recovery.sync.handler(ctx, {
    token: "a",
    enabled: true,
    lines: [{ listingId: listing2._id, qty: 1, start, end }],
  });
  await db.patch(recovery3, { dueAt: Date.now() - 1 });
  accepted = false;
  assert.equal((await recoveryMail.processDue.handler(actionCtx, {})).sent, 0);
  assert.equal((await db.get(recovery3)).state, "waiting");
  await db.patch(recovery3, { dueAt: Date.now() - 1 });
  accepted = true;
  assert.equal((await recoveryMail.processDue.handler(actionCtx, {})).sent, 1);
  assert.equal((await db.get(recovery3)).state, "sent");
  assert.equal(
    (await recoveryMail.processDue.handler(actionCtx, {})).sent,
    0,
    "sent recovery cannot be mailed twice",
  );
  console.log(
    "PASS whole-kit quantities/live pricing/shared stock; private plans/revocable sharing; waitlist ownership/today/failed delivery/claims; consent recovery/gates/retry/opt-out/checkout suppression.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
