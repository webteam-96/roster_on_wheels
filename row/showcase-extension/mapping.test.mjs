// Run: node --test mapping.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOWCASE_FIELDS, showcaseValues } from "./mapping.js";

test("a ROW project becomes Showcase form values", () => {
  const v = showcaseValues({ title: " Clean water ", description: "Wells", projectDate: "2026-09-30T00:00:00",
    location: "Monrovia", areaOfFocus: "Water, sanitation, and hygiene", projectCost: 1200, directBeneficiaries: 300, manHours: 40 });
  assert.deepEqual(v, { title: "Clean water", description: "Wells", startDate: "2026-09-30", location: "Monrovia",
    areaOfFocus: "Water, sanitation, and hygiene", cost: "1200", beneficiaries: "300", volunteerHours: "40" });
});

test("missing values stay empty, never 'null'", () => {
  const v = showcaseValues({ title: "x", projectDate: "not a date" });
  assert.equal(v.startDate, "");
  assert.equal(v.cost, "");
  assert.equal(v.description, "");
});

test("every value has selectors to try", () => {
  for (const k of Object.keys(showcaseValues({}))) assert.ok(SHOWCASE_FIELDS[k]?.length, k);
});
