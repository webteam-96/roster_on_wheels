import { describe, expect, it } from "vitest";
import { customPageMenuOptions, isValidSlug, moveItem, newSection, pickable, slugify } from "./websiteBuilder";

describe("website builder helpers", () => {
  it("slugify matches the API's address rule", () => {
    expect(slugify("Our History!")).toBe("our-history");
    expect(slugify("  Café   Évents 2026 ")).toBe("cafe-events-2026");
    expect(isValidSlug(slugify("x".repeat(80)))).toBe(true);
    expect(isValidSlug("a--b")).toBe(false);
  });

  it("moveItem reorders and ignores bad indexes", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    const same = [1, 2];
    expect(moveItem(same, 0, 5)).toBe(same);
  });

  it("new data widgets get a heading and a limit", () => {
    const s = newSection("events", 1);
    expect(s.limit).toBe(6);
    expect(s.title).toBe("Upcoming events");
    expect(newSection("richtext", 1).limit).toBeUndefined();
  });

  it("pickers offer only what each section can show", () => {
    const items = [
      { id: 1, fileName: "a.png", contentType: "image/png", membersOnly: false },
      { id: 2, fileName: "b.jpg", contentType: "image/jpeg", membersOnly: true },
      { id: 3, fileName: "c.pdf", contentType: "application/pdf", membersOnly: true },
    ];
    expect(pickable(items, "richtext").map((m) => m.id)).toEqual([1]);
    expect(pickable(items, "image").map((m) => m.id)).toEqual([1, 2]);
    expect(pickable(items, "file").map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("menu options list published custom pages only", () => {
    expect(customPageMenuOptions([
      { slug: "home", title: "Home", isPublished: true },
      { slug: "history", title: "History", isPublished: true },
      { slug: "draft", title: "Draft", isPublished: false },
    ])).toEqual([{ value: "/p/history", label: "Custom page: History" }]);
  });
});
