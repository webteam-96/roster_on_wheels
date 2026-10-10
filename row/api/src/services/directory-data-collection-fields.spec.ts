import { computeCompletion, getField, isFilled, maskEmail, maskMobile, deserializeKeys, buildContactText } from "./directory-data-collection-fields";
import { renderForExport } from "../modules/reports/club-report.service";

describe("DirectoryDataCollectionFields", () => {
  it("scores completion with canonical selects and full addresses only", () => {
    const values = new Map<string, string | null>([
      ["gender", "Not Specified"],
      ["bloodGroup", "o+"],
      ["residentAddress", JSON.stringify({ Address: "1 Main", City: "Town", State: "ST", PinCode: "123" })],
      ["businessAddress", JSON.stringify({ Address: "1 Main", City: "Town", State: "", PinCode: "123" })],
    ]);
    const r = computeCompletion(values, ["gender", "bloodGroup", "residentAddress", "businessAddress", "unknownKey"]);
    expect(r.filled).toBe(2);
    expect(r.total).toBe(5); // C# counts unknown keys in the denominator
    expect(r.pendingLabels).toEqual(["Gender", "Business Address"]);
    expect(isFilled(getField("memberName")!, "  ")).toBe(false);
  });

  it("renders export values like the C# report", () => {
    expect(renderForExport(getField("birthDate")!, "1900-03-05")).toBe("05-Mar");
    expect(renderForExport(getField("birthDate")!, "1984-12-31")).toBe("31-Dec-1984");
    expect(renderForExport(getField("memberIntroduction")!, "")).toBe("No");
    expect(renderForExport(getField("profilePhoto")!, "/x.jpg")).toBe("Uploaded");
    expect(renderForExport(getField("residentAddress")!, JSON.stringify({ Address: "A", City: "B", State: null, PhoneNumber: "9" }))).toBe("A | B | Ph: 9");
  });

  it("masks and parses", () => {
    expect(maskMobile("+1 (555) 123-4567")).toBe("15XXXXXXX67");
    expect(maskEmail("jo@x.org")).toBe("j***@x.org");
    expect(maskEmail("john@x.org")).toBe("jo***@x.org");
    expect(deserializeKeys("not json")).toEqual([]);
    expect(buildContactText(null, null, "Ann", "555")).toBe("Ann: 555");
    expect(buildContactText(null, null, null, null)).toBe("the district team");
  });
});
