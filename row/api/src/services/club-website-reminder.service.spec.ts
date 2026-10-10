import { reminderMarker } from "./club-website-reminder.service";

describe("reminderMarker", () => {
  it("uses the trial and paid milestones", () => {
    expect(reminderMarker(3, false, null)).toBe("Milestone:T-3");
    expect(reminderMarker(15, false, null)).toBeNull();
    expect(reminderMarker(15, true, null)).toBe("Milestone:P-15");
    expect(reminderMarker(2, true, null)).toBeNull();
  });
  it("adds the club's own lead time", () => {
    expect(reminderMarker(10, true, 10)).toBe("Milestone:P-10");
    expect(reminderMarker(10, true, 0)).toBeNull();
  });
});
