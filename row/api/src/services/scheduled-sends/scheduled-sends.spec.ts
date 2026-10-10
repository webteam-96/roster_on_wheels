import { htmlEncode } from "../../common/dotnet-format";
import { attendanceText, meetingTypeLabel } from "./club-service-notification";
import { buildAbsoluteUrl, buildMediaPath, nz, resolveScope } from "./scheduled-send.helpers";
import { personalizeGreeting } from "./email-scheduled-send.service";

describe("scheduled send helpers", () => {
  it("encodes HTML like WebUtility.HtmlEncode", () => {
    expect(htmlEncode(`<a href="x">Tom's & café 😀</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; caf&#233; &#128512;&lt;/a&gt;");
  });
  it("resolves the scope", () => {
    expect(resolveScope(5, 2, null)).toBe("district");
    expect(resolveScope(5, null, "club")).toBe("club");
    expect(resolveScope(0, null, "RI")).toBe("ri");
    expect(resolveScope(null, null, null)).toBe("club");
    expect(nz(0)).toBeNull();
  });
  it("builds media paths and URLs", () => {
    expect(buildMediaPath("Event", "club", 7, null, "a.jpg")).toBe("/Documents/Event/Group7/a.jpg");
    expect(buildMediaPath("Event", "district", 7, 3, "a.jpg")).toBe("/Documents/Event/Group3/a.jpg");
    expect(buildMediaPath("Event", "ri", null, null, "a.jpg")).toBe("/Documents/Event/ri/a.jpg");
    expect(buildMediaPath("Event", "club", 7, null, "/x/a.jpg")).toBe("/x/a.jpg");
    expect(buildAbsoluteUrl("https://api.example.test/", "/Documents/a.jpg")).toBe("https://api.example.test/Documents/a.jpg");
    expect(buildAbsoluteUrl("https://api.example.test", "")).toBe("");
  });
  it("formats Club Service fields", () => {
    expect(meetingTypeLabel(" BOD ")).toBe("BOD");
    expect(meetingTypeLabel("other")).toBe("other");
    expect(attendanceText(25, 78.125)).toBe("25 (78.13%)");
    expect(attendanceText(25, null)).toBe("25");
    expect(attendanceText(null, 1)).toBe("-");
  });
  it("personalises the greeting", () => {
    expect(personalizeGreeting("Dear Rtn. {{NAME}},", "A & B")).toBe("Dear Rtn. A &amp; B,");
    expect(personalizeGreeting("Dear Rtn. {{NAME}},", " ")).toBe("Dear Rtn. Rotarian,");
  });
});
