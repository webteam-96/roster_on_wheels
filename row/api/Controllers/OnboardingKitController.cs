using System.Net;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using RotaryApi.Services.Localization;

namespace RotaryApi.Controllers;

/// <summary>
/// Per-club onboarding kit (build spec 3.2): a printable page with the steps to authorise ROW as the club's vendor in
/// My Rotary and the Rotary Showcase extension's install link, and a nudge email to the club's president and
/// secretary. For the district's managers. The steps and the link come from Brand:Onboarding settings, so they can
/// follow RI's wording without a release (RI's own vendor form cannot be pre-filled until ROW has Rotary.org access).
/// </summary>
[ApiController]
[Authorize]
public class OnboardingKitController : ControllerBase
{
    private readonly string _cs;
    private readonly IConfiguration _config;
    private readonly IEmailService _email;

    public OnboardingKitController(IConfiguration config, IEmailService email)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _email = email;
    }

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private string[] Steps => _config.GetSection("Brand:Onboarding:RiAuthorisationSteps").Get<string[]>() is { Length: > 0 } s ? s : new[]
    {
        "Sign in to My Rotary as the club president or secretary.",
        "In your club's administration, authorise ROW (Roster On Wheels) as the club's membership data vendor.",
    };
    private string? ShowcaseUrl => _config["Brand:Onboarding:ShowcaseExtensionUrl"] is { Length: > 0 } u ? u : null;

    private async Task<(string Club, string? District)?> ClubAsync(MySqlConnection c, int districtId, int clubId) =>
        await c.QueryFirstOrDefaultAsync<(string, string?)?>(@"
            SELECT c.ClubName, d.DistrictNumber FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @clubId AND c.fk_district_id = @districtId AND c.isdeleted = 0", new { clubId, districtId });

    // Written in the current culture's language (S5): the nudge sets each recipient's, the kit page stays English.
    private string Body(string club, string? district)
    {
        var L = DbStringLocalizer.Instance;
        var sb = new StringBuilder();
        sb.Append($"<p>{L["Welcome to ROW, {0} (District {1}).", $"<strong>{Enc(club)}</strong>", Enc(district)]}</p>");
        sb.Append($"<p>{L["So ROW can keep your club's members and officers in step with Rotary International, authorise ROW in My Rotary:"]}</p><ol>");
        foreach (var s in Steps) sb.Append($"<li>{Enc(L[s])}</li>");
        sb.Append($"</ol><p>{L["Rotary International sends authorisations to ROW once a day, so your club's live data appears within a day or two."]}</p>");
        if (ShowcaseUrl is { } url)
            sb.Append($"<p>{L["To publish projects to Rotary Showcase in one click, install the ROW Showcase extension: {0}", $"<a href=\"{Enc(url)}\">{Enc(url)}</a>"]}</p>");
        return sb.ToString();
    }

    [HttpGet("api/districts/{districtId:int}/onboarding-kit/clubs/{clubId:int}")]
    public async Task<IActionResult> Kit(int districtId, int clubId)
    {
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, Me, false, districtId))
            return StatusCode(403, new { message = "Only the district's managers open onboarding kits." });
        await using var c = new MySqlConnection(_cs);
        if (await ClubAsync(c, districtId, clubId) is not { } k) return NotFound(new { message = "Club not found in this district." });
        var html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>ROW onboarding kit</title>" +
                   "<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1b2430;background:#fbfaf7}</style>" +
                   $"</head><body><h1>Onboarding kit: {Enc(k.Club)}</h1>{Body(k.Club, k.District)}</body></html>";
        return Content(html, "text/html; charset=utf-8");
    }

    /// <summary>Emails the kit to the club's current president and secretary (designations mapped to those RI titles).</summary>
    [HttpPost("api/districts/{districtId:int}/onboarding-kit/clubs/{clubId:int}/nudge")]
    public async Task<IActionResult> Nudge(int districtId, int clubId)
    {
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, Me, false, districtId))
            return StatusCode(403, new { message = "Only the district's managers send onboarding nudges." });
        await using var c = new MySqlConnection(_cs);
        if (await ClubAsync(c, districtId, clubId) is not { } k) return NotFound(new { message = "Club not found in this district." });
        var to = (await c.QueryAsync<string>(@"
            SELECT DISTINCT m.EmailId FROM board_of_directors bd
            JOIN designation_master ds ON ds.pk_designation_id = bd.fk_designation_id AND ds.ri_title IN ('President', 'Secretary')
            JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id AND y.IsCurrent = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE bd.fk_club_id = @clubId AND bd.isdeleted = 0 AND IFNULL(m.EmailId, '') <> ''", new { clubId })).ToList();
        if (to.Count == 0) return Conflict(new { message = "This club has no current president or secretary with an email in ROW." });
        foreach (var address in to)
        {
            string subject, body;
            using (MessageCulture.Use(await MessageCulture.ForEmailAsync(c, address)))
                (subject, body) = (DbStringLocalizer.Instance["Set up ROW for {0}", k.Club], Body(k.Club, k.District));
            await _email.SendScopedEmailAsync(address, subject, body, clubId, null);
        }
        return Ok(new { sent = to.Count });
    }

    private static string Enc(string? s) => WebUtility.HtmlEncode(s ?? "");
}
