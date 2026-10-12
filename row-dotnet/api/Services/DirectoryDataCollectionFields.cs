using Dapper;
using MySqlConnector;
using System.Text.Json;

namespace RotaryApi.Services;

public static class DirectoryDataCollectionFields
{
    public record FieldDef(
        string Key,
        string Label,
        string Section,
        string Type,        // "text" | "date" | "textarea" | "image" | "address-bulk"
        string Storage,     // "profile" | "address" | "family"
        string? Column = null,
        string? AddressType = null,     // "Residential" | "Business" for address-bulk
        string? Relation = null         // "Spouse" for family fields
    );

    public static readonly List<FieldDef> AllFields = new()
    {
        // Personal (mobile numbers intentionally excluded — only SuperAdmin can change those)
        new("memberName",          "Member Name",               "Personal", "text",         "profile", Column: "MemberName"),
        new("profilePhoto",        "Profile Photo",             "Personal", "image",        "profile", Column: "ProfilePhotoPath"),
        new("email",               "Email ID",                  "Personal", "email",        "profile", Column: "EmailId"),
        new("birthDate",           "Date of Birth",             "Personal", "date",         "profile", Column: "BirthDate"),
        new("bloodGroup",          "Blood Group",               "Personal", "bloodgroup",   "profile", Column: "BloodGroup"),
        new("gender",              "Gender",                    "Personal", "gender",       "profile", Column: "Gender"),
        new("primaryLanguage",     "Primary Language",          "Personal", "language",     "profile", Column: "PrimaryLanguage"),
        new("memberIntroduction",  "Member Introduction",       "Personal", "textarea",     "profile", Column: "MemberIntroduction"),
        new("rotaryId",            "Rotary ID",                 "Personal", "digits",       "profile", Column: "RotaryId"),
        new("donorRecognition",    "Donor Recognition",         "Personal", "text",         "profile", Column: "DonorRecognition"),

        // Social
        new("facebook",            "Facebook",                  "Social",   "url",          "profile", Column: "Facebook"),
        new("instagram",           "Instagram",                 "Social",   "url",          "profile", Column: "Instagram"),
        new("linkedin",            "LinkedIn",                  "Social",   "url",          "profile", Column: "LinkedIn"),
        new("twitter",             "Twitter",                   "Social",   "url",          "profile", Column: "Twitter"),
        new("youtube",             "Youtube",                   "Social",   "url",          "profile", Column: "Youtube"),
        new("website",             "Website",                   "Social",   "url",          "profile", Column: "Website"),

        // Address (bulk — 1 checkbox covers the whole block)
        new("residentAddress",     "Residential Address",       "Address",  "address-bulk", "address", AddressType: "Residence"),
        new("businessAddress",     "Business Address",          "Address",  "address-bulk", "address", AddressType: "Business"),

        // Professional — individual fields that live in the Business address row but are exposed separately
        new("businessName",              "Business Name",               "Professional", "address-single", "address", Column: "BusinessName",             AddressType: "Business"),
        new("classificationProfession",  "Classification / Profession", "Professional", "address-single", "address", Column: "ClassificationProfession", AddressType: "Business"),
        new("keywords",                  "Keywords",                    "Professional", "address-single", "address", Column: "Keywords",                 AddressType: "Business"),

        // Family (spouse + the wedding anniversary, which belongs with the spouse). anniversaryDate
        // stays a PROFILE column (member_master_profile.AnniversaryDate) but sits in the Family section
        // so it renders under Spouse Date of Birth AND is governed by "Not Applicable (no spouse)":
        // ticking that hides it and CLEARS the stored anniversary (see Submit), so no-spouse members
        // are never counted for an anniversary in any report / WhatsApp / email.
        new("spouseName",          "Spouse Name",               "Family",   "text",         "family",  Column: "Name",            Relation: "Spouse"),
        new("spouseMobile",        "Spouse Mobile Number",      "Family",   "tel",          "family",  Column: "PhoneNumber",     Relation: "Spouse"),
        new("spouseEmail",         "Spouse Email ID",           "Family",   "email",        "family",  Column: "EmailId",         Relation: "Spouse"),
        new("spouseDob",           "Spouse Date of Birth",      "Family",   "date",         "family",  Column: "BirthDate",       Relation: "Spouse"),
        new("anniversaryDate",     "Anniversary Date",          "Family",   "date",         "profile", Column: "AnniversaryDate"),
        new("spousePhoto",         "Spouse Photo",              "Family",   "image",        "family",  Column: "PhotoPath",       Relation: "Spouse"),
    };

    public static FieldDef? GetField(string key) => AllFields.FirstOrDefault(f => f.Key == key);

    // ── Spouse-not-applicable helpers ─────────────────────────────
    // When a member ticks "Spouse — Not Applicable", every Family-section field is excluded
    // from the form view AND from the completion calc (numerator + denominator). Existing
    // member_family_details rows are NEVER deleted — the flag only hides/skips, so untick
    // restores everything as it was.

    public static bool IsSpouseField(FieldDef f) => f.Section == "Family";

    public static bool ConfigIncludesSpouseFields(IEnumerable<string> enabledKeys)
        => enabledKeys.Any(k => GetField(k) is { } f && IsSpouseField(f));

    /// <summary>Drops Family-section keys from <paramref name="keys"/> when spouseNotApplicable is true.
    /// Returns the original list otherwise.</summary>
    public static List<string> ApplySpouseNotApplicable(List<string> keys, bool spouseNotApplicable)
    {
        if (!spouseNotApplicable) return keys;
        return keys.Where(k => GetField(k) is { } f && !IsSpouseField(f)).ToList();
    }

    /// <summary>Read SpouseNotApplicable for one (config, member) pair. Returns false if no row exists.</summary>
    public static async Task<bool> GetSpouseNotApplicableAsync(MySqlConnection conn, int configId, int memberId)
    {
        var v = await conn.ExecuteScalarAsync<int?>(
            "SELECT SpouseNotApplicable FROM directory_data_member_status WHERE fk_config_id = @c AND fk_member_id = @m LIMIT 1",
            new { c = configId, m = memberId });
        return v == 1;
    }

    /// <summary>Bulk-load the flag for many members at once. Returns dict memberId → bool. Members not in the table get false.</summary>
    public static async Task<Dictionary<int, bool>> GetSpouseNotApplicableMapAsync(MySqlConnection conn, int configId)
    {
        var rows = await conn.QueryAsync<(int memberId, int flag)>(
            "SELECT fk_member_id AS memberId, SpouseNotApplicable AS flag FROM directory_data_member_status WHERE fk_config_id = @c",
            new { c = configId });
        return rows.ToDictionary(r => r.memberId, r => r.flag == 1);
    }

    /// <summary>UPSERT the flag for a (config, member) pair.</summary>
    public static async Task SetSpouseNotApplicableAsync(MySqlConnection conn, int configId, int memberId, bool value)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO directory_data_member_status (fk_config_id, fk_member_id, SpouseNotApplicable)
            VALUES (@c, @m, @v)
            ON DUPLICATE KEY UPDATE SpouseNotApplicable = @v, modified_date = NOW()",
            new { c = configId, m = memberId, v = value ? 1 : 0 });
    }

    public static List<string> DeserializeKeys(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? new(); }
        catch { return new(); }
    }

    public static string SerializeKeys(IEnumerable<string> keys)
        => JsonSerializer.Serialize(keys.Where(k => GetField(k) != null).Distinct().ToList());

    // Resolve group: DC > BOD > Member
    // DC  = member sits on ANY of the three committee levels for (district, year):
    //         1. District Committee  — district_committee_member (district + year)
    //         2. Group Committee     — district_committee_group_member (via group → district + year)
    //         3. Sub-Group Committee — district_committee_sub_group_member (via sub-group → group → district + year)
    //       This MUST match the DC data-collection report (DistrictReportController.DataCollectionDc),
    //       which covers all three levels — otherwise a group/sub-group member sees the wrong checklist.
    // BOD = member exists in board_of_directors for their club + year with designation Club President (1) or Club Secretary (4),
    //       where the club belongs to the given district
    // Member = otherwise (any active member in a club belonging to the district)
    public static async Task<string> ResolveGroupAsync(MySqlConnection conn, int memberId, int districtId, int yearId)
    {
        var dcExists = await conn.ExecuteScalarAsync<int>(@"
            SELECT
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
                  AND sgm.fk_member_id = @memberId AND sgm.isdeleted = 0 AND sgm.is_active = 1)",
            new { districtId, yearId, memberId });
        if (dcExists > 0) return "DC";

        var bodExists = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM board_of_directors bod
            JOIN club_master c ON c.pk_club_id = bod.fk_club_id
            WHERE bod.fk_member_master_profile_id = @memberId
              AND bod.fk_year_id = @yearId
              AND bod.fk_designation_id IN (1, 4)
              AND bod.isdeleted = 0
              AND c.fk_district_id = @districtId",
            new { memberId, yearId, districtId });
        if (bodExists > 0) return "BOD";

        return "Member";
    }

    // Build a contact-details string from config first/second contacts — used as WhatsApp template var {{8}}
    public static string BuildContactText(string? name1, string? mobile1, string? name2, string? mobile2)
    {
        string Part(string? n, string? m)
        {
            n = n?.Trim(); m = m?.Trim();
            if (string.IsNullOrEmpty(n) && string.IsNullOrEmpty(m)) return "";
            if (string.IsNullOrEmpty(n)) return m!;
            if (string.IsNullOrEmpty(m)) return n;
            return $"{n}: {m}";
        }
        var a = Part(name1, mobile1);
        var b = Part(name2, mobile2);
        if (!string.IsNullOrEmpty(a) && !string.IsNullOrEmpty(b)) return $"{a} or {b}";
        if (!string.IsNullOrEmpty(a)) return a;
        if (!string.IsNullOrEmpty(b)) return b;
        return "the district team";
    }

    public static List<string> GroupKeys(string group, string dcJson, string bodJson, string memberJson)
    {
        return group switch
        {
            "DC" => DeserializeKeys(dcJson),
            "BOD" => DeserializeKeys(bodJson),
            _ => DeserializeKeys(memberJson),
        };
    }

    // Mask mobile: first 2 + XXXXXX + last 2 (e.g. +91 98XXXXXX32 style — we return raw digits, UI can format)
    public static string MaskMobile(string? mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return "";
        var digits = new string(mobile.Where(char.IsDigit).ToArray());
        if (digits.Length < 4) return new string('X', digits.Length);
        return digits.Substring(0, 2) + new string('X', Math.Max(0, digits.Length - 4)) + digits.Substring(digits.Length - 2);
    }

    public static string MaskEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return "";
        var at = email.IndexOf('@');
        if (at <= 0) return email;
        var local = email.Substring(0, at);
        var domain = email.Substring(at);
        if (local.Length <= 2) return local[0] + "***" + domain;
        return local.Substring(0, 2) + "***" + domain;
    }

    // Load current values for the member's enabled keys.
    // Returns dict: key -> current value (string, possibly null/empty).
    public static async Task<Dictionary<string, string?>> LoadValuesAsync(MySqlConnection conn, int memberId, List<string> keys)
    {
        var result = new Dictionary<string, string?>();
        var keysByStorage = keys
            .Select(GetField).Where(f => f != null).Cast<FieldDef>()
            .GroupBy(f => f.Storage);

        foreach (var grp in keysByStorage)
        {
            if (grp.Key == "profile")
            {
                var cols = string.Join(",", grp.Select(f => $"`{f.Column}`"));
                var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
                    $"SELECT {cols} FROM member_master_profile WHERE pk_member_master_profile_id = @id",
                    new { id = memberId });
                var dict = row != null ? (IDictionary<string, object?>)row : null;
                foreach (var f in grp)
                {
                    if (dict != null && dict.TryGetValue(f.Column!, out var v))
                        result[f.Key] = v is DateTime dt ? dt.ToString("yyyy-MM-dd") : v?.ToString();
                    else
                        result[f.Key] = null;
                }
            }
            else if (grp.Key == "family")
            {
                var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT Name, PhoneNumber, EmailId, BirthDate,
                           CASE
                               WHEN PhotoPath IS NULL OR PhotoPath = '' THEN NULL
                               WHEN PhotoPath LIKE '/%' THEN PhotoPath
                               ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(PhotoPath, '/', -1))
                           END AS PhotoPath
                    FROM member_family_details
                    WHERE fk_member_master_profile_id = @id AND Relation = 'Spouse' AND (isdeleted IS NULL OR isdeleted = 0)
                    -- Same row as the Club Directory and the form's save: the latest-changed spouse.
                    ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC LIMIT 1",
                    new { id = memberId });
                var dict = row != null ? (IDictionary<string, object?>)row : null;
                foreach (var f in grp)
                {
                    if (dict != null && dict.TryGetValue(f.Column!, out var v))
                        result[f.Key] = v is DateTime dt ? dt.ToString("yyyy-MM-dd") : v?.ToString();
                    else
                        result[f.Key] = null;
                }
            }
            else if (grp.Key == "address")
            {
                // Designation + ClassificationProfession live in club_members (Step 11B
                // 2026-06-18) — pre-load them once so we can answer them even when the
                // member has no member_address_details row of the right AddressType
                // yet (in which case the address SELECT below returns no rows). Saved
                // via UpdateMemberDesignationClassificationAsync in PublicDirectoryController.
                var clubMemberProf = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT MAX(Designation) AS Designation,
                           MAX(ClassificationProfession) AS ClassificationProfession
                    FROM club_members
                    WHERE fk_member_master_profile_id = @id
                      AND COALESCE(isdeleted, 0) = 0",
                    new { id = memberId });
                string? clubDesignation = clubMemberProf?.Designation as string;
                string? clubClassification = clubMemberProf?.ClassificationProfession as string;

                foreach (var f in grp)
                {
                    var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                        SELECT a.Address, a.City, a.State, a.PinCode, a.fk_country_id AS CountryId, a.PhoneNumber,
                               a.BusinessName, a.BusinessEmailId,
                               a.Keywords
                        FROM member_address_details a
                        WHERE a.fk_member_master_profile_id = @id AND a.AddressType = @type AND (a.isdeleted IS NULL OR a.isdeleted = 0)
                        ORDER BY a.pk_member_address_details_id DESC LIMIT 1",
                        new { id = memberId, type = f.AddressType });

                    if (f.Type == "address-bulk")
                    {
                        // Always emit a JSON blob — even when there is no address row
                        // yet — so the Business bulk block can still surface the
                        // Designation pulled from club_members. The bulk completion
                        // check still requires Address+City+State+PinCode, so an
                        // empty address with only Designation set won't count as
                        // filled.
                        if (row != null || string.Equals(f.AddressType, "Business", StringComparison.OrdinalIgnoreCase))
                        {
                            var blob = row != null
                                ? new Dictionary<string, object?>((IDictionary<string, object?>)row)
                                : new Dictionary<string, object?>();
                            if (string.Equals(f.AddressType, "Business", StringComparison.OrdinalIgnoreCase))
                            {
                                blob["Designation"] = clubDesignation;
                                blob["ClassificationProfession"] = clubClassification;
                            }
                            result[f.Key] = JsonSerializer.Serialize(blob);
                        }
                        else
                        {
                            result[f.Key] = null;
                        }
                    }
                    else if (f.Type == "address-single" && f.Column != null)
                    {
                        // Designation / ClassificationProfession come from club_members,
                        // not from member_address_details — they're independent of
                        // whether the Business address row exists.
                        if (string.Equals(f.Column, "Designation", StringComparison.OrdinalIgnoreCase))
                        {
                            result[f.Key] = clubDesignation;
                            continue;
                        }
                        if (string.Equals(f.Column, "ClassificationProfession", StringComparison.OrdinalIgnoreCase))
                        {
                            result[f.Key] = clubClassification;
                            continue;
                        }

                        string? val = null;
                        if (row != null)
                        {
                            var dict = (IDictionary<string, object?>)row;
                            if (dict.TryGetValue(f.Column, out object? v)) val = v?.ToString();
                        }
                        result[f.Key] = val;
                    }
                }
            }
        }

        // Strip legacy junk from select-style fields (bloodGroup / gender /
        // primaryLanguage). When the stored DB value isn't one of the canonical
        // options, return null so the form dropdown renders as "Select" and the
        // completion % no longer counts it as filled. The DB row is NOT updated
        // — the user can pick a valid value and save to overwrite the junk.
        foreach (var key in result.Keys.ToList())
        {
            var f = GetField(key);
            if (f == null) continue;
            if ((f.Type == "bloodgroup" || f.Type == "gender" || f.Type == "language")
                && !IsCanonicalSelectValue(f, result[key]))
            {
                result[key] = null;
            }
        }

        return result;
    }

    // Canonical option sets — must mirror rotary-frontend/src/lib/constants.ts so
    // legacy non-matching values (e.g. "Not Specified", "NA") aren't counted as
    // filled when the user actually has nothing meaningful selected.
    private static readonly HashSet<string> CanonicalBloodGroups = new(StringComparer.OrdinalIgnoreCase)
        { "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-" };
    private static readonly HashSet<string> CanonicalGenders = new(StringComparer.OrdinalIgnoreCase)
        { "Male", "Female", "Other" };
    private static readonly HashSet<string> CanonicalLanguages = new(StringComparer.OrdinalIgnoreCase)
        { "English", "Hindi", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Bengali", "Punjabi", "Other" };

    public static bool IsCanonicalSelectValue(FieldDef field, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var v = value.Trim();
        return field.Type switch
        {
            "bloodgroup" => CanonicalBloodGroups.Contains(v),
            "gender"     => CanonicalGenders.Contains(v),
            "language"   => CanonicalLanguages.Contains(v),
            _            => true,
        };
    }

    // Counts a field as "filled" if its primary value is non-empty. For address-bulk, must have Address+City+State+PinCode.
    public static bool IsFilled(FieldDef field, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        // Select-style fields (blood group / gender / language) only count as
        // filled when the stored value matches a canonical option — protects
        // against legacy junk values from data imports being counted.
        if (field.Type == "bloodgroup" || field.Type == "gender" || field.Type == "language")
            return IsCanonicalSelectValue(field, value);
        if (field.Type != "address-bulk") return true;

        try
        {
            using var doc = JsonDocument.Parse(value);
            var el = doc.RootElement;
            string? Get(string n) => el.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
            return !string.IsNullOrWhiteSpace(Get("Address"))
                && !string.IsNullOrWhiteSpace(Get("City"))
                && !string.IsNullOrWhiteSpace(Get("State"))
                && !string.IsNullOrWhiteSpace(Get("PinCode"));
        }
        catch { return false; }
    }

    public static (int filled, int total, List<string> pendingLabels) ComputeCompletion(
        Dictionary<string, string?> values, List<string> enabledKeys)
    {
        int filled = 0;
        var pending = new List<string>();
        foreach (var key in enabledKeys)
        {
            var f = GetField(key);
            if (f == null) continue;
            values.TryGetValue(key, out var v);
            if (IsFilled(f, v)) filled++;
            else pending.Add(f.Label);
        }
        return (filled, enabledKeys.Count, pending);
    }

    // Render a field's value as inline HTML (for emails). Images get an <img>, addresses get multi-line, dates get pretty-formatted.
    public static string RenderValueHtml(FieldDef f, string? value, string apiBase)
    {
        if (string.IsNullOrWhiteSpace(value)) return "<i>—</i>";

        switch (f.Type)
        {
            case "image":
                {
                    string url = value;
                    if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                        url = $"{apiBase.TrimEnd('/')}/{url.TrimStart('/')}";
                    return $"<img src=\"{System.Net.WebUtility.HtmlEncode(url)}\" style=\"max-height:120px;border-radius:6px;border:1px solid #e2e8f0;\" alt=\"{System.Net.WebUtility.HtmlEncode(f.Label)}\"/>";
                }
            case "date":
                // Birthday / anniversary fields store a 1900 placeholder year — show DAY + MONTH only, never the year.
                if (DateTime.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt))
                    return dt.ToString("dd MMM");
                return System.Net.WebUtility.HtmlEncode(value);
            case "address-bulk":
                try
                {
                    using var doc = JsonDocument.Parse(value);
                    var el = doc.RootElement;
                    string? G(string n) => el.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
                    var addressLine = G("Address");
                    var city = G("City"); var state = G("State"); var pin = G("PinCode");
                    var cityStatePin = string.Join(", ", new[] { city, state, pin }.Where(p => !string.IsNullOrWhiteSpace(p)));
                    var phone = G("PhoneNumber");
                    var bizName = G("BusinessName"); var bizEmail = G("BusinessEmailId"); var desig = G("Designation");
                    var parts = new List<string>();
                    if (!string.IsNullOrWhiteSpace(addressLine)) parts.Add(System.Net.WebUtility.HtmlEncode(addressLine));
                    if (!string.IsNullOrWhiteSpace(cityStatePin)) parts.Add(System.Net.WebUtility.HtmlEncode(cityStatePin));
                    if (!string.IsNullOrWhiteSpace(phone)) parts.Add($"📞 {System.Net.WebUtility.HtmlEncode(phone)}");
                    if (!string.IsNullOrWhiteSpace(bizName)) parts.Add($"🏢 {System.Net.WebUtility.HtmlEncode(bizName)}");
                    if (!string.IsNullOrWhiteSpace(desig)) parts.Add($"💼 {System.Net.WebUtility.HtmlEncode(desig)}");
                    if (!string.IsNullOrWhiteSpace(bizEmail)) parts.Add($"✉️ {System.Net.WebUtility.HtmlEncode(bizEmail)}");
                    return parts.Count > 0 ? string.Join("<br/>", parts) : "<i>—</i>";
                }
                catch { return System.Net.WebUtility.HtmlEncode(value); }
            default:
                return System.Net.WebUtility.HtmlEncode(value);
        }
    }

    // Builds a side-by-side "Completed" (with values) + "Pending" (labels) HTML block for emails.
    public static string BuildCompletedAndPendingHtml(
        List<string> enabledKeys,
        Dictionary<string, string?> values,
        string apiBase)
    {
        var completedRows = new System.Text.StringBuilder();
        var pendingRows = new System.Text.StringBuilder();
        int completedCount = 0, pendingCount = 0;

        foreach (var key in enabledKeys)
        {
            var f = GetField(key);
            if (f == null) continue;
            values.TryGetValue(key, out var v);
            if (IsFilled(f, v))
            {
                completedCount++;
                completedRows.Append($@"
                    <tr>
                        <td style=""padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;width:40%;vertical-align:top;"">{System.Net.WebUtility.HtmlEncode(f.Label)}</td>
                        <td style=""padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;"">{RenderValueHtml(f, v, apiBase)}</td>
                    </tr>");
            }
            else
            {
                pendingCount++;
                pendingRows.Append($@"<li style=""padding:3px 0;"">{System.Net.WebUtility.HtmlEncode(f.Label)}</li>");
            }
        }

        var completedHtml = completedCount > 0
            ? $@"<h3 style=""color:#16a34a;margin:18px 0 8px;"">✅ Completed ({completedCount})</h3>
                 <table style=""border-collapse:collapse;width:100%;background:#f8fafc;border-radius:6px;"">{completedRows}</table>"
            : "";
        var pendingHtml = pendingCount > 0
            ? $@"<h3 style=""color:#dc2626;margin:18px 0 8px;"">⏳ Pending ({pendingCount})</h3>
                 <ol style=""color:#475569;line-height:1.5;margin:0;padding-left:22px;"">{pendingRows}</ol>"
            : $@"<h3 style=""color:#16a34a;margin:18px 0 8px;"">🎉 All fields complete!</h3>";

        return completedHtml + pendingHtml;
    }
}
