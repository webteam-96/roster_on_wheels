import { formatDate, formatNumber, parseInvariantNumber, setCulture } from "./dotnet-format";

describe("C# ToString formats (en-US)", () => {
  beforeAll(() => setCulture("en-US"));

  it.each([
    ["2026-09-30T14:05:09", "dd-MMM-yyyy", "30-Sep-2026"],
    ["2026-09-30T14:05:09", "dd MMM yyyy", "30 Sep 2026"],
    ["2026-09-30T14:05:09", "yyyyMMddHHmmss", "20260930140509"],
    ["2026-09-30T14:05:09", "dd/MM/yyyy hh:mm tt", "30/09/2026 02:05 PM"],
    ["2026-09-30T00:05:09", "h:mm tt", "12:05 AM"],
    ["2026-07-01T00:00:00", "MMMM yyyy", "July 2026"],
    ["2026-07-01T00:00:00", "dddd, dd MMMM", "Wednesday, 01 July"],
    ["2026-07-01", "yyyy-MM-dd", "2026-07-01"],
    ["2026-09-30T14:05:09.1234567", "HH:mm:ss.fff", "14:05:09.123"],
    ["2026-09-30T14:05:09", "'Due on' d MMM", "Due on 30 Sep"],
  ])("%s as %s", (value, format, expected) => {
    expect(formatDate(value, format)).toBe(expected);
  });

  it("returns empty for null", () => {
    expect(formatDate(null, "dd-MMM-yyyy")).toBe("");
  });

  it.each([
    [1234567.5, "N2", "1,234,567.50"],
    [1234567.5, "N0", "1,234,568"],
    [12.5, "F2", "12.50"],
    [12.5, "0.00", "12.50"],
    [1234.5, "#,##0", "1,235"],
    [7, "D3", "007"],
  ])("%d as %s", (value, format, expected) => {
    expect(formatNumber(value, format)).toBe(expected);
  });

  it("follows the configured culture for grouping", () => {
    setCulture("en-IN");
    expect(formatNumber(1234567.5, "N2")).toBe("12,34,567.50");
    setCulture("en-US");
  });
});


describe("parseInvariantNumber (NumberStyles.Number)", () => {
  it("parses what decimal.TryParse accepts", () => {
    expect(parseInvariantNumber(" -5 ")).toBe(-5);
    expect(parseInvariantNumber("1,234.5")).toBe(1234.5);
    expect(parseInvariantNumber("3-")).toBe(-3);
    expect(parseInvariantNumber(".5")).toBe(0.5);
    expect(parseInvariantNumber("7.")).toBe(7);
    expect(parseInvariantNumber("+0")).toBe(0);
  });
  it("rejects what it does not", () => {
    for (const s of ["", "abc", "1e5", "--1", "-1-", "1.2.3", null]) expect(parseInvariantNumber(s)).toBeNull();
  });
});
