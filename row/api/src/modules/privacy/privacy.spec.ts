import { NOT_PERSONAL_COLUMN, PERSONAL_COLUMN_PATTERN, PERSONAL_DATA } from "./personal-data-registry";

describe("personal-data registry", () => {
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;

  it("names only plain identifiers (they are interpolated into SQL)", () => {
    for (const e of PERSONAL_DATA) {
      expect(e.table).toMatch(ident);
      expect(e.match.column).toMatch(ident);
      if (e.onErase.action === "anonymise") for (const c of Object.keys(e.onErase.set)) expect(c).toMatch(ident);
    }
  });

  it("anonymises the profile instead of deleting it (hard deletes are blocked by triggers)", () => {
    const profile = PERSONAL_DATA.find((e) => e.table === "member_master_profile");
    expect(profile?.onErase.action).toBe("anonymise");
    for (const t of ["member_address_details", "member_family_details", "club_members"]) {
      expect(PERSONAL_DATA.filter((e) => e.table === t).every((e) => e.onErase.action !== "deleteRows")).toBe(true);
    }
  });

  it("keeps password hashes out of the export", () => {
    expect(PERSONAL_DATA.find((e) => e.table === "member_credentials")?.export).toBe(false);
  });

  it("audit pattern catches personal columns and skips flags and counters", () => {
    for (const c of ["emailid", "primarymobilenumber", "birthdate", "ip_address", "profilephotopath"]) {
      expect(PERSONAL_COLUMN_PATTERN.test(c) && !NOT_PERSONAL_COLUMN.test(c)).toBe(true);
    }
    for (const c of ["issendemail", "emailsentcount", "emailsentdate", "totalrecipients", "emailsubject"]) {
      expect(PERSONAL_COLUMN_PATTERN.test(c) && !NOT_PERSONAL_COLUMN.test(c)).toBe(false);
    }
  });
});

import { Brand, defaultBrand } from "../../brand/brand";
import { broadcastConsentFilter } from "../../services/privacy-consent";

describe("broadcast consent filter", () => {
  it("adds no filter without a policy version", () => {
    Brand.initialise(defaultBrand());
    expect(broadcastConsentFilter()).toBe("");
  });

  it("requires consent to the current version, with a safe literal", () => {
    const b = defaultBrand();
    b.legal.policyVersion = "2026-11'; DROP TABLE x; --";
    Brand.initialise(b);
    const sql = broadcastConsentFilter();
    expect(sql).toContain("member_consents");
    expect(sql).toContain("policy_version = '2026-11DROPTABLEx--'");
    expect(sql).not.toContain(";");
  });
});
