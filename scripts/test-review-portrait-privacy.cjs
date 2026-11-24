const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");

const reviews = load("convex/reviews.ts");
const privateAccount = put("accounts", { email: "portrait-review@test.invalid", name: "Portrait fixture" });
const archive = put("verification_archives", { accountId: privateAccount._id, bookingId: "booking_private_fixture", sessionId: "session_private_fixture", status: "complete", source: "didit" });
put("verification_documents", { accountId: privateAccount._id, bookingId: "booking_private_fixture", archiveId: archive._id, sessionId: "session_private_fixture", kind: "selfie-0-reference_image", storageId: "private-selfie-fixture", sha256: "synthetic", size: 1, contentType: "image/jpeg" });
put("reviews", { source: "native", published: true, author: "Portrait fixture", authorAccountId: privateAccount._id, authorImage: "https://storage.test/private-selfie-fixture", authorImagePublic: true, rating: 5, text: "Synthetic review with private portrait metadata.", date: Date.now() });

const optedInAccount = put("accounts", { email: "avatar-review@test.invalid", name: "Avatar fixture", avatarStorageId: "uploaded-avatar-fixture", avatarOwnedStorageId: "uploaded-avatar-fixture" });
put("reviews", { source: "native", published: true, author: "Avatar fixture", authorAccountId: optedInAccount._id, authorImagePublic: true, rating: 5, text: "Synthetic review with an opted-in uploaded avatar.", date: Date.now() + 1 });

const removedGoogleAccount = put("accounts", { email: "removed-google-review@test.invalid", name: "Removed Google fixture", googleAvatarUrl: "https://profiles.test/revoked.jpg", googleAvatarRemoved: true });
put("reviews", { source: "native", published: true, author: "Removed Google fixture", authorAccountId: removedGoogleAccount._id, authorImagePublic: true, rating: 5, text: "Synthetic review after the renter removed their Google photo.", date: Date.now() + 2 });

const guardedDb = {
  ...db,
  query(table) {
    assert(!["verification_archives", "verification_documents"].includes(table), "Public review queries must not read private verification data");
    return db.query(table);
  },
};
const ctx = { db: guardedDb, storage: { getUrl: async (id) => `https://storage.test/${id}` } };

(async () => {
  for (const [name, result] of [
    ["mixed public reviews", await reviews.listPublished.handler(ctx, { limit: 50 })],
    ["native review carousel", await reviews.listNativePublished.handler(ctx, { limit: 100 })],
  ]) {
    const privateReview = result.find((review) => review.author === "Portrait fixture");
    const optedInReview = result.find((review) => review.author === "Avatar fixture");
    const removedGoogleReview = result.find((review) => review.author === "Removed Google fixture");
    assert(privateReview, `${name} includes the synthetic review fixture`);
    assert.equal(privateReview.authorImage, null, `${name} never exposes a verification portrait URL`);
    assert(!("authorAccountId" in privateReview), `${name} never exposes the renter account ID`);
    assert.equal(optedInReview.authorImage, "https://storage.test/uploaded-avatar-fixture", `${name} still supports a deliberately opted-in owned avatar`);
    assert(removedGoogleReview, `${name} includes the synthetic opt-out fixture`);
    assert.equal(removedGoogleReview.authorImage, null, `${name} respects a Google-avatar removal even if stale profile data remains`);
  }
  console.log("PASS review portrait privacy: verification archive images stay private; explicitly opted-in owned avatars remain supported");
})().catch((error) => { console.error(error); process.exitCode = 1; });
