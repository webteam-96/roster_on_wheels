import { describe, expect, it } from "vitest";
import { mapSheetRows } from "./contacts";

describe("contact import column mapping", () => {
  it("reads the usual header spellings", () => {
    expect(mapSheetRows([{ "Full Name": " Ana Silva ", "E-mail": "ana@example.org", "Phone Number": 5550100, Company: "Acme", Type: "Speaker" }]))
      .toEqual([{ name: "Ana Silva", email: "ana@example.org", mobile: "5550100", contactType: "speaker", organisation: "Acme", notes: "" }]);
  });

  it("joins first and last name when there is no name column", () => {
    expect(mapSheetRows([{ "First Name": "Ken", "Last Name": "Ito", Email: "" }])[0].name).toBe("Ken Ito");
  });

  it("drops blank rows and ignores unknown columns", () => {
    expect(mapSheetRows([{ Name: "", Email: " " }, { Shoe: "42", Name: "Bo" }])).toEqual([
      { name: "Bo", email: "", mobile: "", contactType: "", organisation: "", notes: "" },
    ]);
  });
});
