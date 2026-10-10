import { Brand, defaultBrand } from "../../brand/brand";
import { parseCelebrationCounts, parseTypes, toDto, trimBody } from "./mobile-notification-feed.service";
import { compareVersions } from "./mobile-version.controller";

describe("mobile", () => {
  beforeAll(() => Brand.initialise(defaultBrand()));

  it("compares app versions part by part", () => {
    expect([compareVersions("1.2.3", "1.4.0"), compareVersions("1.10", "1.9"), compareVersions("1.0", "1"), compareVersions("x.2", "0.2")]).toEqual([-1, 1, 0, 0]);
  });

  it("parses feed filters and digest counters", () => {
    expect([...parseTypes(" Project, event,bogus")]).toEqual(["project", "event"]);
    expect(parseTypes(null).size).toBe(6);
    expect(parseCelebrationCounts("3/1.0")).toEqual([3, 1]);
    expect(parseCelebrationCounts("oops")).toEqual([0, 0]);
    expect(trimBody("  ")).toBeNull();
    expect(trimBody("x".repeat(301))!.length).toBe(301);
  });

  it("turns greeting rows into display text", () => {
    const clubs = new Map([[5, "Club Five"]]);
    const one = toDto({ Type: "greeting", Id: 5, ClubId: 5, ScopeKind: "club", Title: "Asha", Extra: "1/0", DeepLinkType: "celebrations_digest" }, clubs, new Map(), new Map());
    expect([one.title, one.body, one.deepLink.entityId]).toEqual(["Asha's Birthday", "Asha · Club Five", null]);
    const many = toDto({ Type: "greeting", Id: 5, ClubId: 5, ScopeKind: "club", Title: "A, B, C", Extra: "2/1" }, clubs, new Map(), new Map());
    expect(many.title).toBe("2 birthdays and 1 anniversary to celebrate");
    const self = toDto({ Type: "greeting", Id: 9, ClubId: 5, ScopeKind: "club", Title: "Me", Extra: "self_Anniversary" }, clubs, new Map(), new Map());
    expect([self.title, self.body, self.deepLink.entityId]).toEqual(["Happy Anniversary!", "Warm wishes from Club Five.", 9]);
    const ri = toDto({ Type: "document", Id: 1, ClubId: 0, ScopeKind: "ri", Title: "Doc" }, clubs, new Map(), new Map());
    expect([ri.sourceName, ri.body]).toEqual(["Rotary International", "A new document has been published."]);
  });
});
