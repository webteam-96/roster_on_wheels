using System.Globalization;
using System.Text;

namespace RotaryApi.Services;

/// <summary>
/// Club accounts helpers with no database: bank statement CSV parsing, amount in words for vouchers and cheques,
/// and the aged balances buckets. Unit tested in ClubAccountsToolsTests.
/// </summary>
public static class ClubAccountsTools
{
    // ===== Bank statement CSV =====

    public record StatementRow(DateTime Date, string Description, decimal Amount);

    private static readonly string[] DateFormats =
    {
        "yyyy-MM-dd", "yyyy/MM/dd", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy",
        "dd MMM yyyy", "d MMM yyyy", "dd-MMM-yyyy", "d-MMM-yyyy", "yyyyMMdd",
    };

    /// <summary>
    /// Reads "date, description, amount" rows (money in positive, out negative or in brackets). A first row whose date
    /// does not parse is taken as a header. Day comes before month (dd/MM/yyyy) for slash dates. Returns the rows and
    /// one plain-words problem per bad line; at most 2000 rows.
    /// </summary>
    public static (List<StatementRow> Rows, List<string> Problems) ParseStatementCsv(string text)
    {
        var rows = new List<StatementRow>();
        var problems = new List<string>();
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var raw = lines[i].Trim().TrimStart('﻿');
            if (raw.Length == 0) continue;
            var cells = SplitCsv(raw);
            var n = i + 1;
            if (cells.Count < 3) { problems.Add($"Line {n}: expected date, description and amount."); continue; }
            var dateOk = TryDate(cells[0], out var date);
            if (!dateOk && rows.Count == 0 && problems.Count == 0) continue; // header
            if (!dateOk) { problems.Add($"Line {n}: \"{Clip(cells[0])}\" is not a date."); continue; }
            // descriptions with unquoted commas: everything between the date and the last cell
            var description = string.Join(",", cells.Skip(1).Take(cells.Count - 2)).Trim();
            if (!TryAmount(cells[^1], out var amount)) { problems.Add($"Line {n}: \"{Clip(cells[^1])}\" is not an amount."); continue; }
            if (amount == 0) { problems.Add($"Line {n}: the amount is zero."); continue; }
            if (description.Length == 0) description = "(no description)";
            rows.Add(new(date, description.Length > 255 ? description[..255] : description, amount));
            if (rows.Count > 2000) { problems.Add("A statement file can have at most 2000 lines."); break; }
        }
        return (rows, problems);
    }

    private static string Clip(string s) => s.Length > 40 ? s[..40] : s;

    public static bool TryDate(string s, out DateTime date) =>
        DateTime.TryParseExact(s.Trim(), DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    /// <summary>"1,250.50", "-75", "(75.00)", "$ 10" are amounts; more than two decimals is not.</summary>
    public static bool TryAmount(string s, out decimal amount)
    {
        amount = 0;
        var t = new string(s.Trim().Where(c => char.IsDigit(c) || c is '.' or '-' or '(' or ')').ToArray());
        var negative = t.StartsWith('(') && t.EndsWith(')');
        t = t.Trim('(', ')');
        if (t.Length == 0 || !decimal.TryParse(t, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out amount)) return false;
        if (decimal.Round(amount, 2) != amount || Math.Abs(amount) > ClubLedger.MaxAmount) return false;
        if (negative) amount = -Math.Abs(amount);
        return true;
    }

    private static List<string> SplitCsv(string line)
    {
        var cells = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else sb.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c is ',' or ';' or '\t') { cells.Add(sb.ToString().Trim()); sb.Clear(); }
            else sb.Append(c);
        }
        cells.Add(sb.ToString().Trim());
        return cells;
    }

    // ===== Amount in words (vouchers, cheques) =====

    private static readonly string[] Ones =
    {
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    };
    private static readonly string[] Tens = { "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety" };

    /// <summary>"One thousand two hundred fifty and 50/100": the cheque style, with no currency name.</summary>
    public static string AmountInWords(decimal amount)
    {
        amount = Math.Abs(decimal.Round(amount, 2));
        var whole = (long)decimal.Truncate(amount);
        var cents = (int)((amount - whole) * 100);
        var words = Words(whole);
        return char.ToUpperInvariant(words[0]) + words[1..] + $" and {cents:00}/100";
    }

    private static string Words(long n)
    {
        if (n < 20) return Ones[n];
        if (n < 100) return Tens[n / 10] + (n % 10 > 0 ? "-" + Ones[n % 10] : "");
        if (n < 1000) return Ones[n / 100] + " hundred" + (n % 100 > 0 ? " " + Words(n % 100) : "");
        foreach (var (size, name) in new[] { (1_000_000_000_000L, "trillion"), (1_000_000_000L, "billion"), (1_000_000L, "million"), (1_000L, "thousand") })
            if (n >= size) return Words(n / size) + " " + name + (n % size > 0 ? " " + Words(n % size) : "");
        return "";
    }

    // ===== Aged balances =====

    /// <summary>One amount a member owes and when it fell due.</summary>
    public record Charge(int MemberId, string MemberName, string Item, decimal Amount, DateTime DueDate);

    /// <summary>A member's fee row of one dues collection. PaidTypes: the paid FeeTypes, "1,2" (1 annual, 2 and 3 the halves).</summary>
    public record FeeRow(int MemberId, string MemberName, string Collection, bool Fees1, bool Fees2, bool Fees3,
        string? Text1, string? Text2, string? Text3, decimal Annual, decimal Semi1, decimal Semi2, DateTime RaisedOn, string? PaidTypes);

    /// <summary>
    /// What a member still owes on one fee row, the way the dues module counts it: a fee type is settled once a paid
    /// payment exists for it. Annual paid = nothing owed. Once a half is paid (or annual is not offered) the member is on
    /// halves: the first is due when the dues were raised, the second six months later. Otherwise the annual fee is due
    /// when the dues were raised.
    /// shortcut: due dates come from when the club raised the dues (the dues module has no due date); add one if clubs ask.
    /// </summary>
    public static IEnumerable<Charge> ChargesFor(FeeRow f)
    {
        var paid = (f.PaidTypes ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
        if (paid.Contains("1")) yield break;
        var halves = paid.Contains("2") || paid.Contains("3") || !f.Fees1;
        string Label(string? text, string fallback) => $"{f.Collection}: {(string.IsNullOrWhiteSpace(text) ? fallback : text)}".Trim(' ', ':');
        if (!halves)
        {
            if (f.Annual > 0) yield return new(f.MemberId, f.MemberName, Label(f.Text1, "Annual"), f.Annual, f.RaisedOn.Date);
            yield break;
        }
        if (f.Fees2 && !paid.Contains("2") && f.Semi1 > 0) yield return new(f.MemberId, f.MemberName, Label(f.Text2, "First half"), f.Semi1, f.RaisedOn.Date);
        if (f.Fees3 && !paid.Contains("3") && f.Semi2 > 0) yield return new(f.MemberId, f.MemberName, Label(f.Text3, "Second half"), f.Semi2, f.RaisedOn.Date.AddMonths(6));
    }

    public record AgedRow(int MemberId, string MemberName, decimal NotDue, decimal Days0To30, decimal Days31To60,
        decimal Days61To90, decimal Over90, decimal Total, List<Charge> Items);

    public record AgedReport(DateTime AsOf, List<AgedRow> Rows, AgedRow Totals);

    /// <summary>Buckets by days past due on asOf: 0-30, 31-60, 61-90, over 90; a charge not due yet is NotDue.</summary>
    public static AgedReport BuildAging(IEnumerable<Charge> charges, DateTime asOf)
    {
        var day = asOf.Date;
        var rows = charges.Where(c => c.Amount > 0)
            .GroupBy(c => c.MemberId)
            .Select(g =>
            {
                decimal nd = 0, a = 0, b = 0, c = 0, d = 0;
                foreach (var ch in g)
                {
                    var age = (day - ch.DueDate.Date).Days;
                    if (age < 0) nd += ch.Amount;
                    else if (age <= 30) a += ch.Amount;
                    else if (age <= 60) b += ch.Amount;
                    else if (age <= 90) c += ch.Amount;
                    else d += ch.Amount;
                }
                return new AgedRow(g.Key, g.First().MemberName, nd, a, b, c, d, nd + a + b + c + d, g.OrderBy(x => x.DueDate).ToList());
            })
            .OrderByDescending(r => r.Over90).ThenByDescending(r => r.Total).ThenBy(r => r.MemberName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var totals = new AgedRow(0, "Total", rows.Sum(r => r.NotDue), rows.Sum(r => r.Days0To30), rows.Sum(r => r.Days31To60),
            rows.Sum(r => r.Days61To90), rows.Sum(r => r.Over90), rows.Sum(r => r.Total), new());
        return new(day, rows, totals);
    }
}
