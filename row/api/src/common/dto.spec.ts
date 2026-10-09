import { camelCase, defineDto } from "./dto";

describe("camelCase matches System.Text.Json", () => {
  it.each([
    ["MemberName", "memberName"],
    ["Id", "id"],
    ["ID", "id"],
    ["IPAddress", "ipAddress"],
    ["URLValue", "urlValue"],
    ["memberId", "memberId"],
    ["Url", "url"],
    ["ABC", "abc"],
    ["A", "a"],
    ["HTMLBody", "htmlBody"],
    ["IsActive", "isActive"],
    ["pk_member_id", "pk_member_id"],
    ["Fk_ClubId", "fk_ClubId"],
    ["", ""],
    // verified against .NET 10 JsonNamingPolicy.CamelCase
    ["ClubID", "clubID"],
    ["OTPExpiresInSeconds", "otpExpiresInSeconds"],
    ["X1Y", "x1Y"],
    ["My Name", "my Name"],
    ["CMRId", "cmrId"],
  ])("%s -> %s", (input, expected) => {
    expect(camelCase(input)).toBe(expected);
  });
});

describe("defineDto fills a C# DTO as Dapper would", () => {
  const Dto = defineDto({
    Id: "int",
    MemberName: "string",
    IsActive: "bool",
    BirthDate: "datetime?",
    CreatedDate: "datetime",
    Amount: "decimal",
    ClubId: "int?",
    Roles: { type: "object", default: () => [] },
  });

  it("matches columns case-insensitively, converts types and applies C# defaults", () => {
    expect(Dto.map({ id: 7, MEMBERNAME: "Ann", IsActive: 1, Amount: "12.50", Extra: "ignored" })).toEqual({
      id: 7,
      memberName: "Ann",
      isActive: true,
      birthDate: null,
      createdDate: "0001-01-01T00:00:00",
      amount: 12.5,
      clubId: null,
      roles: [],
    });
  });

  it("keeps declaration order", () => {
    expect(Object.keys(Dto.create({ Roles: ["Admin"], Id: 1 }))).toEqual([
      "id", "memberName", "isActive", "birthDate", "createdDate", "amount", "clubId", "roles",
    ]);
  });

  it("returns null for a missing row", () => {
    expect(Dto.map(null)).toBeNull();
  });
});
