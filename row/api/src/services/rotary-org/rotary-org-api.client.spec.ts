import { parseOfficers, RotaryOrgApiClient } from "./rotary-org-api.client";
import { mapOfficerRow } from "../../modules/reports/district-report.service";

describe("RotaryOrgApiClient parsing", () => {
  it("reads tokens in every shape", () => {
    expect(RotaryOrgApiClient.extractToken('"abc.def"')).toBe("abc.def");
    expect(RotaryOrgApiClient.extractToken('{"auth_token":"t1"}')).toBe("t1");
    expect(RotaryOrgApiClient.extractToken("plain")).toBe("plain");
    expect(RotaryOrgApiClient.extractToken('{"x":1}')).toBeNull();
  });

  it("parses wrapped officers with nested people and maps roles to columns", () => {
    const officers = parseOfficers({
      Officers: [
        { Role: "Club President", Individual: { FirstName: "Ann", LastName: "Lee", Id: 42 } },
        { Role: "Club President-Elect", Name: "Bo" },
        { Role: "Club Executive Secretary/Director", Name: "Cy", Email: "cy@x.org" },
        { Role: "Club Secretary", Name: "Di" },
      ],
    });
    expect(officers[0]).toEqual({ role: "Club President", name: "Ann Lee", email: null, phone: null, rotaryId: "42" });
    const row = mapOfficerRow("RC Test", officers);
    expect(row.presidentName).toBe("Ann Lee");
    expect(row.execSecretaryEmail).toBe("cy@x.org");
    expect(row.secretaryName).toBe("Di");
    expect(parseOfficers({ nope: [] })).toEqual([]);
  });
});

describe("rotary.org DTO parsing", () => {
  const { flexibleDate, parseMembersResponse, pick, profileContacts } = jest.requireActual("./rotary-org-api.client");
  it("reads dates like FlexibleDateTimeConverter", () => {
    expect(flexibleDate("2024-07-01T10:20:30")).toBe("2024-07-01T10:20:30Z");
    expect(flexibleDate("2024-07-01")).toBe("2024-07-01T00:00:00Z");
    expect(flexibleDate("07/15/1980")).toBe("1980-07-15T00:00:00Z");
    expect(flexibleDate(0)).toBe("1970-01-01T00:00:00Z");
    expect(flexibleDate("")).toBeNull();
    expect(flexibleDate("garbage")).toBeNull();
  });
  it("reads member lists in every shape, case-insensitively", () => {
    expect(parseMembersResponse('[{"memberid": 5, "FirstName": "A"}]')[0]).toMatchObject({ memberId: 5, firstName: "A" });
    expect(parseMembersResponse('{"terminatedClubMembers": [{"MemberId": 7}]}')[0].memberId).toBe(7);
    expect(parseMembersResponse('{"x": 1}')).toEqual([]);
    expect(pick({ ClubId: 3 }, "clubid")).toBe(3);
  });
  it("picks primary contacts", () => {
    const c = profileContacts({ individual: null, address: null, email: [{ emailAddress: "a@x", emailType: null, isPrimary: false }, { emailAddress: "b@x", emailType: null, isPrimary: true }],
      phone: [{ phoneType: "Home", phoneNumber: "1", countryCode: null, isPrimary: false }, { phoneType: "Mobile", phoneNumber: "2", countryCode: null, isPrimary: false }] });
    expect([c.email, c.phone]).toEqual(["b@x", "2"]);
  });
});
