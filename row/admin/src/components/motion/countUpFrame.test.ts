import { describe, expect, it } from "vitest";
import { countUpFrame } from "./countUpFrame";

describe("countUpFrame", () => {
  it("ends on the exact value", () => {
    for (const v of ["4,118", "$6.7K", "4.9%", "0", "1.234,50 €", "12 345"]) expect(countUpFrame(v, 1)).toBe(v);
  });

  it("keeps prefix, suffix, grouping and decimals on the way", () => {
    expect(countUpFrame("4,118", 0)).toBe("0");
    expect(countUpFrame("4,118", 0.1)).toBe("412");
    expect(countUpFrame("4,118", 0.5)).toBe("2,059");
    expect(countUpFrame("4.118", 0.5)).toBe("2.059");
    expect(countUpFrame("$6.7K", 0)).toBe("$0.0K");
    expect(countUpFrame("$6.7K", 0.5)).toBe("$3.4K");
    expect(countUpFrame("1.234,50 €", 0)).toBe("0,00 €");
    expect(countUpFrame("$12,345.67", 0)).toBe("$0.00");
  });

  it("leaves values with no single number alone", () => {
    for (const v of ["2/5", "2026-27", "–", "Active"]) expect(countUpFrame(v, 0.5)).toBeNull();
  });
});
