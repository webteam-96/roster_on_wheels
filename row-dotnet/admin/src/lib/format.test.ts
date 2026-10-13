import { describe, expect, it } from "vitest";
import { createFormat, numberLocaleFor, rotaryYearOf, todayIn } from "@/lib/format";
import { formatDMY } from "@/lib/dateUtils";
import { formatMoney, shortMoney } from "@/lib/currency";
import { fmtInt } from "@/components/dashboard/formatters";

const india = createFormat("en-IN", "INR", "Asia/Kolkata");

describe("the older helpers follow the instance brand (ROW: USD, en-US)", () => {
  const us = createFormat("en-US", "USD", "UTC");
  it.each([0, 999, 1000, 105000, 12345678])("money %d", (n) => {
    expect(formatMoney(n)).toBe(us.money(n));
  });
  it.each([0, 999, 1000, 12345678])("number %d", (n) => {
    expect(fmtInt(n)).toBe(us.number(n));
  });
  it.each([500, 1500, 250000, 25000000])("moneyShort %d", (n) => {
    expect(shortMoney(n)).toBe(us.moneyShort(n));
  });
  // formatDMY keeps its own unambiguous "01 Aug 2026" style on purpose.
  it("formatDMY writes day, month name, year", () => {
    expect(formatDMY("2026-08-01")).toBe("01 Aug 2026");
  });
});

describe("Indian grouping is still available when a locale asks for it", () => {
  it("lakh and crore", () => {
    expect(india.money(105000)).toBe("₹1,05,000");
    expect(india.moneyShort(25000000)).toBe("₹2.5Cr");
  });
});

describe("other currencies and locales", () => {
  it("yen and won have no decimals", () => {
    const ja = createFormat("ja", "JPY", "Asia/Tokyo");
    expect(ja.money(12000)).toBe("￥12,000");
    expect(createFormat("ko", "KRW", "Asia/Seoul").money(12000.4)).toBe("₩12,000");
  });

  it("euro in French and German", () => {
    expect(createFormat("fr", "EUR", "Europe/Paris").money(1234.5)).toBe("1 234,50 €"); // French spaces are non-breaking
    expect(createFormat("de", "EUR", "Europe/Berlin").money(1234.5)).toBe("1.234,50 €");
  });

  it("dollars keep cents only when present", () => {
    const us = createFormat("en-US", "USD", "America/New_York");
    expect(us.money(105)).toBe("$105");
    expect(us.money(12.5)).toBe("$12.50");
    expect(us.moneyShort(1_250_000)).toBe("$1.3M");
  });

  it("per-call currency overrides the default", () => {
    expect(india.money(100, "USD")).toBe("$100");
  });
});

describe("dates and times", () => {
  const ny = createFormat("en-US", "USD", "America/New_York");

  it("a calendar date is never shifted by the zone", () => {
    expect(ny.date("2026-07-01")).toBe("Jul 01, 2026");
    expect(createFormat("en-US", "USD", "Pacific/Honolulu").date("2026-07-01", "long")).toBe("July 1, 2026");
  });

  it("a timestamp with an offset is shown in the district's zone", () => {
    // 09:00 India time is 23:30 the previous day in New York (EDT).
    expect(ny.time("2026-09-30T09:00:00+05:30")).toBe("11:30 PM");
    expect(ny.date("2026-09-30T09:00:00+05:30")).toBe("Sep 29, 2026");
  });

  it("a timestamp without an offset is shown as written (instance time)", () => {
    expect(ny.time("2026-09-30T14:05:00")).toBe("2:05 PM");
    expect(india.dateTime("2026-09-30T14:05:00")).toBe("30 Sept 2026, 2:05 pm");
  });

  it("month and weekday names follow the language", () => {
    expect(createFormat("fr", "EUR", "Europe/Paris").monthName(8)).toBe("août");
    expect(createFormat("de", "EUR", "Europe/Berlin").weekdayName(1)).toBe("Montag");
  });

  it("empty and invalid input print nothing", () => {
    expect(india.date(null)).toBe("");
    expect(india.date("")).toBe("");
    expect(india.date("not a date")).toBe("");
  });
});

describe("today and the Rotary year", () => {
  it("today is the date in the zone, not the UTC date", () => {
    // 20:00 UTC on 30 Sep is already 1 Oct in India, still 30 Sep in New York.
    const instant = new Date("2026-09-30T20:00:00Z");
    expect(todayIn("Asia/Kolkata", instant)).toBe("2026-10-01");
    expect(todayIn("America/New_York", instant)).toBe("2026-09-30");
  });

  it("the Rotary year runs July to June", () => {
    expect(rotaryYearOf("2026-06-30")).toBe("2025-26");
    expect(rotaryYearOf("2026-07-01")).toBe("2026-27");
    expect(rotaryYearOf("2099-12-31")).toBe("2099-00");
  });
});

describe("number locale", () => {
  it("English interfaces use the brand's number locale; others use the language", () => {
    expect(numberLocaleFor("en", "en-IN")).toBe("en-IN");
    expect(numberLocaleFor("fr", "en-US")).toBe("fr");
  });
});
