import { describe, expect, it } from "vitest";
import { moneyLine, parseAmount, reportFileName } from "./serviceHours";

describe("service hours helpers", () => {
  it("joins amounts per currency", () => {
    const fmt = (a: number, c?: string | null) => `${c ?? ""} ${a.toFixed(2)}`.trim();
    expect(moneyLine([{ currency: "LKR", amount: 1500 }, { currency: "", amount: 2 }], fmt)).toBe("LKR 1500.00; 2.00");
    expect(moneyLine([], fmt)).toBe("");
  });

  it("parses amounts", () => {
    expect(parseAmount(" 12.5 ")).toBe(12.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("names the export file", () => {
    expect(reportFileName("Colombo West", "2026-27")).toBe("colombo-west-service-report-2026-27.xlsx");
    expect(reportFileName("", "2026-27")).toBe("service-service-report-2026-27.xlsx");
  });
});
