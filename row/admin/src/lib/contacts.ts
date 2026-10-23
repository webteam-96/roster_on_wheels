// Contacts and the prospect pipeline (N3, feature contacts_growth): shared lists, labels and the spreadsheet
// column mapping used by the contact import. The API validates every value again.

export const CONTACT_TYPES = ["guest", "speaker", "sponsor", "partner", "volunteer"] as const;
export const PROSPECT_STAGES = ["inquiry", "contacted", "invited", "attended", "proposed", "approved", "inducted"] as const;
export const CONTACTS_FEATURE = "contacts_growth";

export const label = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The API's { message } for a failed call, or the fallback. */
export const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export interface ContactImportRow {
  name: string;
  email: string;
  mobile: string;
  contactType: string;
  organisation: string;
  notes: string;
}

// Header names people use for each field, compared in lower case with spaces and punctuation removed.
const HEADERS: Record<keyof ContactImportRow, string[]> = {
  name: ["name", "fullname", "contactname", "guestname"],
  email: ["email", "emailaddress", "emailid", "mail"],
  mobile: ["mobile", "phone", "mobilenumber", "phonenumber", "mobileno", "cell", "telephone"],
  contactType: ["type", "contacttype", "category"],
  organisation: ["organisation", "organization", "company", "business"],
  notes: ["notes", "note", "comments", "remarks"],
};

/** Spreadsheet rows (objects keyed by the header row) to import rows. "First name" and "Last name" columns are
 *  joined when there is no name column; rows with nothing in them are dropped. */
export function mapSheetRows(rows: Record<string, unknown>[]): ContactImportRow[] {
  return rows
    .map((r) => {
      const cells = new Map(Object.entries(r).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ""), String(v ?? "").trim()]));
      const pick = (names: string[]) => names.map((n) => cells.get(n)).find((v) => v) ?? "";
      const fullName = [pick(["firstname", "givenname"]), pick(["lastname", "surname", "familyname"])].filter(Boolean).join(" ");
      return {
        name: pick(HEADERS.name) || fullName,
        email: pick(HEADERS.email),
        mobile: pick(HEADERS.mobile),
        contactType: pick(HEADERS.contactType).toLowerCase(),
        organisation: pick(HEADERS.organisation),
        notes: pick(HEADERS.notes),
      };
    })
    .filter((r) => Object.values(r).some(Boolean));
}
