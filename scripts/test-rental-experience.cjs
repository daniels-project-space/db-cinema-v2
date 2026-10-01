const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { rentalReplyTemplates } = load("convex/lib/rentalReplyTemplates.ts");
const { listingImages } = load("convex/lib/catalogImages.ts");
const settings = { businessAddress: "Private confirmed pickup depot" };
const booking = { status: "pending_payment", fulfilment: "pickup", pickupTime: "10:30", returnTime: "16:00", idVerifyStatus: "requires_input", lineItems: [{ start: Date.UTC(2027,3,1), end: Date.UTC(2027,3,2) }] };
let replies = rentalReplyTemplates(booking, settings);
assert.equal(replies.length, 1);
assert.ok(!JSON.stringify(replies).includes(settings.businessAddress));
assert.ok(!replies.some(r => ["Rental details", "Verification needed"].includes(r.label)));
replies = rentalReplyTemplates({ ...booking, status: "confirmed" }, settings);
assert.match(replies[0].text, /1 Apr 2027 at 10:30/);
assert.match(replies[0].text, /2 Apr 2027 at 16:00/);
assert.ok(replies[0].text.includes(settings.businessAddress));
assert.ok(replies.some(r => r.label === "Resubmit documents"));
assert.ok(!rentalReplyTemplates({ ...booking, status: "confirmed", idVerifyStatus: "verified" }, settings).some(r => r.label === "Resubmit documents"));
for (const status of ["cancelled", "returned"]) assert.ok(!JSON.stringify(rentalReplyTemplates({ ...booking, status }, settings)).includes(settings.businessAddress));
assert.ok(!JSON.stringify(rentalReplyTemplates({ ...booking, status: "confirmed", fulfilment: "delivery" }, settings)).includes(settings.businessAddress));
assert.match(rentalReplyTemplates({ ...booking, status: "confirmed", pickupTime: undefined, returnTime: undefined }, {})[0].text, /time to be confirmed/);
assert.deepEqual(listingImages({ r2Images: ["https://assets.example/a", ""], sourceImages: ["https://source.example/a", "https://assets.example/a"], gallery: ["/gear/a.jpg", "javascript:bad"] }), ["https://assets.example/a", "https://source.example/a", "/gear/a.jpg"]);
assert.deepEqual(listingImages({ r2Images: [], sourceImages: [], gallery: ["/gear/a.jpg"] }), ["/gear/a.jpg"]);
console.log("PASS stage-aware reply templates: no unpaid/cancelled/returned pickup disclosure; no invented times; verification state; real image alternatives preserved.");

(async () => {
  const { db, put, tables } = require("./lib/rentalTestHarness.cjs");
  const { postBookingMessages } = load("convex/chat.ts");
  const account = put("accounts", { email: "stage@rental-test.invalid" });
  put("settings", settings);
  const ctx = { db, scheduler: { runAfter: async () => {} } };
  const rental = put("bookings", { ...booking, guestEmail: account.email, accountId: account._id });
  for (const status of ["pending_payment", "cancelled", "returned"]) {
    await db.patch(rental._id, { status });
    await postBookingMessages.handler(ctx, { bookingId: rental._id });
    assert.equal((tables.get("messages") ?? []).length, 0, `No confirmation for ${status}`);
  }
  await db.patch(rental._id, { status: "confirmed" });
  await postBookingMessages.handler(ctx, { bookingId: rental._id });
  await postBookingMessages.handler(ctx, { bookingId: rental._id });
  assert.equal(tables.get("messages").length, 1, "Confirmation retry cannot duplicate");
  assert.match(tables.get("messages")[0].text, /Private confirmed pickup depot/);
  assert.match(tables.get("messages")[0].text, /10:30/);
  assert.match(tables.get("messages")[0].text, /16:00/);
  console.log("PASS confirmation transaction: current stage, recorded dates/location, persistent retry receipt.");
})().catch(error => { console.error(error); process.exitCode = 1; });

const {groupRentalKit,uniqueKitPhotos}=load("src/lib/rentalKit.ts");
const kit=[{listingId:"camera",title:"Camera",start:1,end:2,qty:1,lineTotal:100,heroImage:"/camera.jpg"},{listingId:"camera",title:"Camera",start:1,end:2,qty:2,lineTotal:200,heroImage:"/camera.jpg"},{listingId:"camera",title:"Camera",start:3,end:4,qty:1,lineTotal:50,heroImage:"/camera.jpg"}];
const groupedKit=groupRentalKit(kit);assert.equal(groupedKit.length,2);assert.equal(groupedKit[0].qty,3);assert.equal(groupedKit[0].lineTotal,300);assert.equal(uniqueKitPhotos(groupedKit).length,1);assert.equal(kit[0].qty,1,"display grouping cannot mutate order");
