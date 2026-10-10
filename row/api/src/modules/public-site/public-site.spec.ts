import sharp from "sharp";
import { renderShareCard, wrap } from "../../services/project-share-card";
import { htmlDecode, normaliseText, truncateText } from "../../services/whatsapp-template-text";
import { normalizeHost } from "./club-website-tenant.controllers";
import { buildShareText, buildShareTextSingleLine, clubDisplayName } from "./public-project-share.controller";
import { sumNullable } from "./public-site.helpers";

describe("public site helpers", () => {
  it("normalises hosts like the tenant resolver", () => {
    expect(normalizeHost("https://www.Club.Example.org:443/path")).toBe("club.example.org");
    expect(normalizeHost("  ")).toBe("");
  });
  it("sums nullable values like the C# helpers", () => {
    expect(sumNullable([null, undefined])).toBeNull();
    expect(sumNullable([1, null, 2])).toBe(3);
  });
  it("fits share text", () => {
    expect(normaliseText("<p>Hello&nbsp;&amp; welcome\\nall</p>")).toBe("Hello & welcome all");
    expect(htmlDecode("&#8211;&#x2014;&hellip;")).toBe("–—…");
    expect(truncateText("one two three four five", 12)).toBe("one two…");
    expect(truncateText("short", 12)).toBe("short");
    expect(clubDisplayName("Springfield")).toBe("Rotary Club of Springfield");
    expect(clubDisplayName("Rotary Club X")).toBe("Rotary Club X");
    expect(buildShareText("T", "C", "1234", "S", "u")).toBe("T\nC | RI District 1234\n\nS\n\nu");
    expect(buildShareTextSingleLine("T", "C", "1234", "S", "u")).toBe("T - C - RI District 1234. S u");
    expect(wrap("a b c", 20).length).toBe(1);
  });
  it("renders a 1200x630 PNG share card", async () => {
    const png = await renderShareCard({ title: "Water for all", clubDisplayName: "Rotary Club of Test", districtNumber: "9999", areaOfFocus: "Water", summary: "A summary.", footerHost: "example.org", photoBytes: null });
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 1200, 630]);
  });
});
