import { describe, expect, it } from "vitest";
import { applyOverrides } from "@/i18n/messages";

const english = { privacy: { title: "Privacy", export: { button: "Export my data" } }, common: { save: "Save" } };

describe("applyOverrides", () => {
  it("an override wins over the bundled text, at any depth", () => {
    const out = applyOverrides(english, [
      { namespace: "privacy", key: "export.button", text: "Download my data" },
      { namespace: "common", key: "save", text: "Store" },
    ]);
    expect(out).toEqual({ privacy: { title: "Privacy", export: { button: "Download my data" } }, common: { save: "Store" } });
  });

  it("a key without an override keeps the English text, never the key", () => {
    const out = applyOverrides(english, [{ namespace: "privacy", key: "title", text: "Confidentialité" }]);
    expect(out.privacy).toEqual({ title: "Confidentialité", export: { button: "Export my data" } });
  });

  it("ignores namespaces that are not loaded and does not change its input", () => {
    const out = applyOverrides(english, [{ namespace: "payments", key: "x", text: "y" }]);
    expect(out).toEqual(english);
    expect(applyOverrides(english, [{ namespace: "common", key: "save", text: "Z" }])).not.toBe(english);
    expect(english.common.save).toBe("Save");
  });
});
