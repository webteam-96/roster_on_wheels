using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Validation and the smart-list filter compiler for member flexibility (tags, custom profile fields, smart lists).
/// Pure functions, no database: the compiler turns a <see cref="SmartListFilter"/> into a SQL fragment whose every
/// value is a named parameter. Only fixed SQL text from this file reaches the query; ids, operators and values from
/// the client are checked against the club's own tags, fields and committees first.
/// </summary>
public static class MemberFlexRules
{
    public static readonly string[] FieldTypes = { "text", "number", "date", "choice", "yesno" };
    public static readonly string[] Visibilities = { "admins", "members" };
    public const int MaxConditions = 20;
    private static readonly Regex HexColor = new("^#[0-9A-Fa-f]{6}$", RegexOptions.Compiled);

    public record FieldDef(int Id, string Type, IReadOnlyList<string> Options);

    public static string Name(string? value, int max, string what)
    {
        var v = (value ?? "").Trim();
        if (v.Length == 0) throw new ArgumentException($"{what} is required.");
        if (v.Length > max) throw new ArgumentException($"{what} must be at most {max} characters.");
        return v;
    }

    public static string Color(string? value)
    {
        var v = (value ?? "").Trim();
        if (v.Length == 0) return "#17458F";
        if (!HexColor.IsMatch(v)) throw new ArgumentException("Colour must look like #17458F.");
        return v.ToUpperInvariant();
    }

    public static string FieldType(string? value)
    {
        var v = (value ?? "").Trim().ToLowerInvariant();
        return FieldTypes.Contains(v) ? v : throw new ArgumentException("Field type must be text, number, date, choice or yesno.");
    }

    public static string Visibility(string? value)
    {
        var v = (value ?? "admins").Trim().ToLowerInvariant();
        return Visibilities.Contains(v) ? v : throw new ArgumentException("Visibility must be admins or members.");
    }

    /// <summary>Choice fields need 1 to 50 distinct options; other types keep none.</summary>
    public static List<string> Options(string type, List<string>? options)
    {
        if (type != "choice") return new();
        var list = (options ?? new()).Select(o => (o ?? "").Trim()).Where(o => o.Length > 0).ToList();
        if (list.Count == 0) throw new ArgumentException("A choice field needs at least one option.");
        if (list.Count > 50) throw new ArgumentException("A choice field can have at most 50 options.");
        if (list.Any(o => o.Length > 100)) throw new ArgumentException("Each option must be at most 100 characters.");
        if (list.Distinct(StringComparer.OrdinalIgnoreCase).Count() != list.Count) throw new ArgumentException("Options must be different from each other.");
        return list;
    }

    /// <summary>Canonical stored form of a value, or null for "no value". Throws ArgumentException when the value
    /// does not fit the field type. Numbers use the invariant culture, dates yyyy-MM-dd (so text order is date order).</summary>
    public static string? NormalizeValue(FieldDef field, string? raw)
    {
        var v = (raw ?? "").Trim();
        if (v.Length == 0) return null;
        switch (field.Type)
        {
            case "text":
                if (v.Length > 1000) throw new ArgumentException("Text must be at most 1000 characters.");
                return v;
            case "number":
                if (!decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) || Math.Abs(d) >= 1_000_000_000_000m)
                    throw new ArgumentException($"'{v}' is not a number.");
                return Math.Round(d, 4).ToString("0.####", CultureInfo.InvariantCulture);
            case "date":
                if (!DateTime.TryParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
                    throw new ArgumentException($"'{v}' is not a date (yyyy-MM-dd).");
                return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            case "choice":
                return field.Options.FirstOrDefault(o => o.Equals(v, StringComparison.OrdinalIgnoreCase))
                    ?? throw new ArgumentException($"'{v}' is not one of the options.");
            case "yesno":
                return v.ToLowerInvariant() switch
                {
                    "yes" or "true" or "1" => "yes",
                    "no" or "false" or "0" => "no",
                    _ => throw new ArgumentException("Answer yes or no."),
                };
            default:
                throw new ArgumentException("Unknown field type.");
        }
    }

    private static string? Date(string? value, string what)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : throw new ArgumentException($"{what} must be a date (yyyy-MM-dd).");
    }

    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>
    /// Compiles the filter into " AND ..." clauses over aliases <c>m</c> (member_master_profile) and <c>cm</c>
    /// (club_members). The caller adds @ClubId. Unknown tags, fields or committees, unknown operators and values that
    /// do not fit the field are rejected with ArgumentException.
    /// </summary>
    public static (string Sql, Dictionary<string, object?> Args) Compile(SmartListFilter f, IReadOnlyDictionary<int, FieldDef> fields,
        IReadOnlySet<int> clubTagIds, IReadOnlySet<int> clubSubGroupIds)
    {
        var sql = new StringBuilder();
        var args = new Dictionary<string, object?>();
        const string member = "m.pk_member_master_profile_id";

        if (!string.IsNullOrWhiteSpace(f.Search))
        {
            var s = f.Search.Trim();
            if (s.Length > 100) throw new ArgumentException("Search must be at most 100 characters.");
            sql.Append(" AND (m.MemberName LIKE @Search OR m.EmailId LIKE @Search)");
            args["Search"] = "%" + EscapeLike(s) + "%";
        }

        var tags = (f.TagIds ?? new()).Distinct().ToList();
        if (tags.Count > 0)
        {
            if (tags.Count > MaxConditions) throw new ArgumentException($"Pick at most {MaxConditions} tags.");
            if (tags.Any(t => !clubTagIds.Contains(t))) throw new ArgumentException("One or more tags were not found. Edit the list.");
            var mode = (f.TagMode ?? "any").Trim().ToLowerInvariant();
            const string tagExists = "EXISTS (SELECT 1 FROM club_tag_assignments ta JOIN club_tags t ON t.pk_club_tag_id = ta.fk_club_tag_id "
                + "WHERE t.fk_club_id = @ClubId AND ta.entity_type = 'member' AND ta.entity_id = " + member;
            if (mode == "any")
            {
                sql.Append($" AND {tagExists} AND ta.fk_club_tag_id IN @Tags)");
                args["Tags"] = tags;
            }
            else if (mode == "all")
            {
                for (var i = 0; i < tags.Count; i++)
                {
                    sql.Append($" AND {tagExists} AND ta.fk_club_tag_id = @Tag{i})");
                    args[$"Tag{i}"] = tags[i];
                }
            }
            else throw new ArgumentException("Tag match must be any or all.");
        }

        switch ((f.MemberType ?? "").Trim().ToLowerInvariant())
        {
            case "": break;
            case "active": sql.Append(" AND IFNULL(cm.IsHonoraryMember, 0) = 0"); break;
            case "honorary": sql.Append(" AND cm.IsHonoraryMember = 1"); break;
            default: throw new ArgumentException("Member type must be active or honorary.");
        }

        var from = Date(f.JoinedFrom, "Joined from");
        var to = Date(f.JoinedTo, "Joined to");
        if (from != null) { sql.Append(" AND cm.JoinedDate >= @JoinedFrom"); args["JoinedFrom"] = from; }
        if (to != null) { sql.Append(" AND cm.JoinedDate <= @JoinedTo"); args["JoinedTo"] = to; }

        var groups = (f.SubGroupIds ?? new()).Distinct().ToList();
        if (groups.Count > 0)
        {
            if (groups.Count > MaxConditions) throw new ArgumentException($"Pick at most {MaxConditions} committees.");
            if (groups.Any(g => !clubSubGroupIds.Contains(g))) throw new ArgumentException("One or more committees were not found. Edit the list.");
            sql.Append(" AND EXISTS (SELECT 1 FROM sub_group_members sgm JOIN sub_groups sg ON sg.pk_sub_group_id = sgm.fk_sub_group_id "
                + "WHERE sg.fk_club_id = @ClubId AND IFNULL(sg.isdeleted, 0) = 0 AND IFNULL(sgm.isdeleted, 0) = 0 "
                + $"AND sgm.fk_member_master_profile_id = {member} AND sgm.fk_sub_group_id IN @SubGroups)");
            args["SubGroups"] = groups;
        }

        var conds = f.Fields ?? new();
        if (conds.Count > MaxConditions) throw new ArgumentException($"Use at most {MaxConditions} field conditions.");
        for (var i = 0; i < conds.Count; i++)
        {
            var c = conds[i];
            if (!fields.TryGetValue(c.FieldId, out var field)) throw new ArgumentException("A profile field in this list was deleted. Edit the list.");
            var op = (c.Op ?? "").Trim().ToLowerInvariant();
            var valueExists = $"EXISTS (SELECT 1 FROM club_profile_values v{i} WHERE v{i}.fk_profile_field_id = @F{i} AND v{i}.fk_member_id = {member}";
            args[$"F{i}"] = field.Id;
            if (op == "set") { sql.Append($" AND {valueExists})"); continue; }
            if (op == "notset") { sql.Append($" AND NOT {valueExists})"); continue; }

            var value = NormalizeValue(field, c.Value) ?? throw new ArgumentException("Enter a value for each field condition.");
            string compare = (field.Type, op) switch
            {
                (_, "eq") => $"v{i}.value = @V{i}",
                ("text", "contains") => $"v{i}.value LIKE @V{i}",
                ("number", "gt") => $"CAST(v{i}.value AS DECIMAL(20,4)) > @V{i}",
                ("number", "lt") => $"CAST(v{i}.value AS DECIMAL(20,4)) < @V{i}",
                ("date", "after") => $"v{i}.value > @V{i}",
                ("date", "before") => $"v{i}.value < @V{i}",
                _ => throw new ArgumentException($"'{op}' cannot be used with a {field.Type} field."),
            };
            args[$"V{i}"] = op == "contains" ? "%" + EscapeLike(value) + "%"
                : field.Type == "number" && op != "eq" ? decimal.Parse(value, CultureInfo.InvariantCulture)
                : value;
            sql.Append($" AND {valueExists} AND {compare})");
        }
        return (sql.ToString(), args);
    }

    /// <summary>Quotes a CSV cell; a cell starting with = + - @ gets a ' so a spreadsheet never runs it as a formula.</summary>
    public static string Csv(string? v)
    {
        v ??= "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
        return "\"" + v.Replace("\"", "\"\"") + "\"";
    }
}
