import assert from "node:assert/strict";
import { test } from "node:test";
import { lateFeeQuote } from "../convex/lib/lateFee.ts";

const camera = { title: "Camera", start: Date.UTC(2026, 8, 29), end: Date.UTC(2026, 8, 30), dailyRate: 100 };

test("no late fee at the agreed London return time", () => {
  assert.equal(lateFeeQuote([camera], "10:00", Date.parse("2026-09-30T09:00:00Z")).amount, 0);
});

test("one commenced day immediately after the return time, two after the next due time", () => {
  assert.equal(lateFeeQuote([camera], "10:00", Date.parse("2026-09-30T09:01:00Z")).amount, 100);
  assert.equal(lateFeeQuote([camera], "10:00", Date.parse("2026-10-01T08:59:00Z")).amount, 100);
  assert.equal(lateFeeQuote([camera], "10:00", Date.parse("2026-10-01T09:01:00Z")).amount, 200);
});

test("rates are item-specific and absent legacy rates are never charged automatically", () => {
  const old = { title: "Legacy light", start: camera.start, end: camera.end };
  const quote = lateFeeQuote([camera, old], "10:00", Date.parse("2026-10-01T09:01:00Z"));
  assert.equal(quote.amount, 200);
  assert.deepEqual(quote.breakdown.map((line) => line.amount), [200, 0]);
});

test("legacy bookings without an agreed return time cannot be charged automatically", () => {
  assert.equal(lateFeeQuote([camera], null, Date.parse("2026-10-02T12:00:00Z")).amount, 0);
});

test("London daylight-saving change uses the local return slot", () => {
  const line = { ...camera, end: Date.UTC(2026, 9, 25) };
  assert.equal(lateFeeQuote([line], "10:00", Date.parse("2026-10-25T10:00:00Z")).amount, 0);
  assert.equal(lateFeeQuote([line], "10:00", Date.parse("2026-10-25T10:01:00Z")).amount, 100);
});
