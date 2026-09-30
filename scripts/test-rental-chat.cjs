const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const scheduled = [];
const ctx = {
  db,
  scheduler: {
    runAfter: async (_, ref, args) => scheduled.push({ ref, args }),
  },
};
const a = put("accounts", { _id: "account-a", email: "a@rental-test.invalid" }),
  other = put("accounts", { _id: "account-b", email: "b@rental-test.invalid" });
put("sessions", {
  token: "valid",
  accountId: a._id,
  expiresAt: Date.now() + 600000,
});
put("sessions", {
  token: "expired",
  accountId: a._id,
  expiresAt: Date.now() - 1,
});
put("sessions", {
  token: "foreign",
  accountId: other._id,
  expiresAt: Date.now() + 600000,
});
const item = put("listings", {
  title: "Camera",
  rentalContents: {
    included: ["Camera body"],
    optional: [],
    excluded: [],
    notes: [],
    status: "documented",
    sources: [],
  },
});
const booking = put("bookings", {
  guestEmail: a.email,
  status: "pending_payment",
  total: 120,
  depositAmount: 20,
  lineItems: [
    {
      listingId: item._id,
      title: "Camera",
      start: Date.now() + 86400000,
      end: Date.now() + 86400000,
      qty: 1,
      lineTotal: 100,
    },
  ],
});
const second = put("bookings", {
  ...booking,
  _id: "second-rental",
  status: "returned",
});
const helper = load("convex/lib/rentalChat.ts"),
  chat = load("convex/chat.ts"),
  rental = load("convex/rentalChat.ts");
process.env.ADMIN_TOKEN = "fixture-owner-only";
(async () => {
  assert.equal(await helper.accountForToken(ctx, "expired"), null);
  await assert.rejects(
    chat.send.handler(ctx, {
      token: "expired",
      bookingId: booking._id,
      text: "Denied",
    }),
    /unauthorized/,
  );
  await assert.rejects(
    chat.send.handler(ctx, {
      token: "foreign",
      bookingId: booking._id,
      text: "Denied",
    }),
    /not available/,
  );
  await chat.send.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    text: "What is included?",
  });
  const first = tables.get("messages")[0];
  assert.equal(scheduled[0].args.bookingId, booking._id);
  await helper.postRentalMessage(ctx, {
    accountId: a._id,
    bookingId: second._id,
    sender: "renter",
    text: "Another rental question",
  });
  put("messages", {
    accountId: other._id,
    bookingId: booking._id,
    sender: "renter",
    text: "Legacy forged foreign message",
    at: Date.now(),
    readByOwner: false,
  });
  const cx = await chat._gafferContext.handler(ctx, {
    accountId: a._id,
    focusBookingId: booking._id,
  });
  assert.equal(cx.booking.stage, "pending_payment");
  assert.equal(cx.messages.length, 1);
  assert.equal(cx.messages[0].text, "What is included?");
  assert.equal(
    await chat._postBot.handler(ctx, {
      accountId: a._id,
      bookingId: booking._id,
      replyTo: first._id,
      text: "Rental-specific answer",
    }),
    true,
  );
  assert.equal(
    await chat._postBot.handler(ctx, {
      accountId: a._id,
      bookingId: booking._id,
      replyTo: first._id,
      text: "Duplicate answer",
    }),
    false,
  );
  const bot = tables.get("messages").find((m) => m.sender === "bot");
  assert.equal(bot.bookingId, booking._id);
  await rental.markRead.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    through: bot._id,
  });
  assert.equal(
    (await helper.rentalThread(ctx, a._id, booking._id)).unreadRenter,
    0,
  );
  await rental.sendOwner.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    text: "I will help with this order.",
  });
  await rental.markRead.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    through: bot._id,
  });
  assert.equal(
    (await helper.rentalThread(ctx, a._id, booking._id)).unreadRenter,
    1,
  );
  assert.equal(
    await chat._postBot.handler(ctx, {
      accountId: a._id,
      bookingId: booking._id,
      replyTo: first._id,
      text: "After handoff",
    }),
    false,
  );
  assert.equal(
    (await helper.rentalThread(ctx, a._id, second._id)).escalated,
    false,
  );
  await assert.rejects(
    rental.markRead.handler(ctx, {
      token: "valid",
      bookingId: booking._id,
      through: tables.get("messages").find((m) => m.bookingId === second._id)
        ._id,
    }),
    /Invalid read/,
  );
  const migratedBooking = put("bookings", { ...booking, _id: "legacy-rental" });
  const legacy = put("messages", {
    accountId: a._id,
    bookingId: migratedBooking._id,
    sender: "renter",
    text: "Legacy unread",
    at: 1,
    readByOwner: false,
  });
  await rental.migrateLegacyUnread.handler(ctx, { cursor: null });
  const migrated = await helper.rentalThread(ctx, a._id, migratedBooking._id);
  assert.equal(migrated.unreadOwner, 1);
  await rental.migrateLegacyUnread.handler(ctx, { cursor: null });
  assert.equal(migrated.unreadOwner, 1, "migration does not double count");
  assert.equal(legacy.threadCounted, true);
  console.log(
    "PASS rental chat handlers: expired/foreign sessions; legacy forged rows excluded; exact rental context; duplicate replies rejected; human handoff isolated; newer arrivals stay unread; invalid read markers rejected.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
