using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// One-time / on-demand world-wide club sync. Fetches ALL Rotary clubs across ~210 countries
/// from /Clubs/search and inserts new clubs into club_master (no soft-delete here — that's
/// reserved for the per-country reconciliation modes).
///
/// Logic:
///  1. Load zones (ZoneName lookup) and districts (composite (zone_id, DistrictNumber) → lowest pk).
///  2. For each country: find zone by name; if zone missing, skip the whole country.
///  3. For each club: look up district by (zone_id, club.District); if missing, record skipped.
///  4. If ClubRotaryId already in DB → skip (don't overwrite — preserves Indian sync clubs).
///  5. INSERT new club with IsSyncedFromRotaryOrg=0, ROW_as_vendor_selected=1, AddedByCountrySync=1.
///  6. Email summary with country-wise breakdown.
/// </summary>
public class WorldSyncWorker
{
    private static readonly string[] AllCountries = new[]
    {
        "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Aruba",
        "Australia", "Austria", "Azerbaijan",
        "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize",
        "Benin", "Bermuda", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil",
        "Bulgaria", "Burkina Faso", "Burundi",
        "Cambodia", "Cameroon", "Canada", "Cape Verde", "Cayman Islands", "Chad",
        "Chile", "China", "Colombia", "Congo", "Costa Rica", "Croatia", "Cuba",
        "Curacao", "Cyprus", "Czech Republic",
        "Denmark", "Djibouti", "Dominica", "Dominican Republic",
        "Ecuador", "Egypt", "El Salvador", "Estonia", "Ethiopia",
        "Faroe Islands", "Fiji", "Finland", "France", "French Guiana",
        "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Gibraltar", "Greece",
        "Greenland", "Grenada", "Guadeloupe", "Guam", "Guatemala", "Guinea", "Guyana",
        "Haiti", "Honduras", "Hong Kong", "Hungary",
        "Iceland", "India", "Indonesia", "Ireland", "Israel", "Italy",
        "Jamaica", "Japan", "Jordan",
        "Kazakhstan", "Kenya", "Korea", "South Korea", "Kosovo", "Kuwait", "Kyrgyzstan",
        "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Liechtenstein",
        "Lithuania", "Luxembourg",
        "Macau", "Macedonia", "North Macedonia", "Madagascar", "Malawi", "Malaysia",
        "Mali", "Malta", "Martinique", "Mauritania", "Mauritius", "Mexico", "Moldova",
        "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
        "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger",
        "Nigeria", "Norway",
        "Oman",
        "Pakistan", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
        "Philippines", "Poland", "Portugal", "Puerto Rico",
        "Qatar",
        "Reunion", "Romania", "Russia", "Rwanda",
        "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
        "Samoa", "San Marino", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
        "Sierra Leone", "Singapore", "Sint Maarten", "Slovakia", "Slovenia",
        "Solomon Islands", "South Africa", "Spain", "Sri Lanka", "Sudan", "Suriname",
        "Sweden", "Switzerland",
        "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
        "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turks and Caicos",
        "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
        "United States", "Uruguay", "Uzbekistan",
        "Vanuatu", "Venezuela", "Vietnam",
        "Yemen",
        "Zambia", "Zimbabwe",
        "Cote d'Ivoire", "Eswatini",
    };

    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<WorldSyncWorker> _logger;
    private readonly string _connectionString;

    public WorldSyncWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<WorldSyncWorker> logger)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task RunAsync(CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === World Sync START ===");

        // Insert log row
        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('WorldSync', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var perCountryStats = new List<(string Country, int Found, int Inserted, int AlreadyInDb, int SkippedDistrictMissing, int SkippedZoneMissing, string Status)>();
        var skippedDistrictMissing = new List<SkippedClubRow>();
        var insertedClubs = new List<ClubChangeRow>();
        var countriesWithoutZone = new List<string>();
        int totalFetched = 0;
        int totalInserted = 0;
        int totalAlreadyInDb = 0;
        int totalSkippedDistrict = 0;
        int errorCount = 0;

        try
        {
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // Load districts as (Country, DistrictNumber) → lowest pk_district_id
            // (lowest pk = oldest = canonical when there are duplicates)
            var districtRows = (await dbConn.QueryAsync<(int pk_id, string? country, string districtNumber)>(@"
                SELECT pk_district_id AS pk_id,
                       Country AS country,
                       DistrictNumber AS districtNumber
                FROM district_master
                WHERE isdeleted = 0")).ToList();

            // Use case-insensitive comparer so "USA" == "usa" == "Usa" all match
            var districtsByCountryAndNumber = new Dictionary<(string Country, string DistrictNumber), int>(new CountryDistrictKeyComparer());
            foreach (var d in districtRows.Where(d => !string.IsNullOrWhiteSpace(d.country) && !string.IsNullOrWhiteSpace(d.districtNumber)))
            {
                var key = (Country: d.country!.Trim(), DistrictNumber: d.districtNumber.Trim());
                if (!districtsByCountryAndNumber.TryGetValue(key, out var existingPk) || d.pk_id < existingPk)
                    districtsByCountryAndNumber[key] = d.pk_id;
            }
            var countriesInDb = new HashSet<string>(districtsByCountryAndNumber.Keys.Select(k => k.Country), StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {districtsByCountryAndNumber.Count} (country, district) lookup keys across {countriesInDb.Count} countries");

            // Load existing clubs by ClubRotaryId
            var existingByRotaryId = (await dbConn.QueryAsync<string>(@"
                SELECT ClubRotaryId
                FROM club_master
                WHERE isdeleted = 0 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {existingByRotaryId.Count} existing club ClubRotaryIds");

            // Loop every country
            int countryIdx = 0;
            foreach (var country in AllCountries)
            {
                ct.ThrowIfCancellationRequested();
                countryIdx++;
                int countryFound = 0;
                int countryInserted = 0;
                int countryAlreadyInDb = 0;
                int countrySkippedDistrict = 0;
                int countrySkippedZone = 0;
                string status = "ok";

                if (!countriesInDb.Contains(country))
                {
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{countryIdx}/{AllCountries.Length}] {country,-30} NO DISTRICTS IN DB — skipping country");
                    countriesWithoutZone.Add(country);
                    perCountryStats.Add((country, 0, 0, 0, 0, 0, "no districts"));
                    continue;
                }

                List<RotaryOrgClubSearchDto> clubs;
                try
                {
                    clubs = await _api.SearchClubsByCountryAsync(country, ct);
                }
                catch (Exception ex)
                {
                    errorCount++;
                    _logger.LogError(ex, "Search failed for {Country}", country);
                    perCountryStats.Add((country, 0, 0, 0, 0, 0, $"api error: {ex.Message}"));
                    continue;
                }
                countryFound = clubs.Count;
                totalFetched += clubs.Count;

                foreach (var c in clubs)
                {
                    ct.ThrowIfCancellationRequested();
                    var rotaryId = c.ClubId.ToString();
                    try
                    {
                        if (existingByRotaryId.Contains(rotaryId))
                        {
                            countryAlreadyInDb++;
                            totalAlreadyInDb++;
                            continue;
                        }

                        if (string.IsNullOrWhiteSpace(c.District) ||
                            !districtsByCountryAndNumber.TryGetValue((country, c.District.Trim()), out var districtPk))
                        {
                            countrySkippedDistrict++;
                            totalSkippedDistrict++;
                            skippedDistrictMissing.Add(new SkippedClubRow
                            {
                                ClubRotaryId = rotaryId,
                                ClubName = c.ClubName ?? "",
                                Country = country,
                                DistrictNumber = c.District ?? "",
                                Reason = $"District {c.District} not in district_master for country {country}",
                            });
                            continue;
                        }

                        var meetingFromTime = ParseTimeFromHHMM(c.Address?.MeetingTime);
                        var meetingAddress = Truncate(BuildMeetingAddress(c.Address), 500);
                        var clubCountry = Truncate(c.Address?.Country ?? c.Location?.Country ?? country, 50);
                        var state = Truncate(c.Address?.State ?? c.Location?.State, 50);
                        var city = Truncate(c.Address?.City, 100);
                        var postalCode = Truncate(c.Address?.PostalCode, 10);
                        var meetingDay = Truncate(c.Address?.MeetingDay, 10);
                        var clubName = Truncate(c.ClubName, 200);
                        var activeFrom = c.CharterDate;
                        var activeTo = c.CharterDate?.AddYears(70);

                        await dbConn.ExecuteAsync(@"
                            INSERT INTO club_master (
                                fk_district_id, ClubRotaryId, ClubName, Timezone,
                                ClubCharterDate, MeetingDay, MeetingFromTime, MeetingAddress,
                                Country, State, City, Pincode,
                                ActiveFromDate, ActiveToDate,
                                IsAutomaticMeetingReminder, IsFamilyLogin, IsActive,
                                IsSyncedFromRotaryOrg, LastSyncedFromRotaryOrg,
                                ROW_as_vendor_selected, AddedByCountrySync,
                                created_date, isdeleted
                            ) VALUES (
                                @DistrictPk, @ClubRotaryId, @ClubName, 'Asia/Kolkata',
                                @CharterDate, @MeetingDay, @MeetingFromTime, @MeetingAddress,
                                @Country, @State, @City, @PinCode,
                                @ActiveFrom, @ActiveTo,
                                1, 0, 1,
                                0, NOW(),
                                1, 1,
                                NOW(), 0
                            )",
                            new
                            {
                                DistrictPk = districtPk,
                                ClubRotaryId = rotaryId,
                                ClubName = clubName,
                                CharterDate = c.CharterDate,
                                MeetingDay = meetingDay,
                                MeetingFromTime = meetingFromTime,
                                MeetingAddress = meetingAddress,
                                Country = clubCountry,
                                State = state,
                                City = city,
                                PinCode = postalCode,
                                ActiveFrom = activeFrom,
                                ActiveTo = activeTo,
                            });
                        // Auto-assign default modules for the newly-inserted club
                        await ClubModuleHelper.AssignDefaultClubModulesAsync(dbConn);
                        existingByRotaryId.Add(rotaryId);
                        countryInserted++;
                        totalInserted++;
                        insertedClubs.Add(new ClubChangeRow
                        {
                            ClubRotaryId = rotaryId,
                            ClubName = c.ClubName ?? "",
                            Country = country,
                            DistrictNumber = c.District ?? "",
                        });
                    }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception ex)
                    {
                        errorCount++;
                        _logger.LogError(ex, "Insert failed for club {ClubId} in {Country}", c.ClubId, country);
                    }
                }

                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{countryIdx}/{AllCountries.Length}] {country,-30} found={countryFound,5}  ins={countryInserted,5}  inDB={countryAlreadyInDb,5}  skipDist={countrySkippedDistrict,5}");
                perCountryStats.Add((country, countryFound, countryInserted, countryAlreadyInDb, countrySkippedDistrict, countrySkippedZone, status));
            }

            var elapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === World Sync DONE in {elapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Countries probed:           {AllCountries.Length}");
            Console.WriteLine($"  Countries with no zone:     {countriesWithoutZone.Count}");
            Console.WriteLine($"  Total clubs fetched:        {totalFetched}");
            Console.WriteLine($"  Inserted (new):             {totalInserted}");
            Console.WriteLine($"  Already in DB (skipped):    {totalAlreadyInDb}");
            Console.WriteLine($"  Skipped (district missing): {totalSkippedDistrict}");
            Console.WriteLine($"  Errors:                     {errorCount}");

            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, InsertedCount = @Ins,
                    SkippedDistrictMissing = @Skip, ErrorCount = @Err
                WHERE pk_id = @Id",
                new
                {
                    Id = logId,
                    Total = totalFetched,
                    Ins = totalInserted,
                    Skip = totalSkippedDistrict,
                    Err = errorCount,
                });

            await SendEmailReportAsync(logId, elapsed, totalFetched, totalInserted, totalAlreadyInDb,
                totalSkippedDistrict, errorCount, countriesWithoutZone, perCountryStats,
                insertedClubs, skippedDistrictMissing);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] WORLD SYNC FAILED: {ex.Message}");
            _logger.LogError(ex, "World sync FAILED");
            try
            {
                await using var conn = CreateConnection();
                await conn.OpenAsync(CancellationToken.None);
                await conn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err
                    WHERE pk_id = @Id",
                    new { Id = logId, Err = ex.Message + "\n" + ex.StackTrace });
            }
            catch { }
            throw;
        }
    }

    private async Task SendEmailReportAsync(
        int logId, TimeSpan elapsed,
        int totalFetched, int insertedCount, int alreadyInDb,
        int skippedDistrict, int errorCount,
        List<string> countriesWithoutZone,
        List<(string Country, int Found, int Inserted, int AlreadyInDb, int SkippedDistrictMissing, int SkippedZoneMissing, string Status)> perCountry,
        List<ClubChangeRow> inserted,
        List<SkippedClubRow> skipped)
    {
        try
        {
            using var workbook = new XLWorkbook();

            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org World Sync Report";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = logId;
            summary.Cell(4, 1).Value = "Duration (min)"; summary.Cell(4, 2).Value = Math.Round(elapsed.TotalMinutes, 1);
            summary.Cell(5, 1).Value = "Countries probed"; summary.Cell(5, 2).Value = AllCountries.Length;
            summary.Cell(6, 1).Value = "Countries without zone"; summary.Cell(6, 2).Value = countriesWithoutZone.Count;
            summary.Cell(7, 1).Value = "Total clubs fetched"; summary.Cell(7, 2).Value = totalFetched;
            summary.Cell(8, 1).Value = "Inserted (new clubs)"; summary.Cell(8, 2).Value = insertedCount;
            summary.Cell(9, 1).Value = "Already in DB (skipped)"; summary.Cell(9, 2).Value = alreadyInDb;
            summary.Cell(10, 1).Value = "Skipped (district missing)"; summary.Cell(10, 2).Value = skippedDistrict;
            summary.Cell(11, 1).Value = "Errors"; summary.Cell(11, 2).Value = errorCount;
            summary.Columns().AdjustToContents();

            // Per-country sheet
            var pc = workbook.Worksheets.Add("Per Country");
            pc.Cell(1, 1).Value = "Country";
            pc.Cell(1, 2).Value = "Found";
            pc.Cell(1, 3).Value = "Inserted";
            pc.Cell(1, 4).Value = "Already in DB";
            pc.Cell(1, 5).Value = "Skipped (no district)";
            pc.Cell(1, 6).Value = "Status";
            pc.Range(1, 1, 1, 6).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < perCountry.Count; i++)
            {
                var r = perCountry[i];
                pc.Cell(i + 2, 1).Value = r.Country;
                pc.Cell(i + 2, 2).Value = r.Found;
                pc.Cell(i + 2, 3).Value = r.Inserted;
                pc.Cell(i + 2, 4).Value = r.AlreadyInDb;
                pc.Cell(i + 2, 5).Value = r.SkippedDistrictMissing;
                pc.Cell(i + 2, 6).Value = r.Status;
            }
            pc.Columns().AdjustToContents();

            AddInsertedSheet(workbook, "Inserted", inserted);
            AddSkippedSheet(workbook, "Skipped (no district)", skipped);

            if (countriesWithoutZone.Count > 0)
            {
                var ws = workbook.Worksheets.Add("Countries Without Zone");
                ws.Cell(1, 1).Value = "Country";
                ws.Range(1, 1, 1, 1).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
                for (int i = 0; i < countriesWithoutZone.Count; i++)
                    ws.Cell(i + 2, 1).Value = countriesWithoutZone[i];
                ws.Columns().AdjustToContents();
            }

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_WorldSync_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";

            // Per-country HTML rows (sorted by Inserted desc, then alpha)
            var sortedForHtml = perCountry
                .OrderByDescending(r => r.Inserted)
                .ThenBy(r => r.Country, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var perCountryRows = string.Join("",
                sortedForHtml.Select(r =>
                    $"<tr><td style='padding:4px 12px;'>{System.Net.WebUtility.HtmlEncode(r.Country)}</td>" +
                    $"<td style='padding:4px 12px;text-align:right;'>{r.Found}</td>" +
                    $"<td style='padding:4px 12px;text-align:right;color:#16a34a;'><b>{r.Inserted}</b></td>" +
                    $"<td style='padding:4px 12px;text-align:right;color:#64748b;'>{r.AlreadyInDb}</td>" +
                    $"<td style='padding:4px 12px;text-align:right;color:#64748b;'>{r.SkippedDistrictMissing}</td>" +
                    $"<td style='padding:4px 12px;color:#64748b;font-size:12px;'>{System.Net.WebUtility.HtmlEncode(r.Status)}</td></tr>"));

            string zoneMissingBlock = "";
            if (countriesWithoutZone.Count > 0)
            {
                var list = string.Join(", ", countriesWithoutZone.Select(System.Net.WebUtility.HtmlEncode));
                zoneMissingBlock = $@"<h3 style='color:#dc2626;margin-top:20px;'>Countries skipped (zone not in DB) — {countriesWithoutZone.Count}</h3>
<p style='color:#475569;font-size:13px;'>Add these to <code>zone_master</code> and re-run to import their clubs:</p>
<p style='color:#dc2626;font-size:13px;'>{list}</p>";
            }

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org World Sync</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>One-time worldwide club sync complete. Summary:</p>
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Duration</td><td style='padding:4px 12px;'><b>{Math.Round(elapsed.TotalMinutes, 1)} min</b></td></tr>
  <tr><td style='padding:4px 12px;'>Countries probed</td><td style='padding:4px 12px;'><b>{AllCountries.Length}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Countries without zone (skipped)</td><td style='padding:4px 12px;color:#dc2626;'><b>{countriesWithoutZone.Count}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Total clubs fetched</td><td style='padding:4px 12px;'><b>{totalFetched}</b></td></tr>
  <tr><td style='padding:4px 12px;'>New clubs inserted</td><td style='padding:4px 12px;color:#16a34a;'><b>{insertedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Already in DB (skipped)</td><td style='padding:4px 12px;color:#64748b;'><b>{alreadyInDb}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Skipped (district missing in zone)</td><td style='padding:4px 12px;color:#64748b;'><b>{skippedDistrict}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Errors</td><td style='padding:4px 12px;color:#dc2626;'><b>{errorCount}</b></td></tr>
</table>

<h3 style='color:#1a365d;margin-top:20px;'>Country-wise breakdown (sorted by inserts)</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:13px;'>
<tr style='background-color:#f1f5f9;font-weight:bold;'>
  <td style='padding:6px 12px;'>Country</td>
  <td style='padding:6px 12px;text-align:right;'>Found</td>
  <td style='padding:6px 12px;text-align:right;'>Inserted</td>
  <td style='padding:6px 12px;text-align:right;'>In DB</td>
  <td style='padding:6px 12px;text-align:right;'>Skipped</td>
  <td style='padding:6px 12px;'>Status</td>
</tr>
{perCountryRows}
</table>

{zoneMissingBlock}

<p style='color:#64748b;font-size:13px;'>Sync log id: {logId}. New clubs inserted with <code>IsSyncedFromRotaryOrg=0</code>, <code>ROW_as_vendor_selected=1</code>, <code>AddedByCountrySync=1</code>. Members for these foreign clubs are NOT synced (member sync remains scoped to India + Sri Lanka + Nepal + Taiwan).</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[One-time] ROW World Sync — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "World sync email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private static string? Truncate(string? value, int maxLen)
    {
        if (value == null) return null;
        var trimmed = value.Trim();
        if (trimmed.Length == 0) return null;
        return trimmed.Length <= maxLen ? trimmed : trimmed.Substring(0, maxLen);
    }

    private static string? BuildMeetingAddress(RotaryOrgSearchAddressDto? addr)
    {
        if (addr == null) return null;
        var parts = new[] { addr.AddressLine1, addr.AddressLine2 }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim())
            .ToList();
        return parts.Count == 0 ? null : string.Join(", ", parts);
    }

    private static TimeSpan? ParseTimeFromHHMM(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim();
        if (s.Length == 4 && int.TryParse(s, out _))
        {
            if (int.TryParse(s.Substring(0, 2), out var hh) &&
                int.TryParse(s.Substring(2, 2), out var mm) &&
                hh >= 0 && hh < 24 && mm >= 0 && mm < 60)
                return new TimeSpan(hh, mm, 0);
        }
        if (TimeSpan.TryParse(s, out var t) && t.TotalHours >= 0 && t.TotalHours < 24) return t;
        if (DateTime.TryParse(s, out var dt)) return dt.TimeOfDay;
        return null;
    }

    private static void AddInsertedSheet(XLWorkbook wb, string sheetName, List<ClubChangeRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "ClubName";
        ws.Cell(1, 3).Value = "Country";
        ws.Cell(1, 4).Value = "District";
        ws.Range(1, 1, 1, 4).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubRotaryId;
            ws.Cell(i + 2, 2).Value = rows[i].ClubName;
            ws.Cell(i + 2, 3).Value = rows[i].Country;
            ws.Cell(i + 2, 4).Value = rows[i].DistrictNumber;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddSkippedSheet(XLWorkbook wb, string sheetName, List<SkippedClubRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "ClubName";
        ws.Cell(1, 3).Value = "Country";
        ws.Cell(1, 4).Value = "District (RI.org)";
        ws.Cell(1, 5).Value = "Reason";
        ws.Range(1, 1, 1, 5).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubRotaryId;
            ws.Cell(i + 2, 2).Value = rows[i].ClubName;
            ws.Cell(i + 2, 3).Value = rows[i].Country;
            ws.Cell(i + 2, 4).Value = rows[i].DistrictNumber;
            ws.Cell(i + 2, 5).Value = rows[i].Reason;
        }
        ws.Columns().AdjustToContents();
    }

    private class CountryDistrictKeyComparer : IEqualityComparer<(string Country, string DistrictNumber)>
    {
        public bool Equals((string Country, string DistrictNumber) a, (string Country, string DistrictNumber) b)
            => string.Equals(a.Country, b.Country, StringComparison.OrdinalIgnoreCase)
            && string.Equals(a.DistrictNumber, b.DistrictNumber, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode((string Country, string DistrictNumber) k)
            => HashCode.Combine(
                StringComparer.OrdinalIgnoreCase.GetHashCode(k.Country ?? ""),
                StringComparer.OrdinalIgnoreCase.GetHashCode(k.DistrictNumber ?? ""));
    }

    private class ClubChangeRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string Country { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
    }

    private class SkippedClubRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string Country { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
        public string Reason { get; set; } = "";
    }
}
