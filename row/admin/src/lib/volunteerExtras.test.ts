import { describe, expect, it } from "vitest";
import { emptyFollowup, followupWhen, toExtrasBody, toFollowupRows } from "./volunteerExtras";

describe("volunteer extras helpers", () => {
  it("builds the save body: trimmed text, whole days, a bad number refused by the server", () => {
    const rows = [{ ...emptyFollowup("before"), days: " 3 ", subject: " Hi ", body: " Text " }, { ...emptyFollowup("after"), days: "1.5" }];
    expect(toExtrasBody("  ", rows, [7])).toEqual({
      confirmationText: null,
      followups: [
        { id: null, kind: "before", days: 3, subject: "Hi", body: "Text" },
        { id: null, kind: "after", days: -1, subject: "", body: "" },
      ],
      coordinatorIds: [7],
    });
  });

  it("round-trips follow-ups from the API with days as text", () => {
    expect(toFollowupRows([{ id: 4, kind: "after", days: 0, subject: "s", body: "b", sentCount: 2 }])[0].days).toBe("0");
  });

  it("describes when a follow-up goes", () => {
    expect(followupWhen("before", 1)).toBe("1 day before the slot");
    expect(followupWhen("after", 0)).toBe("when the slot ends");
    expect(followupWhen("after", 3)).toBe("3 days after the slot ends");
  });
});
