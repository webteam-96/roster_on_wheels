using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Purchase-history reports for the Wallet module (SuperAdmin only, surfaced via
// WalletLinksController). Two underlying shapes: Club Website (club_website_orders) and
// WhatsApp/Email credits (wallet_topup_orders, club or district scope) — these are separate
// order ledgers, not one unified table (see plan notes). Settlement columns come from
// razorpay_settlements, populated by RazorpaySettlementSyncBackgroundService; rows without a
// matched settlement yet (T+2/T+3 typical) simply show null/"Pending", which is expected.
public class WalletReportService : IWalletReportService
{
    private readonly string _conn;

    public WalletReportService(IConfiguration config)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection NewConn() => new(_conn);

    // Derived-table board-contact lookup correlated by (club, year) — unlike
    // WalletLinksController.BoardContactSql (which is hardcoded to IsCurrent=1 for a live-balance
    // view), reports need the officer who held the role in the Rotary year the ORDER fell in, so
    // this joins on a resolved fk_year_id per row instead. MAX() collapses to one row per
    // (club, year) the same way BoardContactSql does, guarding against duplicate BOD rows.
    private static string BoardContactByYearSql(string designation) => $@"
        SELECT b.fk_club_id AS clubId, b.fk_year_id AS yearId,
               MAX(m.MemberName) AS name, MAX(m.PrimaryMobileNumber) AS mobile, MAX(m.EmailId) AS email
        FROM board_of_directors b
        JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
        JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
        WHERE dm.designation_name = '{designation}' AND b.isdeleted = 0
        GROUP BY b.fk_club_id, b.fk_year_id";

    public async Task<List<WalletReportRow>> GetReportAsync(WalletReportType type, WalletReportFilters filters)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();

        var p = new DynamicParameters();
        p.Add("DateFrom", filters.DateFrom);
        // Exclusive upper bound so a "to" date picked in the UI includes that whole day.
        p.Add("DateToExclusive", filters.DateTo?.Date.AddDays(1));
        p.Add("DistrictId", filters.DistrictId);
        p.Add("SearchLike", string.IsNullOrWhiteSpace(filters.Search) ? null : $"%{filters.Search.Trim()}%");

        var sql = type switch
        {
            WalletReportType.ClubWebsite => ClubWebsiteSql(),
            WalletReportType.ClubWhatsApp => CreditSql(district: false, "WhatsApp", p),
            WalletReportType.ClubEmail => CreditSql(district: false, "Email", p),
            WalletReportType.DistrictWhatsApp => CreditSql(district: true, "WhatsApp", p),
            WalletReportType.DistrictEmail => CreditSql(district: true, "Email", p),
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };

        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return rows.Select(r => new WalletReportRow
        {
            DistrictNumber = r.DistrictNumber == null ? null : Convert.ToString(r.DistrictNumber),
            ClubName = (string?)r.ClubName ?? "",
            PurchaseDate = (DateTime)r.PurchaseDate,
            PurchaseAmount = (decimal)r.PurchaseAmount,
            CreditsPurchased = r.CreditsPurchased == null ? null : (int?)Convert.ToInt32(r.CreditsPurchased),
            SettlementAmount = r.SettlementAmount == null ? null : (decimal?)Convert.ToDecimal(r.SettlementAmount),
            SettlementDate = r.SettlementDate == null ? null : (DateTime?)r.SettlementDate,
            RazorpayTransactionId = (string?)r.RazorpayTransactionId,
            PresidentName = (string?)r.PresidentName,
            PresidentMobile = (string?)r.PresidentMobile,
            PresidentEmail = (string?)r.PresidentEmail,
            SecretaryName = (string?)r.SecretaryName,
            SecretaryMobile = (string?)r.SecretaryMobile,
            SecretaryEmail = (string?)r.SecretaryEmail,
            SettlesInAccount = (string?)r.SettlesInAccount ?? "",
            StartDate = r.StartDate == null ? null : (DateTime?)r.StartDate,
            EndDate = r.EndDate == null ? null : (DateTime?)r.EndDate,
        }).ToList();
    }

    private string ClubWebsiteSql()
    {
        var pres = BoardContactByYearSql("Club President");
        var sec = BoardContactByYearSql("Club Secretary");
        return $@"
            SELECT
                dm.DistrictNumber AS DistrictNumber,
                c.ClubName AS ClubName,
                o.created_date AS PurchaseDate,
                o.TotalAmount AS PurchaseAmount,
                NULL AS CreditsPurchased,
                rs.SettlementAmount AS SettlementAmount,
                rs.SettlementDate AS SettlementDate,
                o.RazorpayPaymentId AS RazorpayTransactionId,
                pres.name AS PresidentName, pres.mobile AS PresidentMobile, pres.email AS PresidentEmail,
                sec.name  AS SecretaryName, sec.mobile  AS SecretaryMobile, sec.email  AS SecretaryEmail,
                CASE WHEN COALESCE(o.GatewayType, cwp.GatewayType, 'normal') = 'route'
                     THEN CONCAT('Route — ', COALESCE(ra.BankAccountLast4, ra.Name, 'unresolved'))
                     ELSE 'Normal — 2321' END AS SettlesInAccount,
                COALESCE(o.StartDate, cw.StartDate) AS StartDate,
                COALESCE(o.EndDate, cw.EndDate) AS EndDate
            FROM club_website_orders o
            JOIN club_master c ON c.pk_club_id = o.fk_club_id
            LEFT JOIN district_master dm ON dm.pk_district_id = o.fk_district_id
            LEFT JOIN club_websites cw ON cw.pk_id = o.fk_website_id
            LEFT JOIN razorpay_settlements rs ON rs.RazorpayPaymentId = o.RazorpayPaymentId
            LEFT JOIN rotary_year_master y ON o.created_date BETWEEN y.StartDate AND y.EndDate AND y.isdeleted = 0
            LEFT JOIN club_website_pricing cwp ON cwp.fk_club_id = o.fk_club_id AND cwp.fk_year_id = y.pk_year_id
            LEFT JOIN razorpay_route_accounts ra ON ra.pk_id = COALESCE(o.fk_route_account_id, cwp.fk_route_account_id)
            LEFT JOIN ({pres}) pres ON pres.clubId = o.fk_club_id AND pres.yearId = y.pk_year_id
            LEFT JOIN ({sec}) sec ON sec.clubId = o.fk_club_id AND sec.yearId = y.pk_year_id
            WHERE o.PaymentStatus = 'PAID' AND o.isdeleted = 0
              AND (@DateFrom IS NULL OR o.created_date >= @DateFrom)
              AND (@DateToExclusive IS NULL OR o.created_date < @DateToExclusive)
              AND (@DistrictId IS NULL OR o.fk_district_id = @DistrictId)
              AND (@SearchLike IS NULL OR c.ClubName LIKE @SearchLike)
            ORDER BY o.created_date DESC";
    }

    private string CreditSql(bool district, string creditType, DynamicParameters p)
    {
        p.Add("CreditType", creditType);

        if (!district)
        {
            var pres = BoardContactByYearSql("Club President");
            var sec = BoardContactByYearSql("Club Secretary");
            return $@"
                SELECT
                    dm.DistrictNumber AS DistrictNumber,
                    c.ClubName AS ClubName,
                    o.created_date AS PurchaseDate,
                    o.TotalAmount AS PurchaseAmount,
                    o.CreditCount AS CreditsPurchased,
                    rs.SettlementAmount AS SettlementAmount,
                    rs.SettlementDate AS SettlementDate,
                    o.RazorpayPaymentId AS RazorpayTransactionId,
                    pres.name AS PresidentName, pres.mobile AS PresidentMobile, pres.email AS PresidentEmail,
                    sec.name  AS SecretaryName, sec.mobile  AS SecretaryMobile, sec.email  AS SecretaryEmail,
                    'Normal — 2321' AS SettlesInAccount,
                    COALESCE(o.FromDate, cc.FromDate) AS StartDate,
                    COALESCE(o.ToDate, cc.ToDate) AS EndDate
                FROM wallet_topup_orders o
                JOIN club_master c ON c.pk_club_id = o.fk_club_id
                LEFT JOIN district_master dm ON dm.pk_district_id = o.fk_district_id
                LEFT JOIN club_credits cc ON cc.pk_credit_id = o.fk_credit_id
                LEFT JOIN razorpay_settlements rs ON rs.RazorpayPaymentId = o.RazorpayPaymentId
                LEFT JOIN rotary_year_master y ON o.created_date BETWEEN y.StartDate AND y.EndDate AND y.isdeleted = 0
                LEFT JOIN ({pres}) pres ON pres.clubId = o.fk_club_id AND pres.yearId = y.pk_year_id
                LEFT JOIN ({sec}) sec ON sec.clubId = o.fk_club_id AND sec.yearId = y.pk_year_id
                WHERE o.ScopeType = 'club' AND o.CreditType = @CreditType
                  AND o.PaymentStatus = 'PAID' AND o.isdeleted = 0
                  AND (@DateFrom IS NULL OR o.created_date >= @DateFrom)
                  AND (@DateToExclusive IS NULL OR o.created_date < @DateToExclusive)
                  AND (@DistrictId IS NULL OR o.fk_district_id = @DistrictId)
                  AND (@SearchLike IS NULL OR c.ClubName LIKE @SearchLike)
                ORDER BY o.created_date DESC";
        }

        // District scope: no "District Secretary" role exists anywhere in this codebase — only
        // district_governors. Secretary columns are left NULL (not omitted) so the report's
        // column set stays uniform across all 5 report types.
        return @"
            SELECT
                d.DistrictNumber AS DistrictNumber,
                CONCAT('RI District ', d.DistrictNumber) AS ClubName,
                o.created_date AS PurchaseDate,
                o.TotalAmount AS PurchaseAmount,
                o.CreditCount AS CreditsPurchased,
                rs.SettlementAmount AS SettlementAmount,
                rs.SettlementDate AS SettlementDate,
                o.RazorpayPaymentId AS RazorpayTransactionId,
                -- A DG who is not a member of any club has no profile to read; their name and
                -- contacts are stored on the district_governors row itself.
                COALESCE(dgM.MemberName, dg.member_name) AS PresidentName,
                COALESCE(dgM.PrimaryMobileNumber, dg.mobile_number) AS PresidentMobile,
                COALESCE(dgM.EmailId, dg.email) AS PresidentEmail,
                NULL AS SecretaryName, NULL AS SecretaryMobile, NULL AS SecretaryEmail,
                'Normal — 2321' AS SettlesInAccount,
                COALESCE(o.FromDate, cc.FromDate) AS StartDate,
                COALESCE(o.ToDate, cc.ToDate) AS EndDate
            FROM wallet_topup_orders o
            JOIN district_master d ON d.pk_district_id = o.fk_district_id
            LEFT JOIN club_credits cc ON cc.pk_credit_id = o.fk_credit_id
            LEFT JOIN razorpay_settlements rs ON rs.RazorpayPaymentId = o.RazorpayPaymentId
            LEFT JOIN rotary_year_master y ON o.created_date BETWEEN y.StartDate AND y.EndDate AND y.isdeleted = 0
            LEFT JOIN district_governors dg ON dg.fk_district_id = o.fk_district_id AND dg.fk_year_id = y.pk_year_id AND dg.isdeleted = 0
            LEFT JOIN member_master_profile dgM ON dgM.pk_member_master_profile_id = dg.fk_member_id AND dgM.isdeleted = 0
            WHERE o.ScopeType = 'district' AND o.fk_club_id = 0 AND o.CreditType = @CreditType
              AND o.PaymentStatus = 'PAID' AND o.isdeleted = 0
              AND (@DateFrom IS NULL OR o.created_date >= @DateFrom)
              AND (@DateToExclusive IS NULL OR o.created_date < @DateToExclusive)
              AND (@DistrictId IS NULL OR o.fk_district_id = @DistrictId)
              AND (@SearchLike IS NULL OR d.DistrictNumber LIKE @SearchLike)
            ORDER BY o.created_date DESC";
    }

    // ── Combined credit list (Settings › Wallet) ─────────────────────────
    // Offline = club_credit_offline_log (every Super Admin Add / count Edit, plus earlier entries
    // backfilled by SQL/club_credit_offline_log.sql). Online = every PAID wallet_topup_orders row.
    // Both link to the club_credits pack so the pack's current status can be shown.
    private const string PackStatusSql = @"
        CASE WHEN cc.pk_credit_id IS NULL THEN NULL
             WHEN cc.isdeleted = 1 THEN 'Deleted'
             WHEN cc.IsActive = 0 OR NOW() > cc.ToDate THEN 'Expired'
             ELSE 'Active' END";

    public async Task<List<WalletCreditEntryRow>> GetCreditEntriesAsync(WalletCreditEntryFilters f)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();

        var sql = $@"
            SELECT x.*, d.DistrictNumber,
                   CASE WHEN x.ClubId = 0 THEN 'District level' ELSE c.ClubName END AS ClubName,
                   m.MemberName AS ByName
            FROM (
                SELECT 'Offline' AS Source, l.EntryType, l.created_date AS EntryDate,
                       l.fk_district_id AS DistrictId, l.fk_club_id AS ClubId, l.CreditType,
                       l.CreditCount AS Credits, l.CountBefore, l.CountAfter,
                       CAST(NULL AS DECIMAL(12,2)) AS Amount,
                       l.TransactionId, l.PaymentDate,
                       CASE
                           WHEN l.ProofDocumentPath IS NULL OR l.ProofDocumentPath = '' THEN NULL
                           WHEN l.ProofDocumentPath LIKE '/%' THEN l.ProofDocumentPath
                           ELSE CONCAT('/Documents/CreditProofs/', l.ProofDocumentPath)
                       END AS ProofDocumentPath,
                       COALESCE(l.ToDate, cc.ToDate) AS ExpiryDate,
                       l.created_by AS ByUserId, {PackStatusSql} AS PackStatus, l.Note
                FROM club_credit_offline_log l
                LEFT JOIN club_credits cc ON cc.pk_credit_id = l.fk_credit_id

                UNION ALL

                SELECT 'Online', 'Purchased', COALESCE(o.CreditedDate, o.created_date),
                       o.fk_district_id, o.fk_club_id, o.CreditType,
                       o.CreditCount, NULL, NULL,
                       o.TotalAmount,
                       o.RazorpayPaymentId, DATE(COALESCE(o.CreditedDate, o.created_date)),
                       NULL,
                       COALESCE(o.ToDate, cc.ToDate),
                       o.created_by, {PackStatusSql}, NULL
                FROM wallet_topup_orders o
                LEFT JOIN club_credits cc ON cc.pk_credit_id = o.fk_credit_id
                WHERE o.PaymentStatus = 'PAID' AND o.isdeleted = 0
            ) x
            LEFT JOIN district_master d ON d.pk_district_id = x.DistrictId
            LEFT JOIN club_master c ON c.pk_club_id = x.ClubId AND x.ClubId > 0
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = x.ByUserId AND x.ByUserId > 0
            WHERE (@DistrictId IS NULL OR x.DistrictId = @DistrictId)
              AND (@ClubId IS NULL OR x.ClubId = @ClubId)
              AND (@CreditType IS NULL OR x.CreditType = @CreditType)
              AND (@Source IS NULL OR x.Source = @Source)
              AND (@DateFrom IS NULL OR x.EntryDate >= @DateFrom)
              AND (@DateToExclusive IS NULL OR x.EntryDate < @DateToExclusive)
              AND (@SearchLike IS NULL OR c.ClubName LIKE @SearchLike OR d.DistrictNumber LIKE @SearchLike
                   OR x.TransactionId LIKE @SearchLike)
            ORDER BY x.EntryDate DESC";

        var rows = await conn.QueryAsync<WalletCreditEntryRow>(sql, new
        {
            f.DistrictId,
            f.ClubId,
            CreditType = string.IsNullOrWhiteSpace(f.CreditType) ? null : f.CreditType,
            Source = string.IsNullOrWhiteSpace(f.Source) ? null : f.Source,
            f.DateFrom,
            DateToExclusive = f.DateTo?.Date.AddDays(1),
            SearchLike = string.IsNullOrWhiteSpace(f.Search) ? null : $"%{f.Search.Trim()}%",
        }, commandTimeout: 120);
        return rows.ToList();
    }
}
