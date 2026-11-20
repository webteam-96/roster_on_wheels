import { describe, expect, it } from "vitest";
import { cleanBureauForm, modeText, ratingText, tagList } from "./speakerBureau";

describe("speaker bureau helpers", () => {
  it("describes the average rating", () => {
    expect(ratingText({ averageRating: null, ratingCount: 0 })).toBe("Not rated yet");
    expect(ratingText({ averageRating: 4, ratingCount: 1 })).toBe("4.0 of 5 (1 rating)");
    expect(ratingText({ averageRating: 4.3, ratingCount: 12 })).toBe("4.3 of 5 (12 ratings)");
  });

  it("describes how the speaker talks", () => {
    expect(modeText({ availableOnline: true, availableInPerson: true })).toBe("Online or in person");
    expect(modeText({ availableOnline: true, availableInPerson: false })).toBe("Online");
    expect(modeText({ availableOnline: false, availableInPerson: true })).toBe("In person");
  });

  it("cleans the form and splits tags", () => {
    const f = cleanBureauForm({ name: " Asha ", bio: "  ", topics: " Polio ", languages: "", email: "", phone: null, city: " Colombo ", availableOnline: true, availableInPerson: false });
    expect(f).toEqual({ name: "Asha", bio: null, topics: "Polio", languages: "", email: null, phone: null, city: "Colombo", availableOnline: true, availableInPerson: false });
    expect(tagList(" Polio, ,Water ")).toEqual(["Polio", "Water"]);
  });
});
