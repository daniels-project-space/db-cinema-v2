const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");

global.crypto ??= webcrypto;
process.env.GOOGLE_CLIENT_ID = "dbc-google-avatar-fixture";

const accounts = load("convex/accounts.ts");
const googleAuth = load("convex/googleAuth.ts");
const { legalVersionForPolicy, CURRENT_PRIVACY_NOTICE_VERSION } = load("shared/legalVersioning.ts");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "dbc-avatar-fixture-key";
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const originalFetch = global.fetch;

const ctx = {
  db,
  storage: { getUrl: async storageId => `https://storage.example.invalid/${storageId}` },
  scheduler: { runAfter: async () => {} },
  runQuery: async (reference, args) => {
    const name = String(reference).split(/[.:]/).at(-1);
    if (name === "_byEmail") return accounts._byEmail.handler(ctx, args);
    if (name === "get") return {};
    throw new Error(`Unexpected query in Google avatar fixture: ${String(reference)}`);
  },
  runMutation: async (reference, args) => {
    const name = String(reference).split(/[.:]/).at(-1);
    if (name === "_upsertGoogle") return googleAuth._upsertGoogle.handler(ctx, args);
    throw new Error(`Unexpected mutation in Google avatar fixture: ${String(reference)}`);
  },
};

function googleCredential({ email, sub, picture, name = "Fixture Google Renter" }) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid, typ: "JWT" });
  const payload = encode({
    iss: "https://accounts.google.com",
    aud: process.env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 300,
    email,
    email_verified: true,
    sub,
    name,
    picture,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

(async () => {
  global.fetch = async url => {
    assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs", "Google sign-in fetches only the public signing certificates");
    return { ok: true, json: async () => ({ keys: [publicJwk] }) };
  };
  try {
    const picture = "https://lh3.googleusercontent.com/fixture-profile-photo=s96-c";
    const login = await googleAuth.signInWithGoogle.handler(ctx, {
      credential: googleCredential({ email: "google-renter@example.invalid", sub: "google-sub-fixture", picture }),
      termsAndPrivacyAcknowledged: true,
      termsVersion: legalVersionForPolicy({}),
      privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
    });

    const created = (tables.get("accounts") ?? []).find(account => account.email === "google-renter@example.invalid");
    assert(created, "A verified Google account creates the local renter account");
    assert.equal(created.googleAvatarUrl, picture, "The signed Google token picture is stored as the default photo");
    const profile = await accounts.me.handler(ctx, { token: login.token });
    assert.equal(profile.avatarUrl, picture, "The account profile API returns the Google photo when no custom photo exists");

    await googleAuth._upsertGoogle.handler(ctx, {
      email: created.email,
      googleId: created.googleId,
      picture: "https://lh3.googleusercontent.com/changed-provider-photo=s96-c",
      token: "fixture-google-second-session",
      termsAndPrivacyAcknowledged: false,
    });
    assert.equal((await accounts.me.handler(ctx, { token: "fixture-google-second-session" })).avatarUrl, picture,
      "A later Google profile refresh cannot unexpectedly replace the saved default");

    await db.patch(created._id, { googleAvatarUrl: undefined, googleAvatarRemoved: true });
    await googleAuth._upsertGoogle.handler(ctx, {
      email: created.email,
      googleId: created.googleId,
      picture,
      token: "fixture-google-removed-session",
      termsAndPrivacyAcknowledged: false,
    });
    assert.equal((await accounts.me.handler(ctx, { token: "fixture-google-removed-session" })).avatarUrl, null,
      "A renter who removed the Google photo is not opted back in by a later sign-in");

    await db.patch(created._id, { avatarStorageId: "fixture-upload", avatarOwnedStorageId: "fixture-upload", googleAvatarUrl: picture, googleAvatarRemoved: false });
    assert.equal((await accounts.me.handler(ctx, { token: "fixture-google-removed-session" })).avatarUrl,
      "https://storage.example.invalid/fixture-upload", "An uploaded renter photo takes priority over the Google default");

    console.log("PASS Google avatar default: signed token picture flows into the account profile; custom uploads win; later provider changes and explicit photo removal are respected.");
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
