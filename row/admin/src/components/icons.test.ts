import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as icons from "./icons";

// Module tiles look icons up by the IconClass name stored in module_master (ModuleIcon.tsx).
describe("icon module", () => {
  it("exports every IconClass the seeded modules use", () => {
    const seed = fs.readFileSync(path.join(__dirname, "../../../database/seed-master.sql"), "utf8");
    const names = new Set(
      [...seed.matchAll(/INSERT INTO `module_master` .*?VALUES \(\d+,'[^']*','[^']*',\d+,'[^']*','([^']+)'/g)].map((m) => m[1]),
    );
    expect(names.size).toBeGreaterThan(10);
    const missing = [...names].filter((n) => !(n in icons));
    expect(missing).toEqual([]);
  });
});
