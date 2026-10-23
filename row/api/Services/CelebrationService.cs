using System.Globalization;
using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Target celebration (build list B.1 #35, B.4, flag celebration). A club reaches a target when a metric of the N10
/// target dashboard with a target above 0 (N3 growth, goal setting new members or Foundation giving, the District Dues
/// roster all paid) has reached it this Rotary year. Once per target, an engagement_events row of type TARGET (dedupe
/// key TARGET:{club}:{year}:{metric}:{target}, so a raised target is a new one): the club's members see it in the app
/// (feed type celebration), its spotlight card waits for approval in the N9 queue, and the District Governor gets an
/// email note. The row is written before the note goes, so a rerun never sends twice.
/// </summary>
public class CelebrationService
{
    public const string FeatureKey = "celebration";

    // Dashboard metrics that carry a club target, with their names in texts.
    private static readonly Dictionary<string, string> Metrics = new()
    {
        ["growth"] = "membership growth", ["newMembers"] = "new members", ["dues"] = "District Dues", ["foundation"] = "Foundation giving",
    };

    private readonly string _cs;
    private readonly TargetDashboardService _targets;
    private readonly IEmailService _email;
    private readonly ILogger<CelebrationService> _log;

    public CelebrationService(IConfiguration config, TargetDashboardService targets, IEmailService email, ILogger<CelebrationService> log)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _targets = targets;
        _email = email;
        _log = log;
    }

    private static string Name(string? metric) => Metrics.GetValueOrDefault(metric ?? "", "club");

    /// <summary>"Membership growth target reached".</summary>
    public static string Label(string? metric) { var n = Name(metric); return char.ToUpperInvariant(n[0]) + n[1..] + " target reached"; }

    /// <summary>The line in the app, the highlights and the card: "Rotary Club of X reached its new members target of 5."</summary>
    public static string Sentence(string? metric, int target, string? clubName)
        => $"{(string.IsNullOrWhiteSpace(clubName) ? "The club" : clubName)} reached its {Name(metric)} target of {target.ToString("#,0", CultureInfo.InvariantCulture)}.";

    /// <summary>The daily pass over every active district, or one district (the SuperAdmin "run now"). Returns the
    /// number of targets celebrated.</summary>
    // shortcut: every active district's dashboard is read once a day (one set of queries each); read only districts
    // with club targets if the pass gets slow.
    public async Task<int> RunAsync(int? districtId, CancellationToken ct = default)
    {
        if (!await FeatureGate.IsOnAsync(FeatureKey, _cs)) return 0;
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync(ct);
        var districts = await conn.QueryAsync<int>(@"
            SELECT d.pk_district_id FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
            WHERE d.isdeleted = 0 AND d.IsActive = 1 AND (@D IS NULL OR d.pk_district_id = @D)", new { D = districtId });
        var count = 0;
        foreach (var d in districts)
        {
            if (ct.IsCancellationRequested) break;
            if (await _targets.GetDistrictForJobAsync(d) is not { } dash) continue;
            var reached = new List<(string Club, string Metric, int Target, decimal Actual)>();
            foreach (var club in dash.Clubs)
                foreach (var metric in Metrics.Keys)
                {
                    if (!club.Metrics.TryGetValue(metric, out var m) || m.Target is not { } t || t < 1 || m.Actual < t) continue;
                    var target = (int)Math.Round(t);
                    var inserted = await conn.ExecuteAsync(@"
                        INSERT IGNORE INTO engagement_events
                            (event_type, dedupe_key, fk_member_master_profile_id, fk_club_id, fk_district_id, level, occurred_on, target_key)
                        VALUES ('TARGET', @Key, NULL, @Club, @District, @Target, CURDATE(), @Metric)",
                        new { Key = $"TARGET:{club.ClubId}:{dash.YearId}:{metric}:{target}", Club = club.ClubId, District = d, Target = target, Metric = metric });
                    if (inserted > 0) reached.Add((club.ClubName, metric, target, m.Actual)); // 0: celebrated before
                }
            if (reached.Count == 0) continue;
            count += reached.Count;
            // One note per district and pass, so the DG gets a list rather than one email per target.
            // shortcut: a failed note is not retried (the rows are the claim; email_log shows the failure).
            var governor = await conn.QueryFirstOrDefaultAsync<(string? Name, string? Email)>($@"
                SELECT {DistrictGovernorSql.Name}, {DistrictGovernorSql.Email} FROM district_governors g
                {DistrictGovernorSql.JoinMember}
                JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id AND y.IsCurrent = 1 AND y.isdeleted = 0
                WHERE g.fk_district_id = @D AND g.isdeleted = 0 ORDER BY g.pk_id DESC LIMIT 1", new { D = d });
            if (!string.IsNullOrWhiteSpace(governor.Email))
            {
                var (subject, html) = Note(reached, dash.YearLabel, governor.Name);
                await _email.SendScopedEmailAsync(governor.Email, subject, html, null, d);
            }
        }
        if (count > 0) _log.LogInformation("Celebration pass: {Count} targets reached", count);
        return count;
    }

    // English, ROW's default language (like the N9 milestone email).
    private static (string Subject, string Html) Note(List<(string Club, string Metric, int Target, decimal Actual)> reached,
        string year, string? governor)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var subject = (reached.Count == 1
            ? $"{reached[0].Club} reached its {Name(reached[0].Metric)} target"
            : $"{reached.Count} club targets reached").Replace("\r", " ").Replace("\n", " ");
        var items = string.Concat(reached.Select(r =>
            $"<li>{E(Sentence(r.Metric, r.Target, r.Club))} Actual for {E(year)}: {r.Actual.ToString("#,0.##", CultureInfo.InvariantCulture)}.</li>"));
        var html = EmailService.EMAIL_HEADER + $@"
                        <p>Dear {E(string.IsNullOrWhiteSpace(governor) ? "District Governor" : governor)},</p>
                        <p>Targets reached in your district:</p>
                        <ul>{items}</ul>
                        <p>Each club's members see the news in the app, and a spotlight card for each waits for approval.</p>" + EmailService.EMAIL_FOOTER;
        return (subject, html);
    }
}
