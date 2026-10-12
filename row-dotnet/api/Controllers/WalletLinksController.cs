using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// SuperAdmin › Wallet › District Wallet: per-district credit balances + copy pay-links.
// Club-side links are minted by ClubWebsitesController's pricing endpoint.
[ApiController]
[Route("api/admin/wallet")]
[Authorize]
public class WalletLinksController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly string _conn;
    private readonly ICreditManagementService _credit;
    private readonly IWalletReportService _reports;

    public WalletLinksController(IConfiguration config, ICreditManagementService credit, IWalletReportService reports)
    {
        _config = config;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _credit = credit;
        _reports = reports;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    // Current-year board contact (name/mobile/email) per club for a designation. Same shape as
    // ClubWebsitesController's pricing/reminder joins.
    private static string BoardContactSql(string designation) => $@"
        SELECT b.fk_club_id AS clubId, MAX(m.MemberName) AS name,
               MAX(m.PrimaryMobileNumber) AS mobile, MAX(m.EmailId) AS email
        FROM board_of_directors b
        JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
        JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
        WHERE dm.designation_name = '{designation}' AND b.isdeleted = 0
          AND b.fk_year_id = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1)
        GROUP BY b.fk_club_id";
    private string Frontend() => (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
    private string Link(string purpose, int districtId) =>
        $"{Frontend()}/pay/w/{WalletPayLinkToken.Generate(_config, "district", purpose, districtId)}";

    // Per-district WhatsApp/Email balances + copy links + the 2 common (pick-a-district) links.
    [HttpGet("districts")]
    public async Task<ActionResult> GetDistricts([FromQuery] string? search)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        var p = new DynamicParameters();
        var where = "WHERE IsActive = 1 AND isdeleted = 0";
        if (!string.IsNullOrWhiteSpace(search)) { where += " AND DistrictNumber LIKE @S"; p.Add("S", $"%{search}%"); }
        var districts = (await conn.QueryAsync<dynamic>(
            $"SELECT pk_district_id AS id, DistrictNumber AS number FROM district_master {where} ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber", p)).ToList();

        var items = new List<object>();
        foreach (var d in districts)
        {
            int id = (int)d.id;
            var bal = await _credit.GetDistrictCreditBalanceAsync(id);
            items.Add(new
            {
                districtId = id,
                districtNumber = (string?)d.number,
                whatsappBalance = bal.WhatsAppRemaining,
                emailBalance = bal.EmailRemaining,
                whatsappPayLink = Link("whatsapp", id),
                emailPayLink = Link("email", id),
            });
        }
        var commonLinks = new
        {
            whatsapp = $"{Frontend()}/pay/w/{WalletPayLinkToken.Generate(_config, "district", "whatsapp", 0)}",
            email = $"{Frontend()}/pay/w/{WalletPayLinkToken.Generate(_config, "district", "email", 0)}",
        };
        return Ok(new { items, commonLinks });
    }

    // Every club that has a live (non-expired) WhatsApp OR Email credit balance > 0, with its
    // current-year President + Secretary contacts — for the "Check balance" popup + CSV export.
    [HttpGet("club-balances")]
    public async Task<ActionResult> GetClubBalances()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        var sql = $@"
            SELECT b.clubId, b.clubName, b.districtNumber, b.whatsappBalance, b.emailBalance,
                   pres.name AS presidentName, pres.mobile AS presidentMobile, pres.email AS presidentEmail,
                   sec.name  AS secretaryName, sec.mobile  AS secretaryMobile, sec.email  AS secretaryEmail
            FROM (
                SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       SUM(CASE WHEN cc.CreditType = 'WhatsApp' THEN cc.CreditCount - cc.UsedCount ELSE 0 END) AS whatsappBalance,
                       SUM(CASE WHEN cc.CreditType = 'Email'    THEN cc.CreditCount - cc.UsedCount ELSE 0 END) AS emailBalance
                FROM club_credits cc
                JOIN club_master c ON c.pk_club_id = cc.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE cc.fk_club_id > 0 AND cc.IsActive = 1 AND cc.isdeleted = 0 AND NOW() <= cc.ToDate
                GROUP BY c.pk_club_id, c.ClubName, d.DistrictNumber
                HAVING (whatsappBalance > 0 OR emailBalance > 0)   -- OR: at least one credit type has balance
            ) b
            LEFT JOIN ({BoardContactSql("Club President")}) pres ON pres.clubId = b.clubId
            LEFT JOIN ({BoardContactSql("Club Secretary")}) sec  ON sec.clubId  = b.clubId
            ORDER BY b.clubName";

        var items = (await conn.QueryAsync<dynamic>(sql)).Select(r => new
        {
            clubId = (int)r.clubId,
            clubName = (string?)r.clubName,
            districtNumber = (string?)r.districtNumber,
            whatsappBalance = Convert.ToInt32(r.whatsappBalance ?? 0),
            emailBalance = Convert.ToInt32(r.emailBalance ?? 0),
            presidentName = (string?)r.presidentName, presidentMobile = (string?)r.presidentMobile, presidentEmail = (string?)r.presidentEmail,
            secretaryName = (string?)r.secretaryName, secretaryMobile = (string?)r.secretaryMobile, secretaryEmail = (string?)r.secretaryEmail,
        }).ToList();
        return Ok(items);
    }

    // ── Combined credit list (Wallet page): Offline (Super Admin) + Online (self-purchase) ──
    [HttpGet("credit-entries")]
    public async Task<ActionResult> CreditEntries([FromQuery] int? districtId, [FromQuery] int? clubId,
        [FromQuery] string? creditType, [FromQuery] string? source, [FromQuery] DateTime? dateFrom,
        [FromQuery] DateTime? dateTo, [FromQuery] string? search)
    {
        if (!IsSuperAdmin()) return Forbid();
        var rows = await _reports.GetCreditEntriesAsync(new WalletCreditEntryFilters
        {
            DistrictId = districtId > 0 ? districtId : null,
            ClubId = clubId >= 0 && districtId > 0 ? clubId : null,
            CreditType = creditType, Source = source, DateFrom = dateFrom, DateTo = dateTo, Search = search,
        });
        return Ok(rows);
    }

    // ── Purchase-history reports (Wallet › Reports tab) ──────────────────
    [HttpGet("reports/club-website")]
    public Task<ActionResult> ReportClubWebsite([FromQuery] DateTime? dateFrom, [FromQuery] DateTime? dateTo,
        [FromQuery] int? districtId, [FromQuery] string? search)
        => RunReport(WalletReportType.ClubWebsite, dateFrom, dateTo, districtId, search);

    [HttpGet("reports/whatsapp")]
    public Task<ActionResult> ReportClubWhatsApp([FromQuery] DateTime? dateFrom, [FromQuery] DateTime? dateTo,
        [FromQuery] int? districtId, [FromQuery] string? search)
        => RunReport(WalletReportType.ClubWhatsApp, dateFrom, dateTo, districtId, search);

    [HttpGet("reports/email")]
    public Task<ActionResult> ReportClubEmail([FromQuery] DateTime? dateFrom, [FromQuery] DateTime? dateTo,
        [FromQuery] int? districtId, [FromQuery] string? search)
        => RunReport(WalletReportType.ClubEmail, dateFrom, dateTo, districtId, search);

    [HttpGet("reports/district-whatsapp")]
    public Task<ActionResult> ReportDistrictWhatsApp([FromQuery] DateTime? dateFrom, [FromQuery] DateTime? dateTo,
        [FromQuery] int? districtId, [FromQuery] string? search)
        => RunReport(WalletReportType.DistrictWhatsApp, dateFrom, dateTo, districtId, search);

    [HttpGet("reports/district-email")]
    public Task<ActionResult> ReportDistrictEmail([FromQuery] DateTime? dateFrom, [FromQuery] DateTime? dateTo,
        [FromQuery] int? districtId, [FromQuery] string? search)
        => RunReport(WalletReportType.DistrictEmail, dateFrom, dateTo, districtId, search);

    private async Task<ActionResult> RunReport(WalletReportType type, DateTime? dateFrom, DateTime? dateTo, int? districtId, string? search)
    {
        if (!IsSuperAdmin()) return Forbid();
        // At least one narrowing filter required — mirrors the existing "Check balance" UX rule,
        // avoids an accidental full-table dump.
        if (dateFrom == null && dateTo == null && districtId == null && string.IsNullOrWhiteSpace(search))
            return BadRequest(new { message = "Choose a date range or district to narrow the report." });

        var rows = await _reports.GetReportAsync(type, new WalletReportFilters
        {
            DateFrom = dateFrom, DateTo = dateTo, DistrictId = districtId, Search = search,
        });
        return Ok(rows);
    }
}
