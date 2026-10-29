const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");

process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.invalid";
const baseQuote = {
  start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", days: 1,
  estimated: false, timed: true, stockVerified: true, requirementsComplete: true, complete: false, total: 64,
  requests: [{ subject: "wireless microphone kits", quantity: 4, fulfilled: 3, lines: [
    { listingId: "rode", title: "RØDE two-kit package", slug: "rode", quantity: 1, providedUnits: 2, total: 42, perDay: 42, alternative: false },
    { listingId: "dji2", title: "DJI Mic 2 set", slug: "dji2", quantity: 1, providedUnits: 1, total: 22, perDay: 22, alternative: false },
  ], minimumRentalOffer: {
    listingId: "dji1", title: "DJI Mic 1 set", slug: "dji1", minimumDays: 2, total: 30, alternative: false,
    availability: "available", quantity: 1, providedUnits: 1, end: "2030-11-21", returnTime: "18:00", rentalDays: 2,
  } }],
};
let quote = structuredClone(baseQuote), prepared = [], sent = [];
class FixtureClient {
  async mutation(name, args) {
    if (name === "emailInbox.ingest") return { inboundId: "incoming", threadId: "thread" };
    if (name === "emailInbox.claimInbound") return { state: "claimed", history: [{ role: "user", content: "Four wireless microphone kits" }] };
    if (name === "emailInbox.prepareQuotedCart") { prepared.push(args); return { ok: true }; }
    throw Error(`Unexpected mutation ${name}`);
  }
  async action(name, args) {
    if (name === "emailInbox.sendAssistantReply") { sent.push(args.text); return { ok: true }; }
    throw Error(`Unexpected action ${name}`);
  }
}
setMock("convex/browser", { ConvexHttpClient: FixtureClient });
setMock("@/lib/gaffer", { handleChat: async () => ({ reply: "Here is the checked option.", enquiry: quote, cards: [], humanRequested: false }) });
setMock("@/lib/site", { CONTACT_EMAIL: "support@example.invalid" });
setMock("@/lib/inboundEmail", load("src/lib/inboundEmail.ts"));
const route = load("src/app/api/email/inbound/route.ts");
async function deliver(id) {
  const body = JSON.stringify({ source: "contact-form", contactId: id, name: "Alex", email: "alex@example.invalid", message: "Four wireless microphone kits on 20 November 2030, pickup 10am and return 6pm." });
  return route.POST({ headers: new Headers({ authorization: "Bearer fixture-inbound-secret" }), text: async () => body });
}

(async () => {
  const first = await deliver("checked");
  assert.equal(first.status, 200);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].lines.length, 3);
  assert.equal(prepared[0].lines.find(line => line.listingId === "dji1").end, Date.parse("2030-11-21T00:00:00Z"));
  assert(prepared[0].lines.filter(line => line.listingId !== "dji1").every(line => line.end === Date.parse("2030-11-20T00:00:00Z")));
  assert(sent[0].includes("Review this option and its later return"));
  assert(sent[0].includes("£94.00"));
  assert(!sent[0].endsWith("DB Cinema Rentals Team"), "the common mail sender adds the shared sign-off after formatting");

  quote = structuredClone(baseQuote);
  quote.requests[0].minimumRentalOffer.availability = "unverified";
  prepared = []; sent = [];
  const second = await deliver("unverified");
  assert.equal(second.status, 200);
  assert.equal(prepared.length, 0, "a failed stock check must not prepare a complete basket");
  assert(!sent[0].includes("Review this option and its later return"));
  assert(sent[0].includes("couldn't confirm stock"));
  process.stdout.write("PASS inbound email prepares only a checked mixed-duration basket; delivery is mocked.\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
