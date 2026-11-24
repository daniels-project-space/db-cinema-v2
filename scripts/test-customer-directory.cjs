const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const admin = load("convex/accountAdmin.ts");
const { customerAdminVisual, customerSubscriptionTier } = load("shared/customerAdminVisual.ts");
const { earnedEncoreProgress } = load("convex/lib/loyalty.ts");
const { membershipActiveNow, membershipRentalBenefitsActiveNow } = load("shared/membership.ts");
process.env.ADMIN_TOKEN = "fixture-admin";
process.env.VERIFICATION_ARCHIVE_REUSE_ENABLED = "true";
let scans = 0, avatarReads = 0;
const ctx = { db: { ...db, query(table) { scans++; return db.query(table); } }, storage: { getUrl: async () => { avatarReads++; return "https://example.invalid/avatar"; } } };
const approvalAt=Date.now();
const old = put("accounts", { email: "older+camera@example.invalid", name: "Older Cinematographer", address:"1 Example Road", emailVerifiedAt:approvalAt-1000, createdAt: 1, adminMembershipTier: "pro", avatarStorageId: "old-avatar", avatarOwnedStorageId: "old-avatar", hash: "private-hash", stripeCustomerId: "private-provider" });
const source=put('bookings',{accountId:old._id,accountAccessRequired:false,status:'returned',returnedAt:approvalAt,verificationProvider:'didit',diditSessionId:'directory-session',idVerifyStatus:'verified',idVerificationSource:'didit',idVerifiedAt:approvalAt,agreementName:old.name,billingAddress:old.address,renterPersonKey:'fixture',documentExpiresAt:approvalAt+200000,verificationChecks:{identity:'approved',selfie:'approved',address:'approved'}});
old.rentalVerification={sourceBookingId:source._id,name:'older cinematographer',address:'1 example road',verifiedAt:approvalAt,expiresAt:approvalAt+90*86400000};
const proof=put('verification_archives',{accountId:old._id,bookingId:source._id,sessionId:source.diditSessionId,status:'complete'});require('./lib/verificationFiles.cjs').seedVerificationFiles(put,proof);
for (let i = 0; i < 220; i++) put("accounts", { email: `customer${i}@example.invalid`, name: `Customer ${i}`, createdAt: i + 2, idVerified: true, ...(i === 3 ? { rentalVerification: { expiresAt: 1 } } : {}) });
async function find(search, filter = "all", tier = "all", verification = "all", encore = "all") {
 let cursor = null, pageCount = 0; const rows = [];
 do {
  const result = await admin.directory.handler(ctx, { token: "fixture-admin", search, filter, tier, verification, encore, paginationOpts: { numItems: 100, cursor } });
  pageCount++; rows.push(...result.page);
  if (result.isDone) break;
  assert.notEqual(result.continueCursor, cursor); cursor = result.continueCursor;
  assert.ok(pageCount <= (encore === "1" || encore === "2" || encore === "3" ? 20 : 3), "a sparse search must finish at the real end of the directory");
 } while (true);
 return { rows, pageCount };
}
(async () => {
 assert.equal(customerAdminVisual({}), "guest");
 for (const level of [1, 2, 3]) {
  assert.equal(customerAdminVisual({ adminEncoreLevel: level }), "assigned", "An admin override does not masquerade as earned Encore styling");
  assert.equal(customerAdminVisual({}, level), `encore${level}`, `Earned Encore ${level} receives its own visual tier`);
 }
 assert.equal(customerAdminVisual({ loyaltyPolicyVersion: "review-earned-v1", loyaltyLevel: 3 }), "guest", "Cached earned levels can remain stale after an override is removed");
 assert.equal(customerAdminVisual({ loyaltyLevel: 3 }), "guest", "Legacy levels do not imply Encore");
 assert.equal(customerAdminVisual({}, 3), "encore3", "The visible tier can use freshly computed earned progress");
 assert.equal(customerAdminVisual({ adminEncoreLevel: 1 }, 3), "encore3", "Visual Encore styling reflects the source-of-truth earned tier, not a manual access override");
 assert.equal(customerAdminVisual({ adminEncoreLevel: 1 }, 0), "assigned", "A manual assignment without earned history has a distinct visual treatment");
 assert.equal(customerAdminVisual({ adminMembershipTier: "studio" }), "guest", "An administrative grant is not a subscription");
 const subscriber = { stripeSubscriptionId: "sub_fixture", membershipTier: "plus", membershipActive: true, membershipStatus: "active", membershipPaidThrough: Date.now() + 60000 };
 assert.equal(customerSubscriptionTier({ adminMembershipTier: "pro" }), null, "A manual access grant is not a subscription");
 assert.equal(customerSubscriptionTier(subscriber), "plus", "An active Stripe plan has its actual subscription tier");
 assert.equal(customerAdminVisual({ ...subscriber, adminEncoreLevel: 3 }), "subscriber");
 assert.equal(customerAdminVisual({ ...subscriber, membershipPaidThrough: 1 }), "guest");
 const freeTrial = { ...subscriber, membershipStatus: "trialing", membershipTrialEnd: Date.now() + 60000 };
 assert.equal(customerSubscriptionTier(freeTrial), "plus", "A live Stripe trial remains visible as its plan in admin");
 assert.equal(customerAdminVisual(freeTrial), "subscriber", "A live Stripe trial retains its plan badge in admin");
 assert.equal(membershipActiveNow(freeTrial), true, "An unexpired free trial remains active as a billing state");
 assert.equal(membershipRentalBenefitsActiveNow(freeTrial), false, "A free trial without a clean completed rental does not grant recurring rental benefits");
 const returningFreeTrial = { ...freeTrial, membershipTrialFirstRentalCompletedAt: Date.now() };
 assert.equal(membershipActiveNow(returningFreeTrial), true, "First-rental history does not change the trial billing state");
 assert.equal(membershipRentalBenefitsActiveNow(returningFreeTrial), true, "Trial rental benefits begin only after a clean completed rental is recorded");
 assert.equal(customerAdminVisual({ ...subscriber, membershipSource: "collective-comp" }), "guest");
 const denied = await admin.directory.handler(ctx, { token: "wrong", search: "", filter: "all", tier: "all", paginationOpts: { numItems: 100, cursor: null } });
 assert.deepEqual(denied, { page: [], isDone: true, continueCursor: "" }); assert.equal(scans, 0); assert.equal(avatarReads, 0);
 assert.equal(await admin.directoryAccess.handler(ctx, { token: "wrong" }), false);
 const all = await find(""); assert.equal(all.rows.length, 221); assert.equal(new Set(all.rows.map(a => a.id)).size, 221);
 assert.equal(all.rows.at(-1).id, old._id); assert.equal(all.pageCount, 3);
 const byName = await find("  CINEMATOGRAPHER  ", "members", "standard"); assert.equal(byName.pageCount, 3); assert.equal(byName.rows.length, 1); assert.equal(byName.rows[0].id, old._id);
 assert.equal(byName.rows[0].tier, "pro", "The displayed access tier remains the complimentary Pro grant");
 assert.equal(byName.rows[0].subscriptionTier, null, "The subscription filter does not mislabel complimentary access as paid");
 assert.deepEqual((await find("camera@EXAMPLE")).rows.map(a => a.id), [old._id]);
 assert.equal(JSON.stringify(byName.rows).includes("private-hash"), false); assert.equal(JSON.stringify(byName.rows).includes("private-provider"), false);
 assert.equal((await find("Cinematographer", "pending")).rows.length, 0);
 const pending = await find("", "pending"); assert.equal(pending.rows.length, 220); assert(pending.rows.some(row=>row.email==='customer3@example.invalid'));
 assert.equal((await find("", "members", "standard", "verified")).rows.length, 1);
 assert.equal((await find("", "members", "standard", "pending")).rows.length, 0, "Subscription and verification filters must compose");
 const paidPro = put("accounts", { email: "paid-pro@example.invalid", name: "Paid Pro", ...subscriber, membershipTier: "pro" });
 const trialPlus = put("accounts", { email: "trial-plus@example.invalid", name: "Trial Plus", stripeSubscriptionId: "sub_trial", membershipTier: "plus", membershipActive: true, membershipStatus: "trialing", membershipTrialEnd: Date.now() + 60000 });
 const expiredPro = put("accounts", { email: "expired-pro@example.invalid", name: "Expired Pro", stripeSubscriptionId: "sub_expired", membershipTier: "pro", membershipActive: true, membershipStatus: "canceled", membershipPaidThrough: 1 });
 const complimentaryPro = put("accounts", { email: "collective-pro@example.invalid", name: "Collective Pro", stripeSubscriptionId: "sub_collective", membershipTier: "pro", membershipActive: true, membershipStatus: "active", membershipPaidThrough: Date.now() + 60000, membershipSource: "collective-comp" });
 assert.equal((await find("Paid Pro", "all", "pro")).rows[0].id, paidPro._id);
 assert.equal((await find("Trial Plus", "all", "plus")).rows[0].id, trialPlus._id, "An active trial retains its plan tier");
 assert.equal((await find("Expired Pro", "all", "standard")).rows[0].id, expiredPro._id, "Canceled subscriptions are not active plans");
 assert.equal((await find("Collective Pro", "all", "standard")).rows[0].id, complimentaryPro._id, "Complimentary membership does not appear as a subscription");
 put("messages", { accountId: old._id, sender: "renter", text: "Need a cinema camera for Tuesday", at: 1 });
 put("messages", { accountId: old._id, sender: "owner", text: "Cinema camera details", at: 2 });
 const messageArgs = { token: "fixture-admin", search: "cinema camera", filter: "all", tier: "all", verification: "all", view: "all", paginationOpts: { numItems: 100, cursor: null } };
 const beforeMessageSearch = scans;
 assert.deepEqual(await admin.searchMessages.handler(ctx, { ...messageArgs, token: "wrong" }), { page: [], isDone: true, continueCursor: "" });
 assert.equal(scans, beforeMessageSearch, "Unauthorized message search must not query customer data");
 const messageResults = await admin.searchMessages.handler(ctx, messageArgs);
 assert.equal(messageResults.page.length, 1, "Multiple matching messages for one customer must be deduplicated");
 assert.equal(messageResults.page[0].id, old._id);
 assert.equal(messageResults.page[0].visualTier, "guest");
 assert.equal(messageResults.page[0].matchedMessage, "Need a cinema camera for Tuesday");
 assert.equal(JSON.stringify(messageResults).includes("private-hash"), false);
 assert.equal((await admin.searchMessages.handler(ctx, { ...messageArgs, tier: "standard" })).page.length, 1, "A complimentary Pro grant remains in the no-active-subscription filter");
 assert.equal((await admin.searchMessages.handler(ctx, { ...messageArgs, tier: "pro" })).page.length, 0, "A complimentary Pro grant is not an active paid subscription");
 assert.equal((await admin.searchMessages.handler(ctx, { ...messageArgs, filter: "verified" })).page.length, 1);
 assert.equal((await admin.searchMessages.handler(ctx, { ...messageArgs, verification: "pending" })).page.length, 0);
 assert.deepEqual(await admin.searchMessages.handler(ctx, { ...messageArgs, search: "x" }), { page: [], isDone: true, continueCursor: "" });
 for (let i = 0; i < 101; i++) put("messages", { accountId: old._id, sender: "renter", text: "excessive matches", at: i });
 const excessiveFirst = await admin.searchMessages.handler(ctx, { ...messageArgs, search: "excessive" });
 assert.equal(excessiveFirst.page.length, 1);
 assert.equal(excessiveFirst.isDone, false, "A 100-hit page exposes a cursor instead of silently truncating");
 assert.equal(Object.hasOwn(excessiveFirst, "truncated"), false, "The old ambiguous truncation flag is removed");
 const excessiveNext = await admin.searchMessages.handler(ctx, { ...messageArgs, search: "excessive", paginationOpts: { numItems: 100, cursor: excessiveFirst.continueCursor } });
 assert.equal(excessiveNext.page.length, 1, "The next cursor can reach an older hit for an already-seen account");
 assert.equal(excessiveNext.isDone, true);
 const wideAccounts = Array.from({ length: 110 }, (_, index) => put("accounts", { email: `chat-page-${index}@example.invalid`, name: `Chat Page ${index}`, createdAt: 10000 + index }));
 for (let index = 0; index < wideAccounts.length; index++) put("messages", { accountId: wideAccounts[index]._id, sender: "renter", text: "pagination needle result", at: 10000 + index });
 for (let index = 0; index < 10; index++) put("messages", { accountId: wideAccounts[index]._id, sender: "owner", text: "pagination needle older duplicate", at: 11000 + index });
 const wideArgs = { ...messageArgs, search: "pagination needle" };
 const wideFirst = await admin.searchMessages.handler(ctx, wideArgs);
 assert.equal(wideFirst.page.length, 100, "The first cursor page returns the configured 100 matching message hits");
 assert.equal(wideFirst.isDone, false);
 const wideSecond = await admin.searchMessages.handler(ctx, { ...wideArgs, paginationOpts: { numItems: 100, cursor: wideFirst.continueCursor } });
 assert.equal(wideSecond.page.length, 20, "The second page includes older distinct accounts and older matches from already-seen accounts");
 assert.equal(wideSecond.isDone, true);
 const allWideRows = [...wideFirst.page, ...wideSecond.page];
 const uniqueWideRows = new Map(allWideRows.map(row => [row.id, row]));
 assert.equal(uniqueWideRows.size, 110, "Paginating through older message hits finds accounts beyond both former caps");
 assert(wideAccounts.slice(100).every(account => uniqueWideRows.has(account._id)), "Accounts matching only after the first 100 hits remain reachable");
 proof.status='deleted';assert.equal((await find('Cinematographer')).rows[0].verified,false,'deleted archives cannot retain an admin directory verification badge');
 assert.equal((await admin.search.handler(ctx,{token:'fixture-admin',email:old.email})).items[0].verified,false,'admin search shares the same archive gate');proof.status='complete';
 put("bookings", { accountId: old._id, guestEmail: "different@example.invalid", status: "active" });
 put("bookings", { guestEmail: old.email, status: "confirmed" });
 put("bookings", { accountId: "foreign-account", guestEmail: old.email, status: "active" });
 put("bookings", { accountId: old._id, guestEmail: old.email, status: "returned" });
 const credit = put("credits", { accountId: old._id, amount: 25, remaining: 25, status: "active", expiresAt: Date.now() + 100000, reason: "rental_refund:test" });
 put("credits", { accountId: old._id, amount: 100, remaining: 100, status: "active", expiresAt: 1 });
 put("bookings", { guestEmail: old.email, status: "pending_payment", creditAllocations: [{ creditId: credit._id, amount: 5 }] });
 put("chat_threads", { accountId: old._id, unreadOwner: 2, escalated: false, updatedAt: 1 });
 put("chat_threads", { accountId: old._id, unreadOwner: 3, escalated: false, updatedAt: 2 });
 put("chat_threads", { accountId: "foreign-account", unreadOwner: 9, escalated: false, updatedAt: 3 });
 const foreignBooking = put("bookings", { accountId: "foreign-account", guestEmail: old.email, status: "active" });
 put("chat_threads", { accountId: old._id, bookingId: foreignBooking._id, unreadOwner: 19, lastMessage: "Another customer's private message", escalated: false, updatedAt: 4 });
 put("messages", { accountId: old._id, bookingId: foreignBooking._id, sender: "renter", text: "another private search phrase", at: 3 });
 assert.equal((await admin.searchMessages.handler(ctx, { ...messageArgs, search: "private search" })).page.length, 0, "Search must not attribute another account's rental messages to this customer");
 put("messages", { accountId: old._id, bookingId: source._id, sender: "renter", text: "another private search phrase from the correct rental", at: 4 });
 const safeSearch = await admin.searchMessages.handler(ctx, { ...messageArgs, search: "private search" });
 assert.equal(safeSearch.page.length, 1, "A foreign message must not hide a later matching owned message");
 assert.match(safeSearch.page[0].matchedMessage, /correct rental/);
 const beforeMetrics = scans;
 assert.deepEqual(await admin.directoryMetrics.handler(ctx, { token: "wrong", accountIds: [old._id] }), []);
 assert.equal(scans, beforeMetrics, "Unauthorized metrics must not query data");
 const [metric] = await admin.directoryMetrics.handler(ctx, { token: "fixture-admin", accountIds: [old._id, old._id] });
 assert.deepEqual(metric, { id: old._id, activeRentals: 2, activeRentalsMore: false, credit: 20, unreadMessages: 5, lastMessage: null }, "Metrics contain only operational counts; Encore data arrives with the directory row");
 const mismatchedOnly = put("accounts", { email: "mismatched@example.invalid", name: "Mismatched" });
 put("chat_threads", { accountId: mismatchedOnly._id, bookingId: foreignBooking._id, unreadOwner: 1, escalated: false, updatedAt: 5 });
 assert.equal((await find("mismatched", "all", "all", "all")).rows.length, 1);
 const unreadOnly = await admin.directory.handler(ctx, { token: "fixture-admin", search: "mismatched", filter: "all", tier: "all", view: "unread", paginationOpts: { numItems: 100, cursor: null } });
 assert.equal(unreadOnly.page.length, 0, "An unrelated rental must not put a customer in the unread view");
 await assert.rejects(admin.directoryMetrics.handler(ctx, { token: "fixture-admin", accountIds: Array(12).fill(old._id) }), /metrics page/);
 for (let i = 0; i < 105; i++) put("bookings", { accountId: old._id, status: "active" });
 const capped = (await admin.directoryMetrics.handler(ctx, { token: "fixture-admin", accountIds: [old._id] }))[0];
 assert.equal(capped.activeRentals, 100); assert.equal(capped.activeRentalsMore, true, "A bounded count must disclose that more rentals exist");
  assert.equal(capped.activeRentals, 100, "Operational metrics remain independent of Encore history");
 const unresolvedEncore = await find("Older Cinematographer", "all", "all", "all", "3");
 assert.equal(unresolvedEncore.rows.length, 0, "An unresolved capped history must not be falsely included in a specific Encore tier");
 assert.equal(unresolvedEncore.pageCount, 17, "Encore filtering scans at most 20 directory accounts per request");
 const unresolvedEncoreSearch = await admin.searchMessages.handler(ctx, { ...messageArgs, search: "cinema camera", encore: "3" });
 assert.equal(unresolvedEncoreSearch.page.length, 0, "Message search does not assign an unknown Encore level to a specific tier");
 assert.equal(unresolvedEncoreSearch.isDone, true);
 for (const size of [0, 101, 1.5]) await assert.rejects(admin.directory.handler(ctx, { token: "fixture-admin", search: "", filter: "all", tier: "all", paginationOpts: { numItems: size, cursor: null } }), /page size/);
 const earned = put("accounts", { email: "earned@example.invalid", name: "Earned Encore", loyaltyLevel: 0, loyaltyPolicyVersion: "reviewed-clean-completed-rental-earned-v6" });
 const earnedBookings = [];
 for (let index = 0; index < 3; index++) {
  const start = index * 4 * 86400000;
  const title = `Fixture camera ${index}`;
  const actualReturnedAt = Date.now();
  const inspection = [{ key: "legacy:0:0", title, condition: "good", details: "", openCase: false }];
  const paymentIntentId = `pi-earned-${index}`;
  const paidPence = 10000;
  const booking = put("bookings", { accountId: earned._id, guestEmail: earned.email, status: "returned", idVerifyStatus: "verified", stripeCheckoutSessionId: `earned-session-${index}`, stripePaymentIntentId: paymentIntentId, checkoutPaidAt: actualReturnedAt - 86400000, paidConfirmedAt: actualReturnedAt - 86400000, checkoutPaymentAmountPence: paidPence, checkoutExpectedAmountPence: paidPence, checkoutPaymentCurrency: "GBP", checkoutPaymentStatus: "paid", currency: "GBP", total: paidPence / 100, rentalPaidPence: paidPence, pickedUpAt: start, lineItems: [{ title, qty: 1, start, end: start + 86400000 }], depositAmount: 0, actualReturnedAt, returnDecision: { actualReturnedAt, chargeLate: false, lateClaimReason: "", damageKept: 0, depositKept: 0, inspection }, returnStatement: { actualReturnedAt, inspection, damageTotal: 0, damageFromHold: 0, lateAssessed: 0, lateWaived: 0, rentalRefunded: 0 } });
  earnedBookings.push(booking);
 }
 assert.equal((tables.get("reviews") ?? []).filter((review) => review.authorAccountId === earned._id).length, 0, "The earned-progress fixture has no submitted reviews yet");
 assert.equal((await earnedEncoreProgress(ctx, earned)).completed, 0, "Clean returns do not advance reviewed-rental Encore before an honest review");
 for (const [index, booking] of earnedBookings.entries()) put("reviews", { source: "native", authorAccountId: earned._id, verifiedBookingId: booking._id, rating: index === 0 ? 1 : 5, text: "An honest review of this completed rental.", published: true });
 assert.equal((await earnedEncoreProgress(ctx, earned)).completed, 3, "Three separately reviewed clean rentals earn Encore progress; each star rating counts equally");
 const earnedDirectoryRow = (await find("Earned Encore")).rows[0];
 assert.equal(earnedDirectoryRow.earnedEncoreLevel, 3, "The initial directory response includes source-computed earned Encore progress");
 assert.equal(earnedDirectoryRow.encoreLevel, 3, "The initial directory response includes the effective displayed level");
 assert.equal(earnedDirectoryRow.visualTier, "encore3", "Earned styling does not wait for follow-up operational metrics");
 let earnedMetric = (await admin.directoryMetrics.handler(ctx, { token: "fixture-admin", accountIds: [earned._id] }))[0];
 assert.equal(Object.hasOwn(earnedMetric, "earnedEncoreLevel"), false, "Operational metrics do not redundantly recalculate Encore history");
 assert((await find("Earned Encore", "all", "all", "all", "3")).rows.some(row => row.id === earned._id), "The Encore III filter includes an earned tier");
 const assignedEncore = put("accounts", { email: "assigned-encore@example.invalid", name: "Assigned Encore", adminEncoreLevel: 2 });
 assert.equal((await find("Assigned Encore", "all", "all", "all", "2")).rows.length, 0, "An admin-assigned Encore II must not contaminate the earned Encore II filter");
 const assignedDirectoryRow = (await find("Assigned Encore")).rows[0];
 assert.equal(assignedDirectoryRow.earnedEncoreLevel, 0, "The initial directory response keeps manual access out of earned progress");
 assert.equal(assignedDirectoryRow.encoreLevel, 2, "The initial directory response still reports the selected manual access level");
 assert.equal(assignedDirectoryRow.visualTier, "assigned", "Manual access remains visually distinct from earned Encore");
 const assignedMetric = (await admin.directoryMetrics.handler(ctx, { token: "fixture-admin", accountIds: [assignedEncore._id] }))[0];
 assert.equal(Object.hasOwn(assignedMetric, "encoreLevel"), false, "The operational metrics response does not duplicate account tier state");
 put("messages", { accountId: earned._id, sender: "renter", text: "Earned Encore search fixture", at: 10 });
 const earnedMessage = await admin.searchMessages.handler(ctx, { ...messageArgs, search: "Earned Encore search", encore: "3" });
 assert.equal(earnedMessage.page[0]?.id, earned._id, "Message search applies the same earned Encore filter as the directory");
 assert.equal(earnedMessage.page[0]?.earnedEncoreLevel, 3, "Message search includes earned progress in the initial result");
 assert.equal(earnedMessage.page[0]?.visualTier, "encore3", "Message search styles the account from earned progress immediately");
 Object.assign(earned, subscriber);
 earnedMetric = (await admin.directoryMetrics.handler(ctx, { token: "fixture-admin", accountIds: [earned._id] }))[0];
 assert.equal((await find("Earned Encore")).rows[0].visualTier, "subscriber", "Subscription retains its distinct glow in the initial directory row");
 earned.adminEncoreLevel = 1;
 const overrideDirectoryRow = (await find("Earned Encore")).rows[0];
 assert.equal(overrideDirectoryRow.visualTier, "subscriber", "A subscriber retains its glow with a manual override");
 assert.equal(overrideDirectoryRow.encoreLevel, 1, "A manual admin Encore override remains a separate displayed access tier");
 assert.equal(overrideDirectoryRow.earnedEncoreLevel, 3, "Manual assignments do not replace earned progress in the initial row");
 assert((await find("Earned Encore", "all", "all", "all", "3")).rows.some(row => row.id === earned._id), "A manual Encore I assignment does not remove a genuinely earned Encore III from its filter");
 assert.equal((await find("Earned Encore", "all", "all", "all", "1")).rows.length, 0, "A manual Encore I assignment does not place an earned Encore III account in Encore I");
 const earnedOverrideMessage = await admin.searchMessages.handler(ctx, { ...messageArgs, search: "Earned Encore search", encore: "3" });
 assert.equal(earnedOverrideMessage.page[0]?.id, earned._id, "Message search filters by the earned tier despite an admin assignment");
 assert.equal((await admin.searchMessages.handler(ctx, { ...messageArgs, search: "Earned Encore search", encore: "1" })).page.length, 0, "Message search does not substitute the manual Encore assignment for earned tier");
 earned.adminEncoreLevel = undefined;
 const cachedOnly = put("accounts", { email: "cached@example.invalid", loyaltyLevel: 3, loyaltyPolicyVersion: "review-earned-v1" });
 assert.equal((await find("cached@example.invalid")).rows[0].visualTier, "guest", "Cached earned values without qualifying source rentals cannot give the glow");

 // Long histories must not trigger a full booking scan. Earned tiers derive
 // from bounded indexed clean completed rentals with linked native reviews.
 let bookingHistoryRows = 0;
 const tierCtx = { db: { ...db, query(table) {
   const query = db.query(table);
   if (table === "bookings") {
     const iterate = query[Symbol.asyncIterator].bind(query);
     query[Symbol.asyncIterator] = async function* () { for await (const booking of iterate()) { bookingHistoryRows++; yield booking; } };
   }
   return query;
 } } };
 let threeTierBookings = [], threeTierAccount;
 for (const level of [1, 2, 3]) {
   const account = put("accounts", { email: `long-history-tier-${level}@example.invalid`, name: `Long History Tier ${level}` });
   const tierBookings = [];
   for (let index = 0; index < 150; index++) put("bookings", { accountId: account._id, guestEmail: account.email, status: "active" });
   for (let index = 0; index < level; index++) {
     const start = (1000 + index * 4) * 86400000;
     const title = `Long-history camera ${level}-${index}`;
     const actualReturnedAt = Date.now();
     const inspection = [{ key: "legacy:0:0", title, condition: "good", details: "", openCase: false }];
     const paidPence = 10000;
     const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "returned", idVerifyStatus: "verified", stripeCheckoutSessionId: `long-history-${level}-${index}`, stripePaymentIntentId: `pi-long-history-${level}-${index}`, checkoutPaidAt: actualReturnedAt - 86400000, paidConfirmedAt: actualReturnedAt - 86400000, checkoutPaymentAmountPence: paidPence, checkoutExpectedAmountPence: paidPence, checkoutPaymentCurrency: "GBP", checkoutPaymentStatus: "paid", currency: "GBP", total: paidPence / 100, rentalPaidPence: paidPence, pickedUpAt: start, lineItems: [{ title, qty: 1, start, end: start + 86400000 }], depositAmount: 0, actualReturnedAt, returnDecision: { actualReturnedAt, chargeLate: false, lateClaimReason: "", damageKept: 0, depositKept: 0, inspection }, returnStatement: { actualReturnedAt, inspection, damageTotal: 0, damageFromHold: 0, lateAssessed: 0, lateWaived: 0, rentalRefunded: 0 } });
     tierBookings.push(booking);
   }
   assert.equal((tables.get("reviews") ?? []).filter((review) => review.authorAccountId === account._id).length, 0, "The long-history fixture starts without submitted reviews");
   for (const [index, booking] of tierBookings.entries()) put("reviews", { source: "native", authorAccountId: account._id, verifiedBookingId: booking._id, rating: index === 0 ? 1 : 5, text: "An honest review of this completed rental.", published: true });
   const progress = await earnedEncoreProgress(tierCtx, account);
   assert.equal(progress.completed, level, `A history longer than 100 bookings returns exact reviewed-rental Encore ${level}`);
   assert.equal(bookingHistoryRows, 0, "Earned-tier calculation never iterates the account's booking history");
   for (const filterLevel of [1, 2, 3]) {
     const matches = (await find(`Long History Tier ${level}`, "all", "all", "all", String(filterLevel))).rows;
     assert.equal(matches.some(row => row.id === account._id), level === filterLevel, `Encore ${filterLevel} filter uses the exact earned tier ${level}`);
   }
   if (level === 3) { threeTierBookings = tierBookings; threeTierAccount = account; }
 }
 await db.patch(threeTierBookings[0]._id, { returnDecision: { inspection: [{ key: "long-camera-3-0", condition: "issue", details: "Damage recorded", openCase: false }] } });
 assert.equal((await earnedEncoreProgress(tierCtx, threeTierAccount)).completed, 2, "A later return issue immediately invalidates that booking's earned credit");
 const overflowAccount = put("accounts", { email: "bounded-encore-unknown@example.invalid", name: "Bounded Encore Unknown" });
 for (let index = 0; index < 101; index++) {
   put("bookings", { accountId: overflowAccount._id, guestEmail: overflowAccount.email, status: "returned" });
 }
 assert.equal((await earnedEncoreProgress(tierCtx, overflowAccount)).completed, null, "A returned-rental history beyond the bounded read limit stays unknown instead of producing a false tier");
 assert.equal((await find("Bounded Encore Unknown", "all", "all", "all", "1")).rows.length, 0, "An unresolved tier cannot leak into a specific Encore filter");
 const customerUi = fs.readFileSync("src/components/admin/AccountAdmin.tsx", "utf8");
 const customerUiStyles = fs.readFileSync("src/components/admin/AccountAdmin.module.css", "utf8");
 assert.equal((customerUi.match(/type="search"/g) ?? []).length, 1, "The customer page has one search control");
 assert.match(customerUi, /workspaceIdentity=\{\{[^}]*photo:\s*selected\.avatarUrl/, "The selected customer photo is passed into the conversation header");
 assert.match(customerUi, /data-earned-encore=\{earnedEncoreFor\(account\) \?\? "unknown"\}/, "The avatar treatment is tied to computed earned progress, not an admin override");
 assert.match(customerUi, /★ Earned \{encoreName\(earnedEncoreFor\(account\)!\)\}/, "The directory labels earned Encore distinctly from access overrides");
 assert.match(customerUi, /Assigned \$\{encoreName\(assignedEncoreFor\(account\)!\)\}/, "Admin-assigned levels are not presented as earned status");
 for (const level of [1, 2, 3]) assert.match(customerUiStyles, new RegExp(`\\.customer\\[data-earned-encore="${level}"\\] \\.directoryAvatar`), `Earned Encore ${level} has a distinct avatar ring`);
 assert.match(customerUiStyles, /\.customer\.assigned\s*\{/, "A manual Encore assignment uses separate styling");
 for (const [level, label] of [["1", "Encore I · 2%"], ["2", "Encore II · 4%"], ["3", "Encore III · 10%"]]) {
  assert(customerUi.includes(`["${level}", "${label}"]`), `Admin access controls include ${label}`);
 }
 const adminPage = fs.readFileSync("src/app/admin/page.tsx", "utf8");
 const renterAccountPage = fs.readFileSync("src/app/account/page.tsx", "utf8");
 assert.match(adminPage, /<AccountAdmin\s+token=\{token\}/, "The account controls render only inside the admin workspace");
 assert.doesNotMatch(renterAccountPage, /AccountAdmin|api\.accountAdmin\./, "The renter account route cannot import admin controls or call their data endpoints directly");

 const forbiddenReads = [
  ["directory", { search: "", filter: "all", tier: "all", paginationOpts: { numItems: 10, cursor: null } }],
  ["searchMessages", { search: "private", filter: "all", tier: "all", paginationOpts: { numItems: 10, cursor: null } }],
  ["directoryMetrics", { accountIds: [old._id] }],
  ["search", { email: old.email }],
  ["history", { accountId: old._id }],
  ["verificationReviews", { accountId: old._id }],
  ["detail", { accountId: old._id }],
  ["possibleRestrictedIdentityMatches", { bookingId: source._id }],
  ["possibleRestrictedIdentityMatchesForAccount", { accountId: old._id }],
 ];
 const readsBeforeDeniedCalls = scans;
 assert.equal(await admin.directoryAccess.handler(ctx, { token: "wrong" }), false, "The authorization probe reveals only a boolean");
 for (const [name, args] of forbiddenReads) {
  const call = () => admin[name].handler(ctx, { token: "wrong", ...args });
  if (name === "detail" || name === "verificationReviews") await assert.rejects(call, /unauthorized/, `${name} rejects an unauthenticated read`);
  else {
   const result = await call();
   const rows = result.page ?? result.items ?? result.matches ?? result;
   assert.ok(Array.isArray(rows), `${name} returns an empty result instead of account data`);
   assert.equal(rows.length, 0, `${name} exposes no customer data`);
  }
 }
 assert.equal(scans, readsBeforeDeniedCalls, "Unauthorized account-admin reads do not query renter data");

 const writesBeforeDeniedCalls = tables.get("admin_audit_log")?.length ?? 0;
 const changesBeforeDeniedCalls = tables.get("account_admin_changes")?.length ?? 0;
 const notesBeforeDeniedCalls = tables.get("account_admin_notes")?.length ?? 0;
 const forbiddenWrites = [
  ["setStarred", { accountId: old._id, starred: true }],
  ["setLevel", { accountId: old._id, level: "pro", expectedLevel: "automatic", reason: "fixture" }],
  ["setEncoreLevel", { accountId: old._id, level: 1, expectedLevel: "automatic", reason: "fixture" }],
  ["setRentalAccess", { accountId: old._id, level: "pro", expectedLevel: "automatic", encoreLevel: 1, expectedEncoreLevel: "automatic", reason: "fixture" }],
  ["updateProfile", { accountId: old._id, name: "Changed", phone: "", address: "", expected: { name: old.name ?? null, phone: null, address: "1 Example Road" }, reason: "fixture" }],
  ["setBlocked", { accountId: old._id, blocked: true, restrictionClass: "access_only", reason: "fixture", expected: { blockedAt: null, restrictionClass: null, noticeId: null, reason: "", revision: 0 } }],
  ["addNote", { accountId: old._id, text: "unauthorized note" }],
 ];
 for (const [name, args] of forbiddenWrites) {
  await assert.rejects(() => admin[name].handler({ ...ctx, scheduler: { runAfter: async () => {} } }, { token: "wrong", ...args }), /unauthorized/, `${name} rejects an unauthenticated write`);
 }
 assert.equal(old.adminStarred, undefined, "Unauthenticated actions cannot alter the account profile");
 assert.equal(old.adminMembershipTier, "pro", "Unauthenticated actions cannot alter membership access");
 assert.equal(old.blockedAt, undefined, "Unauthenticated actions cannot restrict the account");
 assert.equal(tables.get("admin_audit_log")?.length ?? 0, writesBeforeDeniedCalls, "Denied writes do not create misleading success audit entries");
 assert.equal(tables.get("account_admin_changes")?.length ?? 0, changesBeforeDeniedCalls, "Denied writes do not alter the account change history");
 assert.equal(tables.get("account_admin_notes")?.length ?? 0, notesBeforeDeniedCalls, "Denied writes do not add private account notes");
 console.log("PASS full customer directory: bounded cursors, older name/email matches, active Stripe-plan filters, earned and assigned Encore filters, verification composition, no duplicate accounts and admin-only safe projection.");
})().catch(error => { console.error(error); process.exitCode = 1; });
