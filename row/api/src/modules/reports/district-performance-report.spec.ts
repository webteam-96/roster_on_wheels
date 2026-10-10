import { Brand, defaultBrand } from "../../brand/brand";
import { ExcelJS } from "../../services/xlsx";
import {
  buildDistrictWorkbook, buildEmailBody, buildZoneWorkbook, type ClubStats, Dec, type DistrictPerformanceKpi, membershipBand, newResult, parsePct, Pct, Pct2, section, tile, tryNumber,
} from "./district-performance-report.render";
import { siteHost } from "./district-performance-report.service";

const kpi = (zone: string, district: string, clubs: number): DistrictPerformanceKpi => ({
  zoneName: zone, districtNumber: district, governorName: null, clubs, nonSyncedClubs: 1, members: 0, women: 0, youth: 0, joined: 0, left: 0, clubProjects: 2, districtProjects: 1,
  beneficiaries: 0, volunteerHours: 0, cmrSubmitted: 0, cmrDue: 0, awardPoints: 0, clubService: 3, avenues: new Map([["Community Service", 2]]), foundation: new Map([["Total Giving", 10.5]]),
  trfAsOn: null, membershipTarget: null, membershipAchieved: null, membershipPct: null, trfTarget: null, trfAchieved: null, trfPct: null,
});

describe("district performance report", () => {
  beforeAll(() => Brand.initialise(defaultBrand()));

  it("formats figures like the C# helpers", () => {
    expect([Dec(null), Pct(12.25), Pct(12), Pct2(33.335), Pct(null)]).toEqual(["—", "12.3%", "12%", "33.34%", "—"]);
    expect([membershipBand(9), membershipBand(10), membershipBand(26), membershipBand(41)]).toEqual(["Below 10 members", "RED", "AMBER", "GREEN"]);
    expect([parsePct("45.5%"), parsePct("—"), parsePct("1,200%")]).toEqual([45.5, null, 1200]);
    expect([tryNumber("1,234"), tryNumber("USD 1,500"), tryNumber("+3"), tryNumber("12%"), tryNumber("Yes")]).toEqual([1234, 1500, 3, null, null]);
  });

  it("builds a website host from client domain, subdomain or bare label", () => {
    expect(siteHost("www.example.org", "x", "parent.org")).toBe("www.example.org");
    expect(siteHost(null, "club1", "parent.org")).toBe("club1.parent.org");
    expect(siteHost(null, "club1.other.org", "parent.org")).toBe("club1.other.org");
    expect(siteHost(null, null, "parent.org")).toBeNull();
  });

  it("escapes report text in the email body and colours % cells", () => {
    const r = newResult({ reportTitle: "District <1>", highlights: [tile({ label: "Clubs", value: "3" })], sections: [section({ part: "P", title: "T", tableHeaders: ["Particulars", "Percentage Achieved"], tableRows: [["x", "10%"]] })] });
    const html = buildEmailBody(r, null);
    expect(html).toContain("District &lt;1&gt;");
    expect(html).toContain("color:#dc2626");
  });

  it("builds the district and all-zones workbooks", async () => {
    const goalsWb = new ExcelJS.Workbook();
    const ytd = goalsWb.addWorksheet("YTD");
    ytd.getCell(1, 1).value = "Goals";
    ytd.mergeCells(1, 1, 1, 3);
    const goalsBytes = Buffer.from(await goalsWb.xlsx.writeBuffer());

    const club = { id: 1, clubName: "Club A", clubRotaryId: "1", city: null, state: null, clubCharterDate: "2020-01-15T00:00:00.000Z", memberCount: 0 };
    const stats = {
      club, m: { members: 30 }, projects: new Map([["Community Service", 2]]), totalProjects: 2, clubService: 1, beneficiaries: 5, manHours: 4, cost: 99.6, cmrSubmitted: 1,
      website: { clubId: 1, clubName: "Club A", subdomain: "a", clientDomain: null, status: null, endDate: null, host: "a.parent.org", url: "https://a.parent.org" },
      districtDuesPaid: false, goalCategoriesSet: new Set([1]), awardPoints: 0, president: null, secretary: null, cmrByMonth: new Map(), cmrPending: 0, cmrNotStarted: 1, trfUsd: 0, mod: new Map(),
    } as unknown as ClubStats;
    const r = newResult({ districtNumber: "1000", sections: [section({ part: "District 1000", title: "RAG", tableHeaders: ["Band", "Clubs"], tableRows: [["RED (10 – 25)", "1"]] })] });
    const bytes = await buildDistrictWorkbook({
      r, clubs: [stats], categories: [{ id: 1, name: "Membership" }], hasOtherAvenue: false, websites: [stats.website!], months: [7, 8],
      goals: { districtMetrics: [], achievedAsOn: new Map(), districtWorkbook: goalsBytes, clubsWorkbook: null }, currency: "USD", nonSynced: [],
      cmrRows: [{ club, byMonth: new Map([[7, "Submitted"]]), submitted: 1 }], awardsEnabled: false, zonalByGoal: [{ goal: "G", points: 1.5, maxPoints: null }],
    });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(back.worksheets.map((w) => w.name)).toEqual(["Summary", "District", "All Clubs", "Synced Clubs", "Non-Synced Clubs", "Goals - District", "Goals - Clubs", "Projects Ranking", "Club Monthly Report Grid", "Club Websites"]);
    expect(back.getWorksheet("Goals - District")!.getCell(1, 1).value).toBe("Goals");

    const zone = newResult({ districtNumber: "All Zones", districtReports: [newResult({ zoneName: "Z1", districtNumber: "1000", kpi: kpi("Z1", "1000", 4), sections: r.sections })] });
    const zb = new ExcelJS.Workbook();
    await zb.xlsx.load((await buildZoneWorkbook(zone)) as unknown as ArrayBuffer);
    expect(zb.worksheets.map((w) => w.name)).toEqual(["Summary", "All Districts", "Clubs", "Foundation", "Service Projects"]);
    expect(zb.getWorksheet("Clubs")!.getCell(2, 3).value).toBe(5);
  });
});
