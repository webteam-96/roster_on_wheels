import { Brand, defaultBrand } from "../../brand/brand";
import { toDbValue } from "../admin-tools/member-duplicates.controller";
import { templateParam } from "../admin-tools/directory-config.controller";
import { formatCell, type OcvWordReportData } from "./ocv-gov.service";
import { buildOcvExcel, buildOcvWordReport } from "./ocv-report-documents";

beforeAll(() => Brand.initialise(defaultBrand()));

const data = (): OcvWordReportData => ({
  clubName: "Test <Club>", yearLabel: "2025-26", clubRotaryId: "1", districtNumber: "9999", zoneName: "Z", presidentName: "P", assistantGovernorName: "",
  categories: [{ code: "grants", name: "Grants" }], newsletters: [{ title: "N1", publishDate: "2025-08-01T00:00:00", attachmentType: "pdf", filePath: "/x.pdf", linkUrl: null, status: "Published" }],
  documents: [{ categoryCode: "grants", categoryName: "Grants", typeName: "Grant", customTypeName: null, originalFileName: "a.pdf", filePath: "/Documents/OCV/Group1/a.pdf", amount: 12.5, paidOn: null, createdDate: null, extension: "pdf" }],
  liveTables: [{ label: "Members", moduleKey: "members", headers: ["Sr", "Name"], rows: [["1", "A"]] }],
  projectModules: [{ moduleKey: "club_service", label: "Club Service", projects: [{ title: "T", description: "", fields: [["Date", "01 Aug 2025"]], images: [] }] }],
});

describe("OCV report", () => {
  it("formats cells like the C# FormatCell", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(true)).toBe("Yes");
    expect(formatCell(1234.5, "projectCost")).toBe("1,234.50");
    expect(formatCell(7, "manHours")).toBe("7");
    expect(formatCell("2025-08-01T00:00:00")).toBe("01 Aug 2025");
    expect(formatCell("2025-08-01T14:05:00Z")).toBe("01 Aug 2025 14:05");
    expect(formatCell("plain")).toBe("plain");
  });

  it("builds the HTML .xls with links and the brand name, encoded", () => {
    const html = buildOcvExcel(data(), [{ categoryName: "Grants", categoryCode: "grants", categoryId: 1, typeId: 1, typeName: "Grant", isUploaded: true, documentId: 1, filePath: "/d.pdf", originalFileName: "d.pdf" }],
      1, 2, "https://media.example", "https://app.example/").toString("utf8");
    expect(html).toContain("Test &lt;Club&gt;");
    expect(html).toContain("https://media.example/d.pdf");
    expect(html).toContain("https://app.example/ocv-live-documents/1/members?yearId=2");
    expect(html).toContain(`${Brand.Current.productName} Admin Portal`);
  });

  it("builds a docx", async () => {
    const buf = await buildOcvWordReport(data(), [], "https://media.example");
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});

describe("member duplicates / directory helpers", () => {
  it("maps JSON values to DB values as RIZones did", () => {
    expect(toDbValue("  ")).toBeNull();
    expect(toDbValue("x")).toBe("x");
    expect(toDbValue(true)).toBe(1);
    expect(toDbValue({})).toBeNull();
    expect(toDbValue(3)).toBe(3);
  });
  it("normalises WhatsApp template params", () => {
    expect(templateParam("")).toBe("-");
    expect(templateParam("a\n\tb   c")).toBe("a b c");
  });
});
