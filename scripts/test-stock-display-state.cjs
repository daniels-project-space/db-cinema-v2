const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load } = require("./lib/rentalTestHarness.cjs");

const { stockDisplayState } = load("src/lib/stockDisplayState.ts");
const refreshRequired = { available: 0, ok: null, stockStatus: "refresh_required" };

assert.equal(stockDisplayState(undefined), "checking");
assert.equal(stockDisplayState(refreshRequired), "unknown");
assert.notEqual(stockDisplayState(refreshRequired), "unavailable", "a stale Rental Manager snapshot must not be shown as sold out");
assert.equal(stockDisplayState({ available: 0, ok: false }), "unavailable", "a fresh zero-capacity result remains unavailable");
assert.equal(stockDisplayState({ available: 1, ok: false }), "kit-limit", "a full basket remains distinct from zero stock");
assert.equal(stockDisplayState({ available: 1, ok: true }), "available");

const bookingPanel = fs.readFileSync("src/components/booking/BookingPanel.tsx", "utf8");
const cartDates = fs.readFileSync("src/components/cart/CartItemDates.tsx", "utf8");
assert.match(bookingPanel, /stockDisplayState\(cand\)/, "booking availability uses the shared state classifier");
assert.match(bookingPanel, /candidateState === "unavailable" && \(/, "waitlist is offered only for confirmed zero stock");
assert.match(cartDates, /stockDisplayState\(fit\?\.\[item\.listingId\]\)/, "cart date editor uses the shared state classifier");
assert.match(cartDates, /checkedState === "unknown" \|\| checkedState === "checking"/, "date changes reject unknown stock without claiming the item is unavailable");
assert.match(cartDates, /refreshStock\(\{ items: prospective \}\)/, "unknown stock can be rechecked against the shared source");

console.log("PASS stock display state: unknown remains distinct from unavailable; booking, waitlist, and cart date paths preserve that distinction.");
