import { describe, expect, it } from "vitest";
import { hoursEntries, timeInput, toRows, toSlots, typedTotal } from "./volunteers";

describe("volunteer helpers", () => {
  it("keeps the stored wall-clock time for the input, whatever zone mark the API adds", () => {
    expect(timeInput("2026-11-01T09:30:00")).toBe("2026-11-01T09:30");
    expect(timeInput("2026-11-01T09:30:00Z")).toBe("2026-11-01T09:30");
    expect(timeInput(null)).toBe("");
  });

  it("round-trips slots through the form rows", () => {
    const rows = toRows([{ id: 4, task: "Set up", startsAt: "2026-11-01T09:30:00", endsAt: null, capacity: 3, filled: 1, signups: [] }]);
    expect(rows[0]).toEqual({ id: 4, task: "Set up", startsAt: "2026-11-01T09:30", endsAt: "", capacity: "3", filled: 1 });
    expect(toSlots([{ ...rows[0], task: "  Set up tables ", capacity: "x" }])).toEqual([
      { id: 4, task: "Set up tables", startsAt: "2026-11-01T09:30", endsAt: null, capacity: 0 },
    ]);
  });

  it("puts the club's wall-clock in the form when the API sends UTC times", () => {
    const rows = toRows([{ id: 5, task: "Cook", startsAt: "2026-11-01T14:30:00Z", endsAt: "2026-11-01T16:00:00Z",
      startsLocal: "2026-11-01T09:30", endsLocal: "2026-11-01T11:00", capacity: 2, filled: 0, signups: [] }]);
    expect(rows[0].startsAt).toBe("2026-11-01T09:30");
    expect(rows[0].endsAt).toBe("2026-11-01T11:00");
  });

  it("turns typed hours into entries and totals them in hundredths", () => {
    const typed = { 7: "0.1", 9: "0.2", 11: "" };
    expect(hoursEntries(typed)).toEqual([
      { signupId: 7, hours: 0.1 },
      { signupId: 9, hours: 0.2 },
      { signupId: 11, hours: null },
    ]);
    expect(typedTotal(typed)).toBe(0.3);
  });
});
