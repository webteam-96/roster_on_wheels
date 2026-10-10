import type { DbCommands, Row } from "../database/db.service";

/** Port of DirectoryDataCollectionFields.cs: the fields a district can ask members to complete, and how each is read and scored. */
export interface FieldDef {
  key: string;
  label: string;
  section: string;
  type: string; // "text" | "date" | "textarea" | "image" | "address-bulk" | ...
  storage: string; // "profile" | "address" | "family"
  column?: string | null;
  addressType?: string | null;
  relation?: string | null;
}

const f = (key: string, label: string, section: string, type: string, storage: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, section, type, storage, ...o });

export const ALL_FIELDS: FieldDef[] = [
  // Personal (mobile numbers intentionally excluded — only SuperAdmin can change those)
  f("memberName", "Member Name", "Personal", "text", "profile", { column: "MemberName" }),
  f("profilePhoto", "Profile Photo", "Personal", "image", "profile", { column: "ProfilePhotoPath" }),
  f("email", "Email ID", "Personal", "email", "profile", { column: "EmailId" }),
  f("birthDate", "Date of Birth", "Personal", "date", "profile", { column: "BirthDate" }),
  f("bloodGroup", "Blood Group", "Personal", "bloodgroup", "profile", { column: "BloodGroup" }),
  f("gender", "Gender", "Personal", "gender", "profile", { column: "Gender" }),
  f("primaryLanguage", "Primary Language", "Personal", "language", "profile", { column: "PrimaryLanguage" }),
  f("memberIntroduction", "Member Introduction", "Personal", "textarea", "profile", { column: "MemberIntroduction" }),
  f("rotaryId", "Rotary ID", "Personal", "digits", "profile", { column: "RotaryId" }),
  f("donorRecognition", "Donor Recognition", "Personal", "text", "profile", { column: "DonorRecognition" }),
  // Social
  f("facebook", "Facebook", "Social", "url", "profile", { column: "Facebook" }),
  f("instagram", "Instagram", "Social", "url", "profile", { column: "Instagram" }),
  f("linkedin", "LinkedIn", "Social", "url", "profile", { column: "LinkedIn" }),
  f("twitter", "Twitter", "Social", "url", "profile", { column: "Twitter" }),
  f("youtube", "Youtube", "Social", "url", "profile", { column: "Youtube" }),
  f("website", "Website", "Social", "url", "profile", { column: "Website" }),
  // Address (bulk — 1 checkbox covers the whole block)
  f("residentAddress", "Residential Address", "Address", "address-bulk", "address", { addressType: "Residence" }),
  f("businessAddress", "Business Address", "Address", "address-bulk", "address", { addressType: "Business" }),
  // Professional — fields of the Business address row exposed separately
  f("businessName", "Business Name", "Professional", "address-single", "address", { column: "BusinessName", addressType: "Business" }),
  f("classificationProfession", "Classification / Profession", "Professional", "address-single", "address", { column: "ClassificationProfession", addressType: "Business" }),
  f("keywords", "Keywords", "Professional", "address-single", "address", { column: "Keywords", addressType: "Business" }),
  // Family (spouse + the anniversary, which "Not Applicable (no spouse)" also governs)
  f("spouseName", "Spouse Name", "Family", "text", "family", { column: "Name", relation: "Spouse" }),
  f("spouseMobile", "Spouse Mobile Number", "Family", "tel", "family", { column: "PhoneNumber", relation: "Spouse" }),
  f("spouseEmail", "Spouse Email ID", "Family", "email", "family", { column: "EmailId", relation: "Spouse" }),
  f("spouseDob", "Spouse Date of Birth", "Family", "date", "family", { column: "BirthDate", relation: "Spouse" }),
  f("anniversaryDate", "Anniversary Date", "Family", "date", "profile", { column: "AnniversaryDate" }),
  f("spousePhoto", "Spouse Photo", "Family", "image", "family", { column: "PhotoPath", relation: "Spouse" }),
];

export const getField = (key: string) => ALL_FIELDS.find((x) => x.key === key) ?? null;
export const isSpouseField = (x: FieldDef) => x.section === "Family";
export const configIncludesSpouseFields = (enabledKeys: Iterable<string>) => [...enabledKeys].some((k) => { const x = getField(k); return !!x && isSpouseField(x); });
export const applySpouseNotApplicable = (keys: string[], spouseNotApplicable: boolean) =>
  spouseNotApplicable ? keys.filter((k) => { const x = getField(k); return !!x && !isSpouseField(x); }) : keys;

export async function getSpouseNotApplicable(conn: DbCommands, configId: number, memberId: number): Promise<boolean> {
  const v = await conn.executeScalar("SELECT SpouseNotApplicable FROM directory_data_member_status WHERE fk_config_id = @c AND fk_member_id = @m LIMIT 1", { c: configId, m: memberId });
  return Number(v) === 1;
}

export async function getSpouseNotApplicableMap(conn: DbCommands, configId: number): Promise<Map<number, boolean>> {
  const rows = await conn.query("SELECT fk_member_id AS memberId, SpouseNotApplicable AS flag FROM directory_data_member_status WHERE fk_config_id = @c", { c: configId });
  return new Map(rows.map((r) => [Number(r.memberId), Number(r.flag) === 1]));
}

export async function setSpouseNotApplicable(conn: DbCommands, configId: number, memberId: number, value: boolean) {
  await conn.execute(
    `INSERT INTO directory_data_member_status (fk_config_id, fk_member_id, SpouseNotApplicable)
     VALUES (@c, @m, @v)
     ON DUPLICATE KEY UPDATE SpouseNotApplicable = @v, modified_date = NOW()`,
    { c: configId, m: memberId, v: value ? 1 : 0 },
  );
}

export function deserializeKeys(json: string | null | undefined): string[] {
  if (!json || !json.trim()) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((x) => (x === null ? x : String(x))) : [];
  } catch {
    return [];
  }
}

export const serializeKeys = (keys: Iterable<string>) => JSON.stringify([...new Set([...keys].filter((k) => getField(k) !== null))]);

/** Resolve group: DC > BOD > Member (DC = any committee level; BOD = President (1) or Secretary (4) of a club in the district). */
export async function resolveGroup(conn: DbCommands, memberId: number, districtId: number, yearId: number): Promise<string> {
  const dcExists = Number(
    await conn.executeScalar(
      `SELECT
         EXISTS(
           SELECT 1 FROM district_committee_member dcm
           WHERE dcm.fk_district_id = @districtId AND dcm.fk_year_id = @yearId
             AND dcm.fk_member_id = @memberId AND dcm.isdeleted = 0 AND dcm.is_active = 1)
         OR EXISTS(
           SELECT 1 FROM district_committee_group_member gm
           JOIN district_committee_group g ON g.id = gm.fk_group_id AND g.isdeleted = 0 AND g.is_active = 1
           WHERE g.fk_district_id = @districtId AND g.fk_year_id = @yearId
             AND gm.fk_member_id = @memberId AND gm.isdeleted = 0 AND gm.is_active = 1)
         OR EXISTS(
           SELECT 1 FROM district_committee_sub_group_member sgm
           JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id AND sg.isdeleted = 0 AND sg.is_active = 1
           JOIN district_committee_group g2 ON g2.id = sg.fk_group_id AND g2.isdeleted = 0 AND g2.is_active = 1
           WHERE g2.fk_district_id = @districtId AND g2.fk_year_id = @yearId
             AND sgm.fk_member_id = @memberId AND sgm.isdeleted = 0 AND sgm.is_active = 1)`,
      { districtId, yearId, memberId },
    ),
  );
  if (dcExists > 0) return "DC";
  const bodExists = Number(
    await conn.executeScalar(
      `SELECT COUNT(*) FROM board_of_directors bod
       JOIN club_master c ON c.pk_club_id = bod.fk_club_id
       WHERE bod.fk_member_master_profile_id = @memberId
         AND bod.fk_year_id = @yearId
         AND bod.fk_designation_id IN (1, 4)
         AND bod.isdeleted = 0
         AND c.fk_district_id = @districtId`,
      { memberId, yearId, districtId },
    ),
  );
  return bodExists > 0 ? "BOD" : "Member";
}

/** Contact-details text from the config's first/second contacts (WhatsApp template var {{8}}). */
export function buildContactText(name1: string | null, mobile1: string | null, name2: string | null, mobile2: string | null): string {
  const part = (n: string | null, m: string | null) => {
    const [nn, mm] = [n?.trim() ?? "", m?.trim() ?? ""];
    if (!nn && !mm) return "";
    if (!nn) return mm;
    if (!mm) return nn;
    return `${nn}: ${mm}`;
  };
  const [a, b] = [part(name1, mobile1), part(name2, mobile2)];
  if (a && b) return `${a} or ${b}`;
  return a || b || "the district team";
}

export const groupKeys = (group: string, dcJson: string, bodJson: string, memberJson: string) =>
  deserializeKeys(group === "DC" ? dcJson : group === "BOD" ? bodJson : memberJson);

export function maskMobile(mobile: string | null | undefined): string {
  if (!mobile || !mobile.trim()) return "";
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 4) return "X".repeat(digits.length);
  return digits.slice(0, 2) + "X".repeat(Math.max(0, digits.length - 4)) + digits.slice(-2);
}

export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.trim()) return "";
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  return (local.length <= 2 ? local[0] : local.slice(0, 2)) + "***" + email.slice(at);
}

// A DATETIME comes back as "yyyy-MM-ddTHH:mm:ss[Z]"; C# rendered DateTime values as "yyyy-MM-dd".
const valueText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "True" : "False";
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ? s.slice(0, 10) : s;
};

/** Current values for the member's enabled keys: key -> value (string or null). */
export async function loadValues(conn: DbCommands, memberId: number, keys: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const fields = keys.map(getField).filter((x): x is FieldDef => x !== null);
  const groups = new Map<string, FieldDef[]>();
  for (const x of fields) groups.set(x.storage, [...(groups.get(x.storage) ?? []), x]);

  for (const [storage, grp] of groups) {
    if (storage === "profile") {
      const cols = grp.map((x) => `\`${x.column}\``).join(",");
      const row = await conn.queryFirstOrDefault(`SELECT ${cols} FROM member_master_profile WHERE pk_member_master_profile_id = @id`, { id: memberId });
      for (const x of grp) result.set(x.key, row && x.column! in row ? valueText(row[x.column!]) : null);
    } else if (storage === "family") {
      const row = await conn.queryFirstOrDefault(
        `SELECT Name, PhoneNumber, EmailId, BirthDate,
                CASE
                    WHEN PhotoPath IS NULL OR PhotoPath = '' THEN NULL
                    WHEN PhotoPath LIKE '/%' THEN PhotoPath
                    ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(PhotoPath, '/', -1))
                END AS PhotoPath
         FROM member_family_details
         WHERE fk_member_master_profile_id = @id AND Relation = 'Spouse' AND (isdeleted IS NULL OR isdeleted = 0)
         ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC LIMIT 1`,
        { id: memberId },
      );
      for (const x of grp) result.set(x.key, row && x.column! in row ? valueText(row[x.column!]) : null);
    } else if (storage === "address") {
      const prof = await conn.queryFirstOrDefault(
        `SELECT MAX(Designation) AS Designation,
                MAX(ClassificationProfession) AS ClassificationProfession
         FROM club_members
         WHERE fk_member_master_profile_id = @id
           AND COALESCE(isdeleted, 0) = 0`,
        { id: memberId },
      );
      const clubDesignation = typeof prof?.Designation === "string" ? prof.Designation : null;
      const clubClassification = typeof prof?.ClassificationProfession === "string" ? prof.ClassificationProfession : null;
      for (const x of grp) {
        const row: Row | null = await conn.queryFirstOrDefault(
          `SELECT a.Address, a.City, a.State, a.PinCode, a.fk_country_id AS CountryId, a.PhoneNumber,
                  a.BusinessName, a.BusinessEmailId,
                  a.Keywords
           FROM member_address_details a
           WHERE a.fk_member_master_profile_id = @id AND a.AddressType = @type AND (a.isdeleted IS NULL OR a.isdeleted = 0)
           ORDER BY a.pk_member_address_details_id DESC LIMIT 1`,
          { id: memberId, type: x.addressType },
        );
        const isBusiness = (x.addressType ?? "").toLowerCase() === "business";
        if (x.type === "address-bulk") {
          if (row || isBusiness) {
            const blob: Row = row ? { ...row } : {};
            if (isBusiness) {
              blob.Designation = clubDesignation;
              blob.ClassificationProfession = clubClassification;
            }
            result.set(x.key, JSON.stringify(blob));
          } else result.set(x.key, null);
        } else if (x.type === "address-single" && x.column) {
          const col = x.column.toLowerCase();
          if (col === "designation") result.set(x.key, clubDesignation);
          else if (col === "classificationprofession") result.set(x.key, clubClassification);
          else result.set(x.key, row && x.column in row ? valueText(row[x.column]) : null);
        }
      }
    }
  }

  // Legacy junk in select-style fields counts as empty (the row is not changed).
  for (const [key, v] of result) {
    const x = getField(key);
    if (x && ["bloodgroup", "gender", "language"].includes(x.type) && !isCanonicalSelectValue(x, v)) result.set(key, null);
  }
  return result;
}

// Must mirror the admin app's lib/constants.ts option lists.
const ci = (xs: string[]) => new Set(xs.map((s) => s.toLowerCase()));
const CANONICAL_BLOOD_GROUPS = ci(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);
const CANONICAL_GENDERS = ci(["Male", "Female", "Other"]);
const CANONICAL_LANGUAGES = ci(["English", "Hindi", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Bengali", "Punjabi", "Other"]);

export function isCanonicalSelectValue(field: FieldDef, value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  const v = value.trim().toLowerCase();
  if (field.type === "bloodgroup") return CANONICAL_BLOOD_GROUPS.has(v);
  if (field.type === "gender") return CANONICAL_GENDERS.has(v);
  if (field.type === "language") return CANONICAL_LANGUAGES.has(v);
  return true;
}

const jsonProp = (json: string, name: string): string | null => {
  const el = JSON.parse(json);
  const v = el?.[name];
  return v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
};

/** Filled = non-empty; select fields must be canonical; address-bulk needs Address + City + State + PinCode. */
export function isFilled(field: FieldDef, value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  if (["bloodgroup", "gender", "language"].includes(field.type)) return isCanonicalSelectValue(field, value);
  if (field.type !== "address-bulk") return true;
  try {
    return ["Address", "City", "State", "PinCode"].every((n) => !!jsonProp(value, n)?.trim());
  } catch {
    return false;
  }
}

export function computeCompletion(values: Map<string, string | null>, enabledKeys: string[]): { filled: number; total: number; pendingLabels: string[] } {
  let filled = 0;
  const pendingLabels: string[] = [];
  for (const key of enabledKeys) {
    const x = getField(key);
    if (!x) continue;
    if (isFilled(x, values.get(key))) filled++;
    else pendingLabels.push(x.label);
  }
  return { filled, total: enabledKeys.length, pendingLabels };
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A field's value as inline HTML for emails. */
export function renderValueHtml(x: FieldDef, value: string | null | undefined, apiBase: string): string {
  if (!value || !value.trim()) return "<i>—</i>";
  switch (x.type) {
    case "image": {
      const url = /^http/i.test(value) ? value : `${apiBase.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
      return `<img src="${html(url)}" style="max-height:120px;border-radius:6px;border:1px solid #e2e8f0;" alt="${html(x.label)}"/>`;
    }
    case "date": {
      // birthday / anniversary: day + month only, never the year
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      return m ? `${m[3]} ${MONTHS[+m[2] - 1]}` : html(value);
    }
    case "address-bulk":
      try {
        const g = (n: string) => jsonProp(value, n);
        const cityStatePin = [g("City"), g("State"), g("PinCode")].filter((p) => p && p.trim()).join(", ");
        const parts: string[] = [];
        const add = (v: string | null, prefix = "") => { if (v && v.trim()) parts.push(prefix + html(v)); };
        add(g("Address"));
        add(cityStatePin);
        add(g("PhoneNumber"), "📞 ");
        add(g("BusinessName"), "🏢 ");
        add(g("Designation"), "💼 ");
        add(g("BusinessEmailId"), "✉️ ");
        return parts.length ? parts.join("<br/>") : "<i>—</i>";
      } catch {
        return html(value);
      }
    default:
      return html(value);
  }
}

/** "Completed" (with values) + "Pending" (labels) HTML block for emails. */
export function buildCompletedAndPendingHtml(enabledKeys: string[], values: Map<string, string | null>, apiBase: string): string {
  let completedRows = "", pendingRows = "";
  let completedCount = 0, pendingCount = 0;
  for (const key of enabledKeys) {
    const x = getField(key);
    if (!x) continue;
    const v = values.get(key);
    if (isFilled(x, v)) {
      completedCount++;
      completedRows += `
                    <tr>
                        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;width:40%;vertical-align:top;">${html(x.label)}</td>
                        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;">${renderValueHtml(x, v, apiBase)}</td>
                    </tr>`;
    } else {
      pendingCount++;
      pendingRows += `<li style="padding:3px 0;">${html(x.label)}</li>`;
    }
  }
  const completedHtml = completedCount > 0
    ? `<h3 style="color:#16a34a;margin:18px 0 8px;">✅ Completed (${completedCount})</h3>
                 <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:6px;">${completedRows}</table>`
    : "";
  const pendingHtml = pendingCount > 0
    ? `<h3 style="color:#dc2626;margin:18px 0 8px;">⏳ Pending (${pendingCount})</h3>
                 <ol style="color:#475569;line-height:1.5;margin:0;padding-left:22px;">${pendingRows}</ol>`
    : `<h3 style="color:#16a34a;margin:18px 0 8px;">🎉 All fields complete!</h3>`;
  return completedHtml + pendingHtml;
}
