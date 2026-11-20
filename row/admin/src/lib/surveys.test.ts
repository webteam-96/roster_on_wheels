import { describe, expect, it } from "vitest";
import { localInput, toBody, toForm, toUtc } from "./surveys";
import type { Survey } from "@/types/surveys";

describe("survey form helpers", () => {
  it("round-trips the viewer's local time to UTC and back", () => {
    const d = new Date(2026, 10, 20, 9, 30);
    expect(localInput(new Date(toUtc(localInput(d))))).toBe("2026-11-20T09:30");
    expect(toUtc("")).toBe("");
  });

  it("builds the API body: trims, splits options, drops options on text and rating", () => {
    const f = toForm(null, new Date(2026, 10, 20, 9, 0));
    f.title = "  Venue poll ";
    f.questions = [
      { text: " Where? ", type: "single", required: true, options: "Hotel\n\n Club house \n" },
      { text: "Rate", type: "rating", required: false, options: "left over" },
    ];
    const b = toBody(f);
    expect(b.title).toBe("Venue poll");
    expect(b.description).toBeNull();
    expect(b.subGroupId).toBeNull();
    expect(b.questions[0]).toEqual({ text: "Where?", type: "single", required: true, options: ["Hotel", "Club house"] });
    expect(b.questions[1].options).toEqual([]);
    expect(new Date(b.closesAt).getTime() - new Date(b.opensAt).getTime()).toBe(7 * 864e5);
  });

  it("loads a saved survey into the form", () => {
    const s = {
      id: 1, clubId: 1, districtId: null, subGroupId: 4, subGroupName: "Board", title: "T", description: null,
      isAnonymous: true, showResults: false, state: "draft", opensAt: "2026-11-20T09:00:00Z", closesAt: "2026-11-21T09:00:00Z",
      responseCount: 0, audienceCount: 3, questions: [{ id: 9, text: "Q", type: "multiple", required: false, options: ["A", "B"] }],
    } as Survey;
    const f = toForm(s);
    expect(f.subGroupId).toBe("4");
    expect(f.questions[0].options).toBe("A\nB");
    expect(toBody(f).opensAt).toBe("2026-11-20T09:00:00.000Z");
  });
});
