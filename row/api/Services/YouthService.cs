using System.Globalization;
using System.Net;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Youth programs (gap #12): RYLA and RLI participants per program year with their sponsoring club and status, and the
/// Youth Protection clearance register (training, background check, expiry) with expiry reminders.
/// Youth data is read and written only by appointees (youth_officers): the district youth chair (fk_club_id 0) for the
/// whole district, a club youth officer for that club. Admins appoint them but do not see the data unless appointed.
/// Who may call what: YouthController. Reminders: YouthReminderBackgroundService.
/// </summary>
public class YouthService
{
    private readonly string _cs;

    public YouthService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    private const string ActiveClub = "cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0";
    private const string ActiveMembership = "cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0";

    // ===== Access =====

    public async Task<bool> IsChairAsync(int memberId, int districtId)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM youth_officers WHERE fk_member_id = @memberId AND fk_district_id = @districtId AND fk_club_id = 0",
            new { memberId, districtId }) > 0;
    }

    public async Task<bool> IsClubOfficerAsync(int memberId, int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM youth_officers WHERE fk_member_id = @memberId AND fk_club_id = @clubId AND fk_club_id > 0",
            new { memberId, clubId }) > 0;
    }

    /// <summary>The district of an active club, or null.</summary>
    public async Task<int?> ClubDistrictAsync(int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteScalarAsync<int?>(
            $"SELECT cl.fk_district_id FROM club_master cl WHERE cl.pk_club_id = @clubId AND {ActiveClub}", new { clubId });
    }

    // ===== Reference data =====

    public async Task<IEnumerable<YouthYearDto>> YearsAsync()
    {
        await using var c = RowDb.Connect(_cs);
        return await c.QueryAsync<YouthYearDto>(@"
            SELECT pk_year_id AS Id, YearLabel AS Label, IsCurrent = 1 AS IsCurrent FROM rotary_year_master
            WHERE isdeleted = 0 AND StartDate <= CURDATE() + INTERVAL 1 YEAR ORDER BY StartDate DESC LIMIT 6");
    }

    /// <summary>Active members of the club (clubId &gt; 0) or of any club of the district, by name; for pickers.</summary>
    public async Task<IEnumerable<YouthMemberPickDto>> MembersAsync(int districtId, int clubId, string? q)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.QueryAsync<YouthMemberPickDto>($@"
            SELECT DISTINCT m.pk_member_master_profile_id AS Id, m.MemberName AS Name, cl.ClubName
            FROM club_members cm
            JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND {ActiveClub}
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE {ActiveMembership} AND {(clubId > 0 ? "cm.fk_club_id = @clubId" : "cl.fk_district_id = @districtId")}
              AND (@q = '' OR m.MemberName LIKE CONCAT('%', @q, '%'))
            ORDER BY m.MemberName LIMIT 50", new { districtId, clubId, q = (q ?? "").Trim() });
    }

    private static async Task<bool> IsMemberInScopeAsync(MySqlConnection c, int memberId, int districtId, int clubId) =>
        await c.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND {ActiveClub}
            WHERE cm.fk_member_master_profile_id = @memberId AND {ActiveMembership}
              AND {(clubId > 0 ? "cm.fk_club_id = @clubId" : "cl.fk_district_id = @districtId")}",
            new { memberId, districtId, clubId }) > 0;

    // ===== Appointments =====

    public async Task<IEnumerable<YouthOfficerDto>> OfficersAsync(int districtId, int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.QueryAsync<YouthOfficerDto>(@"
            SELECT o.fk_member_id AS MemberId, m.MemberName,
                   (SELECT cl.ClubName FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
                    WHERE cm.fk_member_master_profile_id = o.fk_member_id AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                      AND cl.fk_district_id = o.fk_district_id LIMIT 1) AS ClubName
            FROM youth_officers o JOIN member_master_profile m ON m.pk_member_master_profile_id = o.fk_member_id
            WHERE o.fk_district_id = @districtId AND o.fk_club_id = @clubId ORDER BY m.MemberName", new { districtId, clubId });
    }

    public async Task AddOfficerAsync(int districtId, int clubId, int memberId, int by)
    {
        await using var c = RowDb.Connect(_cs);
        if (!await IsMemberInScopeAsync(c, memberId, districtId, clubId))
            throw new InvalidOperationException(clubId > 0 ? "Choose an active member of this club." : "Choose an active member of a club in this district.");
        await c.ExecuteAsync(@"
            INSERT IGNORE INTO youth_officers (fk_district_id, fk_club_id, fk_member_id, created_by, created_date)
            VALUES (@districtId, @clubId, @memberId, @by, UTC_TIMESTAMP())", new { districtId, clubId, memberId, by });
    }

    public async Task<bool> RemoveOfficerAsync(int districtId, int clubId, int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteAsync(
            "DELETE FROM youth_officers WHERE fk_district_id = @districtId AND fk_club_id = @clubId AND fk_member_id = @memberId",
            new { districtId, clubId, memberId }) > 0;
    }

    // ===== Participants =====

    private const string ParticipantSelect = @"
        SELECT p.pk_participant_id AS Id, p.program AS Program, p.fk_year_id AS YearId, y.YearLabel, p.fk_sponsor_club_id AS SponsorClubId,
               cl.ClubName AS SponsorClubName, p.full_name AS FullName, p.contact_email AS ContactEmail, p.status AS Status,
               p.created_date AS CreatedDate
        FROM youth_participants p
        JOIN club_master cl ON cl.pk_club_id = p.fk_sponsor_club_id
        LEFT JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id";

    /// <summary>The district's participants (clubId 0) or one sponsoring club's, for a year and optionally one program.</summary>
    public async Task<IEnumerable<YouthParticipantDto>> ParticipantsAsync(int districtId, int clubId, int yearId, string? program)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.QueryAsync<YouthParticipantDto>(ParticipantSelect + $@"
            WHERE p.fk_district_id = @districtId AND p.fk_year_id = @yearId
              {(clubId > 0 ? "AND p.fk_sponsor_club_id = @clubId" : "")}
              {(string.IsNullOrEmpty(program) ? "" : "AND p.program = @program")}
            ORDER BY p.program, cl.ClubName, p.full_name", new { districtId, clubId, yearId, program });
    }

    private async Task<YouthParticipantDto?> ParticipantAsync(MySqlConnection c, int districtId, int clubId, int id) =>
        await c.QueryFirstOrDefaultAsync<YouthParticipantDto>(ParticipantSelect + $@"
            WHERE p.pk_participant_id = @id AND p.fk_district_id = @districtId {(clubId > 0 ? "AND p.fk_sponsor_club_id = @clubId" : "")}",
            new { id, districtId, clubId });

    private static async Task EnsureYearAsync(MySqlConnection c, int yearId)
    {
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @yearId AND isdeleted = 0", new { yearId }) == 0)
            throw new InvalidOperationException("Choose a program year.");
    }

    private static string? Email(string? e) => string.IsNullOrWhiteSpace(e) ? null : VolunteerService.CleanEmail(e);

    public async Task<YouthParticipantDto> CreateParticipantAsync(int districtId, int clubId, SaveYouthParticipantDto d, int by)
    {
        if (YouthRules.ParticipantError(d.Program, d.FullName, d.ContactEmail) is { } err) throw new InvalidOperationException(err);
        await using var c = RowDb.Connect(_cs);
        await EnsureYearAsync(c, d.YearId);
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO youth_participants (fk_district_id, program, fk_year_id, fk_sponsor_club_id, full_name, contact_email, status, created_by, created_date)
            VALUES (@districtId, @Program, @YearId, @clubId, @FullName, @ContactEmail, 'applied', @by, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { districtId, clubId, d.Program, d.YearId, FullName = d.FullName!.Trim(), ContactEmail = Email(d.ContactEmail), by });
        return (await ParticipantAsync(c, districtId, clubId, id))!;
    }

    /// <summary>Moves a participant to a new status when YouthRules.MayMove allows it. Null: not found in this scope.</summary>
    public async Task<YouthParticipantDto?> SetStatusAsync(int districtId, int clubId, int id, string? status, bool chair, int by)
    {
        await using var c = RowDb.Connect(_cs);
        if (await ParticipantAsync(c, districtId, clubId, id) is not { } p) return null;
        if (status == null || !YouthRules.MayMove(p.Status, status, chair))
            throw new InvalidOperationException($"A participant cannot move from {p.Status} to {status ?? "nothing"}.");
        // conditional on the status read above: two people deciding at once cannot both win
        if (await c.ExecuteAsync(@"
                UPDATE youth_participants SET status = @status, modified_by = @by, modified_date = UTC_TIMESTAMP()
                WHERE pk_participant_id = @id AND status = @from", new { id, status, from = p.Status, by }) == 0)
            throw new InvalidOperationException("Someone else changed this participant. Reload and try again.");
        return await ParticipantAsync(c, districtId, clubId, id);
    }

    // ===== Youth Protection clearances =====

    private sealed class ClearanceRow
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? ClubName { get; set; }
        public DateTime? TrainingDate { get; set; }
        public DateTime? CheckDate { get; set; }
        public DateTime? ExpiryDate { get; set; }
    }

    private static ClearanceDto ToDto(ClearanceRow r) => new()
    {
        MemberId = r.MemberId, MemberName = r.MemberName, ClubName = r.ClubName, TrainingDate = r.TrainingDate,
        CheckDate = r.CheckDate, ExpiryDate = r.ExpiryDate,
        State = YouthRules.ClearanceState(r.TrainingDate, r.CheckDate, r.ExpiryDate, DateTime.UtcNow),
    };

    /// <summary>Club scope: every active member of the club, with their record if any. District scope: the recorded volunteers.</summary>
    public async Task<IEnumerable<ClearanceDto>> ClearancesAsync(int districtId, int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = clubId > 0
            ? await c.QueryAsync<ClearanceRow>($@"
                SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, cl.ClubName,
                       y.training_date AS TrainingDate, y.check_date AS CheckDate, y.expiry_date AS ExpiryDate
                FROM club_members cm
                JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND {ActiveClub}
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND IFNULL(m.isdeleted, 0) = 0
                LEFT JOIN ypp_clearances y ON y.fk_member_id = m.pk_member_master_profile_id AND y.fk_district_id = @districtId
                WHERE cm.fk_club_id = @clubId AND {ActiveMembership}
                ORDER BY m.MemberName", new { districtId, clubId })
            : await c.QueryAsync<ClearanceRow>(@"
                SELECT y.fk_member_id AS MemberId, m.MemberName,
                       (SELECT cl.ClubName FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
                        WHERE cm.fk_member_master_profile_id = y.fk_member_id AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                          AND cl.fk_district_id = y.fk_district_id LIMIT 1) AS ClubName,
                       y.training_date AS TrainingDate, y.check_date AS CheckDate, y.expiry_date AS ExpiryDate
                FROM ypp_clearances y JOIN member_master_profile m ON m.pk_member_master_profile_id = y.fk_member_id
                WHERE y.fk_district_id = @districtId ORDER BY y.expiry_date IS NULL, y.expiry_date, m.MemberName", new { districtId });
        return rows.Select(ToDto);
    }

    /// <summary>Records a volunteer's clearance. The member must be active in the club (club scope) or the district.</summary>
    public async Task<ClearanceDto?> SaveClearanceAsync(int districtId, int clubId, int memberId, SaveClearanceDto d, int by)
    {
        if (YouthRules.ClearanceError(d.TrainingDate, d.CheckDate, d.ExpiryDate, DateTime.UtcNow) is { } err) throw new InvalidOperationException(err);
        await using var c = RowDb.Connect(_cs);
        if (!await IsMemberInScopeAsync(c, memberId, districtId, clubId)) return null;
        await c.ExecuteAsync(@"
            INSERT INTO ypp_clearances (fk_district_id, fk_member_id, training_date, check_date, expiry_date, modified_by, modified_date)
            VALUES (@districtId, @memberId, @t, @ch, @e, @by, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE training_date = VALUES(training_date), check_date = VALUES(check_date),
                expiry_date = VALUES(expiry_date), modified_by = VALUES(modified_by), modified_date = VALUES(modified_date)",
            new { districtId, memberId, t = d.TrainingDate?.Date, ch = d.CheckDate?.Date, e = d.ExpiryDate?.Date, by });
        return (await ClearancesAsync(districtId, clubId)).FirstOrDefault(x => x.MemberId == memberId);
    }

    // ===== The app =====

    public async Task<MyYouthDto> MyAsync(int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        var mine = await c.QueryAsync<ClearanceRow>(@"
            SELECT y.fk_member_id AS MemberId, m.MemberName, CONCAT('District ', d.DistrictNumber) AS ClubName,
                   y.training_date AS TrainingDate, y.check_date AS CheckDate, y.expiry_date AS ExpiryDate
            FROM ypp_clearances y JOIN member_master_profile m ON m.pk_member_master_profile_id = y.fk_member_id
            LEFT JOIN district_master d ON d.pk_district_id = y.fk_district_id
            WHERE y.fk_member_id = @memberId", new { memberId });
        var scopes = await c.QueryAsync<YouthScopeDto>(@"
            SELECT o.fk_district_id AS DistrictId, o.fk_club_id AS ClubId,
                   IF(o.fk_club_id = 0, CONCAT('District ', d.DistrictNumber), cl.ClubName) AS Name
            FROM youth_officers o
            LEFT JOIN district_master d ON d.pk_district_id = o.fk_district_id
            LEFT JOIN club_master cl ON cl.pk_club_id = o.fk_club_id
            WHERE o.fk_member_id = @memberId ORDER BY o.fk_club_id", new { memberId });
        return new MyYouthDto { Clearances = mine.Select(ToDto).ToList(), OfficerOf = scopes.ToList() };
    }

    // ===== Expiry reminders =====

    private sealed class DueReminder
    {
        public int Id { get; set; }
        public int DistrictId { get; set; }
        public string? Email { get; set; }
        public string? Name { get; set; }
        public DateTime ExpiryDate { get; set; }
    }

    /// <summary>Emails each volunteer whose clearance expires within 60 days, once per expiry date. The row is claimed
    /// before the send, so a crash loses one email instead of sending it twice. Returns how many were claimed.</summary>
    // shortcut: one reminder per expiry date and only to the volunteer; add a chair digest if districts ask.
    public async Task<int> SendExpiryRemindersAsync(IEmailService email, CancellationToken ct)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync(ct);
        var due = await c.QueryAsync<DueReminder>($@"
            SELECT y.pk_clearance_id AS Id, y.fk_district_id AS DistrictId, m.EmailId AS Email, m.MemberName AS Name, y.expiry_date AS ExpiryDate
            FROM ypp_clearances y JOIN member_master_profile m ON m.pk_member_master_profile_id = y.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE y.expiry_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL {YouthRules.ExpiringDays} DAY
              AND (y.reminder_sent_for IS NULL OR y.reminder_sent_for <> y.expiry_date)
            ORDER BY y.expiry_date LIMIT 200");
        var claimed = 0;
        foreach (var r in due)
        {
            if (await c.ExecuteAsync(@"UPDATE ypp_clearances SET reminder_sent_for = expiry_date
                    WHERE pk_clearance_id = @Id AND expiry_date = @ExpiryDate AND (reminder_sent_for IS NULL OR reminder_sent_for <> expiry_date)",
                    new { r.Id, r.ExpiryDate }) == 0) continue;
            claimed++;
            if (r.Email?.Trim() is not { Length: > 3 } to || !to.Contains('@')) continue;
            var when = r.ExpiryDate.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
            var html = $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">
<p>Dear {WebUtility.HtmlEncode(r.Name ?? "")},</p>
<p>Your Youth Protection clearance expires on <strong>{when}</strong>. Please renew your training and background check
before then so you can keep volunteering with young people. Your district youth chair or club youth officer records the new dates.</p>
<p style=""color:#64748b;font-size:12px"">This is an automated message from {WebUtility.HtmlEncode(Brand.ProductName)}.</p></div>";
            // a failed send stays claimed (email_log records it) and must not stop the others
            try { await email.SendScopedEmailAsync(to, $"Your Youth Protection clearance expires on {when}", html, null, r.DistrictId); }
            catch (Exception ex) when (ex is not OperationCanceledException) { }
        }
        return claimed;
    }
}
