// Run: node --test src/lib/eventTime.test.ts  (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventTimeParts, zoneLabelAt } from "./eventTime.ts";

const ny = "America/New_York";

test("a wall-clock time is the club's; a visitor in the same zone sees it once", () => {
  assert.deepEqual(eventTimeParts("2026-10-30T19:00:00", ny, "en-US", ny), { shown: "7:00 PM EDT", mine: null });
});

test("a visitor elsewhere also gets their own time, with the weekday when the day differs", () => {
  assert.deepEqual(eventTimeParts("2026-10-30T19:00:00", ny, "en-US", "Europe/London"), { shown: "7:00 PM EDT", mine: "11:00 PM" });
  assert.deepEqual(eventTimeParts("2026-10-30T19:00:00", ny, "en-US", "Asia/Tokyo"), { shown: "7:00 PM EDT", mine: "Sat 8:00 AM" });
});

test("UTC instants, winter time, bad input", () => {
  assert.equal(eventTimeParts("2026-10-30T23:00:00Z", ny, "en-US", ny)?.shown, "7:00 PM EDT");
  assert.equal(eventTimeParts("2026-12-01T19:00:00", ny, "en-US", ny)?.shown, "7:00 PM EST");
  assert.equal(eventTimeParts("not a date", ny, "en-US", ny), null);
  assert.equal(eventTimeParts("2026-10-30T19:00:00", "Not/AZone", "en-US", ny), null);
});

test("an event's zone label follows daylight saving in the club's zone", () => {
  assert.equal(zoneLabelAt(new Date("2026-07-02T19:00:00"), "America/New_York"), "EDT");
  assert.equal(zoneLabelAt(new Date("2026-12-02T19:00:00"), "America/New_York"), "EST");
  assert.equal(zoneLabelAt(new Date("2026-07-02T19:00:00"), "UTC"), "UTC");
});

test("no zone, or an unknown one, gives no label", () => {
  assert.equal(zoneLabelAt(new Date("2026-07-02T19:00:00"), ""), "");
  assert.equal(zoneLabelAt(new Date("2026-07-02T19:00:00"), "Not/AZone"), "");
});
