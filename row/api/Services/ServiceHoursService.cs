using System.Security.Cryptography;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Service hours and contributions. Members log their own hours against a club project of the Rotary year of the
/// service date (or "other service") from the app, with an optional photo; the club's managers approve or reject.
/// Club managers record cash and in-kind contributions per project. Reports per Rotary year count approved logged
/// hours plus the hours recorded on volunteer sign-up sheets (VolunteerService), so nothing is typed twice; they
/// never write into the project's man_hours (volunteer sheets already roll their own hours in there).
/// Who may call what: ServiceHoursController. Rules and the report roll-up: ServiceHoursReport.
/// </summary>
// shortcut: district managers see totals per club, not single entries; add a district entry list if districts ask.
public class ServiceHoursService
{
    private static readonly string[] PhotoTypes = { ".jpg", ".jpeg", ".png", ".webp" };
    private readonly string _cs;
    private readonly string _webRoot;
    private readonly IYearTableResolver _years;

    public ServiceHoursService(IConfiguration config, IWebHostEnvironment env, IYearTableResolver years)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        _years = years;
    }

    private const string EntrySelect = @"
        SELECT s.pk_service_hours_id AS Id, 'logged' AS Source, s.fk_member_id AS MemberId, COALESCE(m.MemberName, '') AS MemberName,
               s.fk_club_id AS ClubId, COALESCE(cl.ClubName, '') AS ClubName, s.fk_year_id AS YearId, s.fk_project_id AS ProjectId,
               s.other_service AS OtherService, s.service_date AS ServiceDate, s.hours AS Hours, s.note AS Note,
               s.photo_path AS PhotoPath, s.status AS Status, s.review_note AS ReviewNote, s.reviewed_at AS ReviewedAt,
               s.created_at AS CreatedAt
        FROM service_hours s
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = s.fk_member_id
        LEFT JOIN club_master cl ON cl.pk_club_id = s.fk_club_id";

    private static Task<(int Id, string Label)?> YearOfAsync(MySqlConnection c, DateTime date) =>
        c.QueryFirstOrDefaultAsync<(int Id, string Label)?>(@"
            SELECT pk_year_id, YearLabel FROM rotary_year_master
            WHERE @date BETWEEN StartDate AND EndDate AND IFNULL(isdeleted, 0) = 0 ORDER BY StartDate DESC LIMIT 1", new { date = date.Date });

    private async Task<string?> ProjectTableAsync(MySqlConnection c, int yearId) =>
        (await _years.ResolveExistingByYearIdAsync(c, yearId))?.ProjectsTable;

    /// <summary>The club's live projects of a year; ids: only these.</summary>
    private async Task<List<ServiceProjectOptionDto>> ProjectsAsync(MySqlConnection c, int clubId, int yearId, IEnumerable<int>? ids = null)
    {
        var table = await ProjectTableAsync(c, yearId);
        if (table == null) return new();
        var idList = ids?.Distinct().ToList();
        if (idList is { Count: 0 }) return new();
        // shortcut: the newest 500 projects of the year, add a search if a club records more.
        return (await c.QueryAsync<ServiceProjectOptionDto>($@"
            SELECT pk_project_id AS Id, title AS Title, project_date AS Date, Currency FROM `{table}`
            WHERE fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0 {(idList != null ? "AND pk_project_id IN @idList" : "")}
            ORDER BY project_date DESC, pk_project_id DESC LIMIT 500", new { clubId, idList })).ToList();
    }

    private async Task FillProjectTitlesAsync(MySqlConnection c, List<ServiceHoursEntryDto> entries)
    {
        foreach (var g in entries.Where(e => e.ProjectId != null).GroupBy(e => (e.ClubId, e.YearId)))
        {
            var titles = (await ProjectsAsync(c, g.Key.ClubId, g.Key.YearId, g.Select(e => e.ProjectId!.Value))).ToDictionary(p => p.Id, p => p.Title);
            foreach (var e in g) e.ProjectTitle = titles.GetValueOrDefault(e.ProjectId!.Value);
        }
    }

    public async Task<List<ServiceYearOptionDto>> YearsAsync(MySqlConnection c) =>
        (await c.QueryAsync<ServiceYearOptionDto>(@"
            SELECT pk_year_id AS Id, YearLabel AS Label FROM rotary_year_master
            WHERE StartDate <= UTC_DATE() AND IFNULL(isdeleted, 0) = 0 ORDER BY StartDate DESC LIMIT 10")).ToList();

    // ===== Members (the app) =====

    public async Task<bool> IsActiveMemberAsync(int memberId, int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.fk_club_id = @clubId AND cm.IsActive = 1
              AND IFNULL(cm.isdeleted, 0) = 0 AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0", new { memberId, clubId }) > 0;
    }

    /// <summary>The member's clubs, each with its projects of the Rotary year of date.</summary>
    public async Task<List<ServiceHoursClubOptionDto>> OptionsAsync(int memberId, DateTime date)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var clubs = (await c.QueryAsync<ServiceHoursClubOptionDto>(@"
            SELECT DISTINCT cl.pk_club_id AS ClubId, cl.ClubName FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
              AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0 ORDER BY cl.ClubName", new { memberId })).ToList();
        var year = await YearOfAsync(c, date);
        foreach (var club in clubs)
        {
            club.YearId = year?.Id;
            if (year != null) club.Projects = await ProjectsAsync(c, club.ClubId, year.Value.Id);
        }
        return clubs;
    }

    /// <summary>The member's logged entries and the hours recorded for them on volunteer sheets, newest first, with
    /// totals per Rotary year.</summary>
    public async Task<MyServiceHoursDto> MineAsync(int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        // shortcut: the newest 500 of each source, add paging if a member logs more.
        var entries = (await c.QueryAsync<ServiceHoursEntryDto>(EntrySelect +
            " WHERE s.fk_member_id = @memberId ORDER BY s.service_date DESC, s.pk_service_hours_id DESC LIMIT 500", new { memberId })).ToList();
        entries.AddRange(await c.QueryAsync<ServiceHoursEntryDto>(@"
            SELECT su.pk_signup_id AS Id, 'volunteer' AS Source, su.fk_member_id AS MemberId, '' AS MemberName,
                   sh.fk_club_id AS ClubId, COALESCE(cl.ClubName, '') AS ClubName, COALESCE(sh.fk_year_id, y.pk_year_id, 0) AS YearId,
                   sh.fk_project_id AS ProjectId, sh.title AS OtherService, DATE(sl.starts_at) AS ServiceDate, su.hours AS Hours,
                   sl.task AS Note, 'approved' AS Status, su.created_date AS CreatedAt
            FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
            JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
            LEFT JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id
            LEFT JOIN rotary_year_master y ON sl.starts_at >= y.StartDate AND sl.starts_at < y.EndDate + INTERVAL 1 DAY AND IFNULL(y.isdeleted, 0) = 0
            WHERE su.fk_member_id = @memberId AND su.hours > 0
            ORDER BY sl.starts_at DESC LIMIT 500", new { memberId }));
        entries = entries.OrderByDescending(e => e.ServiceDate).ThenByDescending(e => e.CreatedAt).ToList();
        await FillProjectTitlesAsync(c, entries);
        var labels = (await c.QueryAsync<(int Id, string Label)>("SELECT pk_year_id, YearLabel FROM rotary_year_master"))
            .ToDictionary(x => x.Id, x => x.Label);
        return new MyServiceHoursDto
        {
            Entries = entries,
            Years = entries.Where(e => e.YearId > 0).GroupBy(e => e.YearId).Select(g => new ServiceYearTotalDto
            {
                YearId = g.Key,
                YearLabel = labels.GetValueOrDefault(g.Key) ?? "",
                ApprovedHours = g.Where(e => e.Source == "logged" && e.Status == "approved").Sum(e => e.Hours),
                PendingHours = g.Where(e => e.Source == "logged" && e.Status == "pending").Sum(e => e.Hours),
                VolunteerHours = g.Where(e => e.Source == "volunteer").Sum(e => e.Hours),
            }).OrderByDescending(y => y.YearLabel, StringComparer.Ordinal).ToList(),
        };
    }

    /// <summary>Logs a member's hours (pending until a club manager approves). The caller has checked the member
    /// belongs to the club.</summary>
    public async Task<ServiceHoursEntryDto> LogAsync(int memberId, SaveServiceHoursDto input)
    {
        var d = ServiceHoursReport.Validate(input, DateTime.UtcNow);
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var year = await YearOfAsync(c, d.ServiceDate) ?? throw new InvalidOperationException("The service date is not in a Rotary year.");
        if (d.ProjectId is { } projectId && (await ProjectsAsync(c, d.ClubId, year.Id, new[] { projectId })).Count == 0)
            throw new InvalidOperationException("That project is not one of the club's projects for the Rotary year of the service date.");
        await using var tx = await c.BeginTransactionAsync();
        // the member's row lock keeps two entries sent at once from passing the day limit together
        await c.ExecuteAsync("SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @memberId FOR UPDATE",
            new { memberId }, tx);
        var day = await c.ExecuteScalarAsync<decimal>(@"
            SELECT COALESCE(SUM(hours), 0) FROM service_hours
            WHERE fk_member_id = @memberId AND service_date = @date AND status <> 'rejected'", new { memberId, date = d.ServiceDate }, tx);
        if (day + d.Hours > ServiceHoursReport.MaxHoursPerDay)
            throw new InvalidOperationException($"You already have {day:0.##} hours on that day; a day has 24 at most.");
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO service_hours (fk_member_id, fk_club_id, fk_year_id, fk_project_id, other_service, service_date, hours, note, status, created_at)
            VALUES (@memberId, @ClubId, @yearId, @ProjectId, @OtherService, @ServiceDate, @Hours, @Note, 'pending', UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();", new { memberId, d.ClubId, yearId = year.Id, d.ProjectId, d.OtherService, d.ServiceDate, d.Hours, d.Note }, tx);
        await tx.CommitAsync();
        return (await GetAsync(c, id))!;
    }

    private async Task<ServiceHoursEntryDto?> GetAsync(MySqlConnection c, int id)
    {
        var e = await c.QueryFirstOrDefaultAsync<ServiceHoursEntryDto>(EntrySelect + " WHERE s.pk_service_hours_id = @id", new { id });
        if (e != null) await FillProjectTitlesAsync(c, new List<ServiceHoursEntryDto> { e });
        return e;
    }

    /// <summary>Stores the service photo of the member's own pending entry (a real JPEG, PNG or WebP, at most 5 MB)
    /// and removes the one it replaces. Null: no such pending entry of theirs.</summary>
    public async Task<ServiceHoursEntryDto?> SetPhotoAsync(int memberId, int id, IFormFile file)
    {
        var check = ImageQualityValidator.Validate(file, false, PhotoTypes);
        if (!check.Ok) throw new InvalidOperationException(check.Error);
        if (check.Width == 0) throw new InvalidOperationException("The file is not a readable JPEG, PNG or WebP image.");
        await using var c = RowDb.Connect(_cs);
        var old = await c.QueryFirstOrDefaultAsync<(int ClubId, string? Path)?>(@"
            SELECT fk_club_id, photo_path FROM service_hours WHERE pk_service_hours_id = @id AND fk_member_id = @memberId AND status = 'pending'",
            new { id, memberId });
        if (old == null) return null;
        var clubId = old.Value.ClubId;
        var folder = Path.Combine(_webRoot, "Documents", "ServiceHours", $"Group{clubId}");
        Directory.CreateDirectory(folder);
        var name = $"service-{id}-{RandomNumberGenerator.GetHexString(12, true)}{Path.GetExtension(file.FileName).ToLowerInvariant()}";
        await using (var stream = File.Create(Path.Combine(folder, name)))
            await file.CopyToAsync(stream);
        await c.ExecuteAsync("UPDATE service_hours SET photo_path = @path WHERE pk_service_hours_id = @id",
            new { id, path = $"/Documents/ServiceHours/Group{clubId}/{name}" });
        DeletePhotoFile(old.Value.Path);
        return await GetAsync(c, id);
    }

    private void DeletePhotoFile(string? webPath)
    {
        if (string.IsNullOrEmpty(webPath)) return;
        var root = Path.GetFullPath(Path.Combine(_webRoot, "Documents", "ServiceHours")) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(_webRoot, webPath.TrimStart('/')));
        if (path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) File.Delete(path);
    }

    /// <summary>Removes the member's own entry unless it is approved (approved hours are the club's record).</summary>
    public async Task<bool> DeleteOwnAsync(int memberId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        var path = await c.QueryFirstOrDefaultAsync<(int Id, string? Path)?>(@"
            SELECT pk_service_hours_id, photo_path FROM service_hours WHERE pk_service_hours_id = @id AND fk_member_id = @memberId AND status <> 'approved'",
            new { id, memberId });
        if (path == null) return false;
        await c.ExecuteAsync("DELETE FROM service_hours WHERE pk_service_hours_id = @id", new { id });
        DeletePhotoFile(path.Value.Path);
        return true;
    }

    // ===== Club managers =====

    public async Task<List<ServiceHoursEntryDto>> ListAsync(int clubId, int? yearId, string? status)
    {
        if (status is not (null or "" or "pending" or "approved" or "rejected")) throw new InvalidOperationException("Unknown status.");
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        // shortcut: the newest 500 entries of the filter, add paging if a club logs more.
        var list = (await c.QueryAsync<ServiceHoursEntryDto>(EntrySelect + @"
            WHERE s.fk_club_id = @clubId AND (@yearId IS NULL OR s.fk_year_id = @yearId) AND (@status IS NULL OR s.status = @status)
            ORDER BY s.status = 'pending' DESC, s.service_date DESC, s.pk_service_hours_id DESC LIMIT 500",
            new { clubId, yearId, status = string.IsNullOrEmpty(status) ? null : status })).ToList();
        await FillProjectTitlesAsync(c, list);
        return list;
    }

    public async Task<ServiceHoursEntryDto?> ReviewAsync(int clubId, int id, ReviewServiceHoursDto d, int reviewerId)
    {
        var note = d.Note?.Trim();
        if (note?.Length > 300) throw new InvalidOperationException("The note is 300 characters at most.");
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var n = await c.ExecuteAsync(@"
            UPDATE service_hours SET status = @status, reviewed_by = @reviewerId, reviewed_at = UTC_TIMESTAMP(), review_note = @note
            WHERE pk_service_hours_id = @id AND fk_club_id = @clubId",
            new { id, clubId, reviewerId, status = d.Approve ? "approved" : "rejected", note = string.IsNullOrEmpty(note) ? null : note });
        return n == 0 ? null : await GetAsync(c, id);
    }

    public async Task<List<ServiceProjectOptionDto>> ClubProjectsAsync(int clubId, int yearId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        return await ProjectsAsync(c, clubId, yearId);
    }

    public async Task<List<ContributionDto>> ContributionsAsync(int clubId, int yearId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        return await ContributionsAsync(c, clubId, yearId);
    }

    private async Task<List<ContributionDto>> ContributionsAsync(MySqlConnection c, int clubId, int yearId)
    {
        var list = (await c.QueryAsync<ContributionDto>(@"
            SELECT pk_contribution_id AS Id, fk_year_id AS YearId, fk_project_id AS ProjectId, kind AS Kind, amount AS Amount,
                   currency AS Currency, contributor AS Contributor, description AS Description, contribution_date AS ContributionDate
            FROM service_contributions WHERE fk_club_id = @clubId AND fk_year_id = @yearId
            ORDER BY contribution_date DESC, pk_contribution_id DESC LIMIT 1000", new { clubId, yearId })).ToList();
        var titles = (await ProjectsAsync(c, clubId, yearId, list.Select(x => x.ProjectId))).ToDictionary(p => p.Id, p => p.Title);
        foreach (var x in list) x.ProjectTitle = titles.GetValueOrDefault(x.ProjectId);
        return list;
    }

    public async Task<ContributionDto> AddContributionAsync(int clubId, SaveContributionDto input, int memberId)
    {
        var d = ServiceHoursReport.Validate(input, DateTime.UtcNow);
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var project = (await ProjectsAsync(c, clubId, d.YearId, new[] { d.ProjectId })).FirstOrDefault()
            ?? throw new InvalidOperationException("That project is not one of the club's projects for that Rotary year.");
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO service_contributions (fk_club_id, fk_year_id, fk_project_id, kind, amount, currency, contributor, description,
                contribution_date, created_by, created_at)
            VALUES (@clubId, @YearId, @ProjectId, @Kind, @Amount, @currency, @Contributor, @Description, @ContributionDate, @memberId, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { clubId, d.YearId, d.ProjectId, d.Kind, d.Amount, currency = string.IsNullOrWhiteSpace(project.Currency) ? null : project.Currency.Trim(),
                  d.Contributor, d.Description, d.ContributionDate, memberId });
        return (await ContributionsAsync(c, clubId, d.YearId)).First(x => x.Id == id);
    }

    public async Task<bool> DeleteContributionAsync(int clubId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteAsync("DELETE FROM service_contributions WHERE pk_contribution_id = @id AND fk_club_id = @clubId", new { id, clubId }) > 0;
    }

    // ===== Reports =====

    private async Task<ServiceReportDto> NewReportAsync(MySqlConnection c, int? yearId)
    {
        var years = await YearsAsync(c);
        var year = yearId is { } y
            ? years.FirstOrDefault(x => x.Id == y) ?? throw new InvalidOperationException("Unknown Rotary year.")
            : years.FirstOrDefault() ?? throw new InvalidOperationException("No Rotary year has started.");
        return new ServiceReportDto { Years = years, YearId = year.Id, YearLabel = year.Label };
    }

    // scope: a condition on the club id column named by {0}, with @scopeId
    private static string Scope(bool isClub, string column) => isClub
        ? $"{column} = @scopeId"
        : $"{column} IN (SELECT pk_club_id FROM club_master WHERE fk_district_id = @scopeId)";

    private static async Task<List<ServiceHoursReport.HourFact>> HourFactsAsync(MySqlConnection c, bool isClub, int scopeId, int yearId)
    {
        var logged = await c.QueryAsync<(int ClubId, int MemberId, string Name, int? ProjectId, decimal Hours, int Entries)>($@"
            SELECT s.fk_club_id, s.fk_member_id, MAX(COALESCE(m.MemberName, '')), s.fk_project_id, SUM(s.hours), COUNT(*)
            FROM service_hours s LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = s.fk_member_id
            WHERE s.status = 'approved' AND s.fk_year_id = @yearId AND {Scope(isClub, "s.fk_club_id")}
            GROUP BY s.fk_club_id, s.fk_member_id, s.fk_project_id", new { scopeId, yearId });
        // a sheet linked to a project carries its year; an unlinked one counts in the year its slot starts
        var volunteer = await c.QueryAsync<(int ClubId, int MemberId, string Name, int? ProjectId, decimal Hours)>($@"
            SELECT sh.fk_club_id, COALESCE(su.fk_member_id, 0), MAX(COALESCE(m.MemberName, su.name, '')), sh.fk_project_id, SUM(su.hours)
            FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
            JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
            JOIN rotary_year_master y ON y.pk_year_id = @yearId
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = su.fk_member_id
            WHERE su.hours > 0 AND {Scope(isClub, "sh.fk_club_id")}
              AND (sh.fk_year_id = @yearId OR (sh.fk_year_id IS NULL AND sl.starts_at >= y.StartDate AND sl.starts_at < y.EndDate + INTERVAL 1 DAY))
            GROUP BY sh.fk_club_id, COALESCE(su.fk_member_id, 0), sh.fk_project_id", new { scopeId, yearId });
        return logged.Select(x => new ServiceHoursReport.HourFact(x.ClubId, x.MemberId, x.Name, x.ProjectId, x.Hours, false, x.Entries))
            .Concat(volunteer.Select(x => new ServiceHoursReport.HourFact(x.ClubId, x.MemberId, x.Name, x.ProjectId, x.Hours, true)))
            .ToList();
    }

    private static async Task<List<ServiceHoursReport.MoneyFact>> MoneyFactsAsync(MySqlConnection c, bool isClub, int scopeId, int yearId) =>
        (await c.QueryAsync<(int ClubId, int ProjectId, string Kind, string? Currency, decimal Amount)>($@"
            SELECT fk_club_id, fk_project_id, kind, currency, SUM(amount) FROM service_contributions
            WHERE fk_year_id = @yearId AND {Scope(isClub, "fk_club_id")}
            GROUP BY fk_club_id, fk_project_id, kind, currency", new { scopeId, yearId }))
        .Select(x => new ServiceHoursReport.MoneyFact(x.ClubId, x.ProjectId, x.Kind, x.Currency, x.Amount)).ToList();

    private static Task<int> PendingAsync(MySqlConnection c, bool isClub, int scopeId, int yearId) =>
        c.ExecuteScalarAsync<int>($@"SELECT COUNT(*) FROM service_hours WHERE status = 'pending' AND fk_year_id = @yearId AND {Scope(isClub, "fk_club_id")}",
            new { scopeId, yearId });

    public async Task<ServiceReportDto> ClubReportAsync(int clubId, int? yearId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var r = await NewReportAsync(c, yearId);
        r.ScopeName = await c.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId }) ?? "";
        var hours = await HourFactsAsync(c, true, clubId, r.YearId);
        var money = await MoneyFactsAsync(c, true, clubId, r.YearId);
        var table = await ProjectTableAsync(c, r.YearId);
        var ids = hours.Where(h => h.ProjectId != null).Select(h => h.ProjectId!.Value).Concat(money.Select(m => m.ProjectId)).Distinct().ToList();
        var titles = table == null || ids.Count == 0
            ? new Dictionary<int, (string, int?)>()
            : (await c.QueryAsync<(int Id, string Title, int? ManHours)>($@"
                SELECT pk_project_id, title, man_hours FROM `{table}` WHERE fk_club_id = @clubId AND pk_project_id IN @ids", new { clubId, ids }))
              .ToDictionary(x => x.Id, x => (x.Title, x.ManHours));
        ServiceHoursReport.FillClub(r, hours, money, titles);
        r.Totals.PendingEntries = await PendingAsync(c, true, clubId, r.YearId);
        return r;
    }

    public async Task<ServiceReportDto> DistrictReportAsync(int districtId, int? yearId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var r = await NewReportAsync(c, yearId);
        r.ScopeName = await c.ExecuteScalarAsync<string?>(
            "SELECT CONCAT('District ', DistrictNumber) FROM district_master WHERE pk_district_id = @districtId", new { districtId }) ?? "District";
        var hours = await HourFactsAsync(c, false, districtId, r.YearId);
        var money = await MoneyFactsAsync(c, false, districtId, r.YearId);
        var names = (await c.QueryAsync<(int Id, string Name)>(
                "SELECT pk_club_id, ClubName FROM club_master WHERE fk_district_id = @districtId", new { districtId }))
            .ToDictionary(x => x.Id, x => x.Name);
        ServiceHoursReport.FillDistrict(r, hours, money, names);
        r.Totals.PendingEntries = await PendingAsync(c, false, districtId, r.YearId);
        return r;
    }

    public async Task<(byte[] File, string Name)> ExportAsync(bool isClub, int scopeId, int? yearId)
    {
        var r = isClub ? await ClubReportAsync(scopeId, yearId) : await DistrictReportAsync(scopeId, yearId);
        var contributions = isClub ? await ContributionsAsync(scopeId, r.YearId) : null;
        return (ServiceHoursReport.BuildExcel(r, contributions), $"service-report-{r.YearLabel}.xlsx");
    }
}
