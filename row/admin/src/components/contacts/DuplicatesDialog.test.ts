import { describe, expect, it } from "vitest";
import type { Contact } from "@/services/api";
import { defaultSources } from "./DuplicatesDialog";
import { CONTACT_TYPES, label } from "@/lib/contacts";

const c = (id: number, patch: Partial<Contact>): Contact => ({
  id, name: "", email: null, mobile: null, contactType: "guest", organisation: null, notes: null, source: "manual",
  createdDate: "2026-01-01T00:00:00", groupIds: [], ...patch,
} as Contact);

describe("duplicate merge defaults", () => {
  it("keeps the kept contact's values and fills its blanks from the others in order", () => {
    const list = [c(1, { name: "Ana", email: "ana@example.org" }), c(2, { name: "Ana Silva", mobile: "0771234567" }), c(3, { organisation: "Acme" })];
    expect(defaultSources(list, 2)).toEqual({ name: 2, email: 1, mobile: 2, contactType: 2, organisation: 3, notes: 2 });
  });
});

describe("friends of the club", () => {
  it("is a contact type with its own label", () => {
    expect(CONTACT_TYPES).toContain("friend");
    expect(label("friend")).toBe("Friend of the club");
    expect(label("guest")).toBe("Guest");
  });
});
