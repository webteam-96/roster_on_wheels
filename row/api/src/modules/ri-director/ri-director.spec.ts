import { normalizeDgPhoto } from "./district-governor.controller";
import { normalizeProfilePhoto } from "./international-president.controller";
import { addDays, dayOfWeek, dayRanges, minutesOf, parseSlot, slotsInRanges } from "./training-appointment.service";

describe("training slots", () => {
  const r = (start: string, end: string, id = 1) => ({ id, start: minutesOf(start)!, end: minutesOf(end)! });

  it("lists slot starts that fit inside the ranges", () => {
    expect(slotsInRanges([r("14:30", "16:00"), r("11:30", "12:30")], 30)).toEqual(["11:30", "12:00", "14:30", "15:00", "15:30"]);
    expect(slotsInRanges([r("09:00", "09:20")], 30)).toEqual([]);
  });

  it("lets a date override replace the weekly pattern", () => {
    const monday = "2026-10-12";
    expect(dayOfWeek(monday)).toBe(1);
    const weekly = new Map([[1, [r("10:00", "11:00")]]]);
    expect(dayRanges(monday, weekly, new Map()).ranges).toHaveLength(1);
    expect(dayRanges("2026-10-11", weekly, new Map())).toEqual({ ranges: [], closedReason: "Not available" });
    expect(dayRanges(monday, weekly, new Map([[monday, { allDay: true, reason: "Holiday", ranges: [] }]]))).toEqual({ ranges: [], closedReason: "Holiday" });
    expect(dayRanges(monday, weekly, new Map([[monday, { allDay: false, reason: null, ranges: [r("15:00", "16:00", 9)] }]])).ranges[0].id).toBe(9);
  });

  it("parses slots to the minute and rejects impossible dates", () => {
    expect(parseSlot("2026-10-12T11:30")).toBe("2026-10-12 11:30:00");
    expect(parseSlot("2026-10-12 9:05:59")).toBe("2026-10-12 09:05:00");
    expect(parseSlot("2026-02-30T10:00")).toBeNull();
    expect(parseSlot("tomorrow")).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("photo normalisers", () => {
  it("strips our own read prefix back to the file name", () => {
    expect(normalizeProfilePhoto("/Documents/WebsiteData/International_President/P1.png")).toBe("P1.png");
    expect(normalizeProfilePhoto("/Documents/directory/x.png")).toBe("/Documents/directory/x.png");
    expect(normalizeDgPhoto(" a\\b/DG1.jpg ")).toBe("DG1.jpg");
    expect(normalizeDgPhoto("https://cdn/x.jpg")).toBe("https://cdn/x.jpg");
    expect(normalizeDgPhoto("  ")).toBeNull();
  });
});
