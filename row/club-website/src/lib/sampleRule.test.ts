// Run: node --test src/lib/sampleRule.test.ts  (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRows } from "./sampleRule.ts";

const sample = () => ["sample"];

test("a live visit never sees sample rows, even when the club's list is empty or missing", () => {
  assert.deepEqual(pickRows([], false, sample), []);
  assert.equal(pickRows(null, false, sample), null);
});

test("a preview fills only an empty section; the club's real rows always win", () => {
  assert.deepEqual(pickRows([], true, sample), ["sample"]);
  assert.deepEqual(pickRows(null, true, sample), ["sample"]);
  assert.deepEqual(pickRows(["real"], true, sample), ["real"]);
});
