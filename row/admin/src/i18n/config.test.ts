import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_LOCALES, isMachineTranslated } from "./config";

describe("which locales are machine-translated", () => {
  it("machine-translates languages that have no message files", () => {
    for (const l of ["fr", "de", "es", "ja", "hi"]) expect(isMachineTranslated(l)).toBe(true);
  });

  it("leaves English and the pseudo-locale to the message files", () => {
    expect(isMachineTranslated("en")).toBe(false);
    expect(isMachineTranslated("en-XA")).toBe(false);
  });

  it("only claims message files that exist on disk", () => {
    for (const l of MESSAGE_LOCALES) {
      expect(fs.existsSync(path.join(__dirname, "../../messages", l, "common.json"))).toBe(true);
    }
  });
});
