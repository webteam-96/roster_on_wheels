using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Custom report builder: the whitelist of sources and columns, and the one place that turns a
/// <see cref="CustomReportDefinition"/> into SQL. Nothing the client sends reaches the SQL text: field keys are looked
/// up in the whitelist (unknown keys are rejected), operators come from a fixed set and every value is a parameter.
/// Every source is narrowed to the clubs in @Clubs (and, for contacts, the district's own contacts when @District > 0);
/// the caller decides those clubs from who is asking.
/// </summary>
public static class CustomReportQuery
{
    public enum FieldType { Text, Number, Date, Bool }

    public sealed record Field(string Key, string Label, FieldType Type, string Sql);

    /// <param name="From">FROM ... JOIN ...; "{projects}" stands for the year's project table</param>
    /// <param name="Where">base condition, including the club scope</param>
    public sealed record Source(string Key, string Label, string From, string Where, Field[] Fields);

    public const int RowCap = 5000;

    private static Field T(string k, string l, string sql) => new(k, l, FieldType.Text, sql);
    private static Field N(string k, string l, string sql) => new(k, l, FieldType.Number, sql);
    private static Field D(string k, string l, string sql) => new(k, l, FieldType.Date, sql);
    private static Field B(string k, string l, string sql) => new(k, l, FieldType.Bool, sql);

    public static readonly Source[] Sources =
    {
        new("members", "Members",
            @"club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id",
            "IFNULL(cm.isdeleted, 0) = 0 AND IFNULL(m.isdeleted, 0) = 0 AND cm.fk_club_id IN @Clubs",
            new[]
            {
                T("name", "Name", "m.MemberName"),
                T("email", "Email", "m.EmailId"),
                T("mobile", "Mobile", "m.PrimaryMobileNumber"),
                T("gender", "Gender", "m.Gender"),
                T("rotaryId", "Rotary ID", "m.RotaryId"),
                D("birthDate", "Birth date", "m.BirthDate"),
                D("joinedDate", "Joined", "cm.JoinedDate"),
                N("yearsInClub", "Years in club", "TIMESTAMPDIFF(YEAR, cm.JoinedDate, CURDATE())"),
                B("active", "Active", "IF(cm.IsActive = 1, 1, 0)"),
                B("honorary", "Honorary", "IF(cm.IsHonoraryMember = 1, 1, 0)"),
                T("designation", "Designation", "cm.Designation"),
                T("classification", "Classification", "cm.ClassificationProfession"),
                T("memberType", "Member type", "cm.ri_member_type"),
                D("terminationDate", "Termination date", "cm.TerminationDate"),
                T("club", "Club", "c.ClubName"),
            }),
        new("attendance", "Attendance (meetings)",
            "club_attendance a JOIN club_master c ON c.pk_club_id = a.fk_club_id",
            "IFNULL(a.isdeleted, 0) = 0 AND a.fk_club_id IN @Clubs",
            new[]
            {
                T("meeting", "Meeting", "a.EventName"),
                D("date", "Date", "DATE(a.EventDateTime)"),
                T("mode", "Mode", "a.MeetingMode"),
                T("year", "Rotary year", "(SELECT y.YearLabel FROM rotary_year_master y WHERE y.pk_year_id = a.fk_year_id)"),
                N("present", "Members present", "(SELECT COUNT(*) FROM club_attendance_members x WHERE x.fk_attendance_id = a.pk_attendance_id)"),
                T("club", "Club", "c.ClubName"),
            }),
        new("dues", "District dues (per member)",
            @"club_dues_members dm
              JOIN club_dues d ON d.pk_club_dues_id = dm.fk_club_dues_id
              LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = dm.fk_member_profile_id
              JOIN club_master c ON c.pk_club_id = dm.fk_club_id",
            "IFNULL(dm.isdeleted, 0) = 0 AND IFNULL(d.isdeleted, 0) = 0 AND dm.fk_club_id IN @Clubs",
            new[]
            {
                T("purpose", "Purpose", "d.Purpose"),
                T("rotaryYear", "Rotary year", "d.RotaryYear"),
                T("member", "Member", "m.MemberName"),
                N("rate", "Amount", "dm.Rate"),
                B("paid", "Paid", "IF(dm.IsPaid = 1, 1, 0)"),
                D("paidDate", "Paid on", "DATE(dm.PaidDate)"),
                B("honorary", "Honorary", "IF(dm.IsHonorary = 1, 1, 0)"),
                T("club", "Club", "c.ClubName"),
            }),
        new("projects", "Projects",
            "`{projects}` p JOIN club_master c ON c.pk_club_id = p.fk_club_id",
            "IFNULL(p.isdeleted, 0) = 0 AND p.fk_club_id IN @Clubs",
            new[]
            {
                T("title", "Title", "p.title"),
                D("date", "Date", "p.project_date"),
                T("type", "Type", "p.project_type"),
                T("location", "Location", "p.location"),
                N("cost", "Cost", "p.project_cost"),
                N("beneficiaries", "Beneficiaries", "p.direct_beneficiaries"),
                N("manHours", "Volunteer hours", "p.man_hours"),
                N("rotarians", "Rotarians involved", "p.rotarians_involved"),
                T("approval", "Approval", "p.approval_status"),
                T("club", "Club", "c.ClubName"),
            }),
        new("contacts", "Contacts",
            "contacts ct LEFT JOIN club_master c ON c.pk_club_id = ct.fk_club_id",
            "(ct.fk_club_id IN @Clubs OR (@District > 0 AND ct.fk_club_id IS NULL AND ct.fk_district_id = @District))",
            new[]
            {
                T("name", "Name", "ct.name"),
                T("email", "Email", "ct.email"),
                T("mobile", "Mobile", "ct.mobile"),
                T("type", "Type", "ct.contact_type"),
                T("organisation", "Organisation", "ct.organisation"),
                T("source", "Source", "ct.source"),
                D("added", "Added", "DATE(ct.created_date)"),
                T("club", "Club", "c.ClubName"),
            }),
    };

    private static readonly HashSet<string> Ops = new() { "eq", "neq", "contains", "gt", "gte", "lt", "lte", "empty", "notempty" };
    private static readonly Regex ProjectTable = new(@"^rotary_projects_\d{4}_\d{2}$", RegexOptions.Compiled);

    public static Source? FindSource(string? key) => Sources.FirstOrDefault(s => s.Key == key);

    public static IReadOnlyList<CustomReportSourceInfo> Catalog() =>
        Sources.Select(s => new CustomReportSourceInfo(s.Key, s.Label,
            s.Fields.Select(f => new CustomReportFieldInfo(f.Key, f.Label, TypeName(f.Type))).ToList())).ToList();

    public static string TypeName(FieldType t) => t.ToString().ToLowerInvariant();

    /// <summary>Checks a definition against the whitelist; returns the first problem, or null when it is valid.</summary>
    public static string? Validate(CustomReportDefinition d)
    {
        var src = FindSource(d.Source);
        if (src == null) return "Choose a source.";
        Field? F(string? key) => src.Fields.FirstOrDefault(f => f.Key == key);
        if (d.GroupBy == null && d.Columns.Count == 0) return "Choose at least one column.";
        if (d.Columns.Count > 30) return "Choose at most 30 columns.";
        if (d.Columns.Distinct().Count() != d.Columns.Count) return "A column is chosen twice.";
        foreach (var c in d.Columns) if (F(c) == null) return $"Unknown column: {c}.";
        if (d.GroupBy != null && F(d.GroupBy) == null) return $"Unknown group field: {d.GroupBy}.";
        if (d.GroupBy == null && d.SumFields.Count > 0) return "Sums need a group field.";
        foreach (var s in d.SumFields)
            if (F(s) is not { Type: FieldType.Number }) return $"Only number fields can be summed: {s}.";
        if (d.SortBy != null && F(d.SortBy) == null && d.SortBy != "count") return $"Unknown sort field: {d.SortBy}.";
        if (d.Filters.Count > 20) return "Use at most 20 filters.";
        foreach (var f in d.Filters)
        {
            var field = F(f.Field);
            if (field == null) return $"Unknown filter field: {f.Field}.";
            if (!Ops.Contains(f.Op)) return $"Unknown filter: {f.Op}.";
            if (f.Op is "empty" or "notempty") continue;
            if (f.Op == "contains" && field.Type != FieldType.Text) return $"{field.Label}: 'contains' works on text only.";
            if (f.Op is "gt" or "gte" or "lt" or "lte" && field.Type is FieldType.Text or FieldType.Bool)
                return $"{field.Label}: use a number or date field to compare.";
            if (ParseValue(field.Type, f.Value) == null) return $"{field.Label}: the value is not valid.";
        }
        return null;
    }

    public static object? ParseValue(FieldType type, string? raw)
    {
        var v = raw?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        return type switch
        {
            FieldType.Text => v.Length <= 200 ? v : null,
            FieldType.Number => decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var n) ? n : null,
            FieldType.Date => DateOnly.TryParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)
                ? dt.ToDateTime(TimeOnly.MinValue) : null,
            FieldType.Bool => v is "true" or "1" ? 1 : v is "false" or "0" ? 0 : null,
            _ => null,
        };
    }

    /// <summary>Builds the SELECT for a definition that <see cref="Validate"/> accepted. projectTable is required for
    /// the projects source and must be a year table name (rotary_projects_YYYY_YY).</summary>
    public static (string Sql, DynamicParameters Args, List<CustomReportColumn> Columns) Build(
        CustomReportDefinition d, IReadOnlyList<int> clubs, int districtId, string? projectTable)
    {
        if (Validate(d) is { } problem) throw new ArgumentException(problem);
        var src = FindSource(d.Source)!;
        Field F(string key) => src.Fields.First(f => f.Key == key);
        var from = src.From;
        if (from.Contains("{projects}"))
        {
            if (projectTable == null || !ProjectTable.IsMatch(projectTable)) throw new ArgumentException("No project table for that year.");
            from = from.Replace("{projects}", projectTable);
        }

        var args = new DynamicParameters();
        // IN () is a syntax error: a scope with no clubs matches nothing through club 0.
        args.Add("Clubs", clubs.Count == 0 ? new[] { 0 } : clubs.ToArray());
        args.Add("District", districtId);
        args.Add("Cap", RowCap + 1);

        var where = new StringBuilder(src.Where);
        for (int i = 0; i < d.Filters.Count; i++)
        {
            var f = d.Filters[i];
            var field = F(f.Field);
            var p = "@f" + i;
            where.Append(" AND ");
            if (f.Op == "empty") { where.Append($"({field.Sql} IS NULL OR CAST({field.Sql} AS CHAR) = '')"); continue; }
            if (f.Op == "notempty") { where.Append($"({field.Sql} IS NOT NULL AND CAST({field.Sql} AS CHAR) <> '')"); continue; }
            var value = ParseValue(field.Type, f.Value)!;
            if (f.Op == "contains")
            {
                // the value is a parameter; escape LIKE wildcards so '%' and '_' match themselves
                value = ((string)value).Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
                where.Append($"{field.Sql} LIKE CONCAT('%', {p}, '%')");
            }
            else
            {
                var op = f.Op switch { "eq" => "=", "neq" => "<>", "gt" => ">", "gte" => ">=", "lt" => "<", _ => "<=" };
                // neq keeps the rows with no value, as people expect "not X" to include blanks
                where.Append(f.Op == "neq" ? $"({field.Sql} IS NULL OR {field.Sql} <> {p})" : $"{field.Sql} {op} {p}");
            }
            args.Add(p.TrimStart('@'), value);
        }

        var dir = d.SortDesc ? "DESC" : "ASC";
        string sql;
        var columns = new List<CustomReportColumn>();
        if (d.GroupBy != null)
        {
            var g = F(d.GroupBy);
            var select = new List<string> { $"{g.Sql} AS c0", "COUNT(*) AS c1" };
            columns.Add(new(g.Key, g.Label, TypeName(g.Type)));
            columns.Add(new("count", "Count", "number"));
            for (int i = 0; i < d.SumFields.Count; i++)
            {
                var s = F(d.SumFields[i]);
                select.Add($"COALESCE(SUM({s.Sql}), 0) AS c{i + 2}");
                columns.Add(new("sum_" + s.Key, "Total " + s.Label.ToLowerInvariant(), "number"));
            }
            var order = d.SortBy == "count" ? $"c1 {dir}"
                : d.SortBy != null && d.SumFields.IndexOf(d.SortBy) is var si and >= 0 ? $"c{si + 2} {dir}"
                : $"c0 {dir}";
            sql = $"SELECT {string.Join(", ", select)} FROM {from} WHERE {where} GROUP BY c0 ORDER BY {order} LIMIT @Cap";
        }
        else
        {
            var select = d.Columns.Select((k, i) => $"{F(k).Sql} AS c{i}");
            columns.AddRange(d.Columns.Select(k => F(k)).Select(f => new CustomReportColumn(f.Key, f.Label, TypeName(f.Type))));
            var order = d.SortBy != null && d.SortBy != "count" ? $"{F(d.SortBy).Sql} {dir}" : "1";
            sql = $"SELECT {string.Join(", ", select)} FROM {from} WHERE {where} ORDER BY {order} LIMIT @Cap";
        }
        return (sql, args, columns);
    }
}
