using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// One-shot full importer. For each Rotary country worldwide:
///   1. Ensure a zone exists in zone_master (ZoneName = country, create if missing).
///   2. Fetch /Clubs/search for that country.
///   3. For each unique District in the response, ensure a row exists in district_master
///      (DistrictNumber + Country + fk_zone_id, create if missing).
///   4. For each club, INSERT new or skip if already in DB by ClubRotaryId.
/// Sends an email summary at the end with per-country breakdown.
///
/// Use after running --import-world-districts produced a partial result. This mode is
/// idempotent — safe to re-run, never duplicates zones / districts / clubs.
/// </summary>
public class WorldEnsureWorker
{
    // The 4 target countries get their own zone in zone_master (zone name = country name).
    // Every other country's districts share a single "Other Zones" bucket —
    // district_master.Country still records the actual country for filtering.
    private static readonly string[] TargetCountries = new[] { "India", "Nepal", "Sri Lanka", "Taiwan" };
    private const string OtherCountriesZoneName = "Other Zones";

    private static readonly string[] AllCountries = new[]
    {
        "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Aruba",
        "Australia", "Austria", "Azerbaijan",
        "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize",
        "Benin", "Bermuda", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil",
        "Bulgaria", "Burkina Faso", "Burundi",
        "Cambodia", "Cameroon", "Canada", "Cape Verde", "Cayman Islands", "Chad",
        "Chile", "China", "Colombia", "Congo", "Costa Rica", "Cote d'Ivoire",
        "Croatia", "Cuba", "Curacao", "Cyprus", "Czech Republic",
        "Denmark", "Djibouti", "Dominica", "Dominican Republic",
        "Ecuador", "Egypt", "El Salvador", "Estonia", "Eswatini", "Ethiopia",
        "Faroe Islands", "Fiji", "Finland", "France", "French Guiana",
        "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Gibraltar", "Greece",
        "Greenland", "Grenada", "Guadeloupe", "Guam", "Guatemala", "Guinea", "Guyana",
        "Haiti", "Honduras", "Hong Kong", "Hungary",
        "Iceland", "India", "Indonesia", "Ireland", "Israel", "Italy",
        "Jamaica", "Japan", "Jordan",
        "Kazakhstan", "Kenya", "South Korea", "Kosovo", "Kuwait", "Kyrgyzstan",
        "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Liechtenstein",
        "Lithuania", "Luxembourg",
        "Macau", "North Macedonia", "Madagascar", "Malawi", "Malaysia",
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
    };

    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<WorldEnsureWorker> _logger;
    private readonly string _connectionString;

    public WorldEnsureWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<WorldEnsureWorker> logger)
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
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === World Ensure START ===");

        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('WorldEnsure', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var perCountry = new List<(string Country, int FoundClubs, int ZonesAdded, int DistrictsAdded, int ClubsInserted, int ClubsAlreadyInDb, int Errors, string Status)>();
        int totalZonesAdded = 0;
        int totalDistrictsAdded = 0;
        int totalClubsInserted = 0;
        int totalClubsAlreadyInDb = 0;
        int totalFetched = 0;
        int errorCount = 0;

        try
        {
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // Cache existing zones (case-insensitive name → pk)
            var zoneCache = (await dbConn.QueryAsync<(int pk_id, string zoneName)>(
                "SELECT pk_zone_id AS pk_id, ZoneName AS zoneName FROM zone_master WHERE isdeleted = 0"))
                .ToDictionary(x => x.zoneName, x => x.pk_id, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {zoneCache.Count} existing zones");

            // Cache existing districts as ((Country, DistrictNumber) → lowest pk) — case-insensitive
            var districtCache = new Dictionary<(string Country, string DistrictNumber), int>(new CountryDistrictKeyComparer());
            var districtRows = await dbConn.QueryAsync<(int pk_id, string? country, string districtNumber)>(@"
                SELECT pk_district_id AS pk_id, Country AS country, DistrictNumber AS districtNumber
                FROM district_master WHERE isdeleted = 0");
            foreach (var d in districtRows.Where(d => !string.IsNullOrWhiteSpace(d.country) && !string.IsNullOrWhiteSpace(d.districtNumber)))
            {
                var key = (Country: d.country!.Trim(), DistrictNumber: d.districtNumber.Trim());
                if (!districtCache.TryGetValue(key, out var existingPk) || d.pk_id < existingPk)
                    districtCache[key] = d.pk_id;
            }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {districtCache.Count} existing (country, district) keys");

            // Cache existing clubs by ClubRotaryId
            var existingClubs = (await dbConn.QueryAsync<string>(@"
                SELECT ClubRotaryId FROM club_master
                WHERE isdeleted = 0 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {existingClubs.Count} existing clubs");

            int countryIdx = 0;
            foreach (var country in AllCountries)
            {
                ct.ThrowIfCancellationRequested();
                countryIdx++;
                int zonesAdded = 0;
                int districtsAdded = 0;
                int clubsInserted = 0;
                int clubsAlreadyInDb = 0;
                int countryErrors = 0;
                string status = "ok";

                List<RotaryOrgClubSearchDto> clubs;
                try
                {
                    clubs = await _api.SearchClubsByCountryAsync(country, ct);
                }
                catch (Exception ex)
                {
                    errorCount++;
                    _logger.LogError(ex, "Search failed for {Country}", country);
                    perCountry.Add((country, 0, 0, 0, 0, 0, 1, $"api error: {ex.Message}"));
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{countryIdx}/{AllCountries.Length}] {country,-30} API ERROR: {ex.Message}");
                    continue;
                }

                if (clubs.Count == 0)
                {
                    perCountry.Add((country, 0, 0, 0, 0, 0, 0, "no clubs in API"));
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{countryIdx}/{AllCountries.Length}] {country,-30} 0 clubs in API");
                    continue;
                }
                totalFetched += clubs.Count;

                // Step 1: Ensure zone.
                // Target countries (India / Nepal / Sri Lanka / Taiwan) keep their own dedicated zones.
                // Every other country's districts go under a single shared "Other Zones" bucket
                // — district_master.Country still records the actual country name for filtering.
                var isTargetCountry = TargetCountries.Contains(country, StringComparer.OrdinalIgnoreCase);
                var zoneNameToUse = isTargetCountry ? country : OtherCountriesZoneName;

                if (!zoneCache.TryGetValue(zoneNameToUse, out var zoneId))
                {
                    try
                    {
                        zoneId = await dbConn.ExecuteScalarAsync<int>(@"
                            INSERT INTO zone_master (ZoneName, IsActive, created_date, isdeleted)
                            VALUES (@Name, 1, NOW(), 0);
                            SELECT LAST_INSERT_ID();",
                            new { Name = zoneNameToUse });
                        zoneCache[zoneNameToUse] = zoneId;
                        zonesAdded++;
                        totalZonesAdded++;
                    }
                    catch (Exception ex)
                    {
                        errorCount++;
                        countryErrors++;
                        _logger.LogError(ex, "Zone insert failed for {Zone}", zoneNameToUse);
                        status = $"zone insert error: {ex.Message}";
                    }
                }

                // Step 2: Ensure districts
                var distinctDistricts = clubs
                    .Where(c => !string.IsNullOrWhiteSpace(c.District))
                    .Select(c => c.District!.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                foreach (var districtNumber in distinctDistricts)
                {
                    ct.ThrowIfCancellationRequested();
                    var key = (Country: country, DistrictNumber: districtNumber);
                    if (districtCache.ContainsKey(key)) continue;

                    try
                    {
                        var districtPk = await dbConn.ExecuteScalarAsync<int>(@"
                            INSERT INTO district_master (DistrictNumber, fk_zone_id, Country, IsActive, created_date, isdeleted)
                            VALUES (@DistrictNumber, NULL, @Country, 1, NOW(), 0);   -- no zone yet (NULL, not 0 — FK fk_district_zone has no zone 0); SuperAdmin assigns later
                            SELECT LAST_INSERT_ID();",
                            new { DistrictNumber = districtNumber, Country = country });
                        districtCache[key] = districtPk;
                        districtsAdded++;
                        totalDistrictsAdded++;
                    }
                    catch (Exception ex)
                    {
                        errorCount++;
                        countryErrors++;
                        _logger.LogError(ex, "District insert failed for {Country} D{District}", country, districtNumber);
                    }
                }

                // Step 3: Ensure clubs
                foreach (var c in clubs)
                {
                    ct.ThrowIfCancellationRequested();
                    var rotaryId = c.ClubId.ToString();
                    try
                    {
                        if (existingClubs.Contains(rotaryId))
                        {
                            clubsAlreadyInDb++;
                            totalClubsAlreadyInDb++;
                            continue;
                        }

                        if (string.IsNullOrWhiteSpace(c.District) ||
                            !districtCache.TryGetValue((country, c.District.Trim()), out var districtPk))
                        {
                            // Should not happen since we just ensured districts above, but guard anyway
                            countryErrors++;
                            errorCount++;
                            continue;
                        }

                        var meetingFromTime = ParseTimeFromHHMM(c.Address?.MeetingTime);
                        var meetingAddress = Truncate(BuildMeetingAddress(c.Address), 500);
                        var clubCountry = Truncate(c.Address?.Country ?? c.Location?.Country ?? country, 50);
                        var state = Truncate(c.Address?.State ?? c.Location?.State, 50);
                        var city = Truncate(c.Address?.City, 100);
                        var postalCode = Truncate(c.Address?.PostalCode, 20);
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
                                @DistrictPk, @ClubRotaryId, @ClubName, @Tz,
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
                                Tz = RotaryApi.Services.Brand.DefaultTimeZone,   // ROW: the brand's zone (the original: Asia/Kolkata)
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
                        existingClubs.Add(rotaryId);
                        clubsInserted++;
                        totalClubsInserted++;
                    }
                    catch (Exception ex)
                    {
                        errorCount++;
                        countryErrors++;
                        _logger.LogError(ex, "Club insert failed for {ClubId} in {Country}", c.ClubId, country);
                    }
                }

                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{countryIdx}/{AllCountries.Length}] {country,-30} fetched={clubs.Count,5} +zone={zonesAdded}  +district={districtsAdded,3}  +club={clubsInserted,5}  inDB={clubsAlreadyInDb,5}  err={countryErrors}");
                perCountry.Add((country, clubs.Count, zonesAdded, districtsAdded, clubsInserted, clubsAlreadyInDb, countryErrors, status));
            }

            var elapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === World Ensure DONE in {elapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Countries probed:           {AllCountries.Length}");
            Console.WriteLine($"  Total clubs fetched:        {totalFetched}");
            Console.WriteLine($"  Zones added:                {totalZonesAdded}");
            Console.WriteLine($"  Districts added:            {totalDistrictsAdded}");
            Console.WriteLine($"  Clubs inserted:             {totalClubsInserted}");
            Console.WriteLine($"  Clubs already in DB:        {totalClubsAlreadyInDb}");
            Console.WriteLine($"  Errors:                     {errorCount}");

            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, InsertedCount = @Ins, ErrorCount = @Err
                WHERE pk_id = @Id",
                new { Id = logId, Total = totalFetched, Ins = totalClubsInserted, Err = errorCount });

            await SendEmailReportAsync(logId, elapsed, totalFetched, totalZonesAdded, totalDistrictsAdded,
                totalClubsInserted, totalClubsAlreadyInDb, errorCount, perCountry);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] WORLD ENSURE FAILED: {ex.Message}");
            _logger.LogError(ex, "World ensure FAILED");
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
        int totalFetched, int zonesAdded, int districtsAdded,
        int clubsInserted, int clubsAlreadyInDb, int errorCount,
        List<(string Country, int FoundClubs, int ZonesAdded, int DistrictsAdded, int ClubsInserted, int ClubsAlreadyInDb, int Errors, string Status)> perCountry)
    {
        try
        {
            using var workbook = new XLWorkbook();

            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org World Ensure Report";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = logId;
            summary.Cell(4, 1).Value = "Duration (min)"; summary.Cell(4, 2).Value = Math.Round(elapsed.TotalMinutes, 1);
            summary.Cell(5, 1).Value = "Countries probed"; summary.Cell(5, 2).Value = AllCountries.Length;
            summary.Cell(6, 1).Value = "Total clubs fetched"; summary.Cell(6, 2).Value = totalFetched;
            summary.Cell(7, 1).Value = "Zones added (new)"; summary.Cell(7, 2).Value = zonesAdded;
            summary.Cell(8, 1).Value = "Districts added (new)"; summary.Cell(8, 2).Value = districtsAdded;
            summary.Cell(9, 1).Value = "Clubs inserted (new)"; summary.Cell(9, 2).Value = clubsInserted;
            summary.Cell(10, 1).Value = "Clubs already in DB"; summary.Cell(10, 2).Value = clubsAlreadyInDb;
            summary.Cell(11, 1).Value = "Errors"; summary.Cell(11, 2).Value = errorCount;
            summary.Columns().AdjustToContents();

            var pc = workbook.Worksheets.Add("Per Country");
            pc.Cell(1, 1).Value = "Country";
            pc.Cell(1, 2).Value = "Found Clubs";
            pc.Cell(1, 3).Value = "Zones Added";
            pc.Cell(1, 4).Value = "Districts Added";
            pc.Cell(1, 5).Value = "Clubs Inserted";
            pc.Cell(1, 6).Value = "Clubs Already in DB";
            pc.Cell(1, 7).Value = "Errors";
            pc.Cell(1, 8).Value = "Status";
            pc.Range(1, 1, 1, 8).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < perCountry.Count; i++)
            {
                var r = perCountry[i];
                pc.Cell(i + 2, 1).Value = r.Country;
                pc.Cell(i + 2, 2).Value = r.FoundClubs;
                pc.Cell(i + 2, 3).Value = r.ZonesAdded;
                pc.Cell(i + 2, 4).Value = r.DistrictsAdded;
                pc.Cell(i + 2, 5).Value = r.ClubsInserted;
                pc.Cell(i + 2, 6).Value = r.ClubsAlreadyInDb;
                pc.Cell(i + 2, 7).Value = r.Errors;
                pc.Cell(i + 2, 8).Value = r.Status;
            }
            pc.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_WorldEnsure_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";

            // Top countries by clubs inserted
            var topRows = string.Join("",
                perCountry.OrderByDescending(r => r.ClubsInserted).ThenBy(r => r.Country, StringComparer.OrdinalIgnoreCase)
                    .Take(40)
                    .Select(r =>
                        $"<tr><td style='padding:4px 12px;'>{System.Net.WebUtility.HtmlEncode(r.Country)}</td>" +
                        $"<td style='padding:4px 12px;text-align:right;'>{r.FoundClubs}</td>" +
                        $"<td style='padding:4px 12px;text-align:right;color:#16a34a;'><b>{r.ClubsInserted}</b></td>" +
                        $"<td style='padding:4px 12px;text-align:right;color:#64748b;'>{r.ClubsAlreadyInDb}</td>" +
                        $"<td style='padding:4px 12px;text-align:right;color:#0ea5e9;'>{r.DistrictsAdded}</td>" +
                        $"<td style='padding:4px 12px;text-align:right;color:#0ea5e9;'>{r.ZonesAdded}</td>" +
                        $"<td style='padding:4px 12px;color:#64748b;font-size:12px;'>{System.Net.WebUtility.HtmlEncode(r.Status)}</td></tr>"));

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org World Ensure</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>One-shot full importer complete (zones + districts + clubs). Summary:</p>
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Duration</td><td style='padding:4px 12px;'><b>{Math.Round(elapsed.TotalMinutes, 1)} min</b></td></tr>
  <tr><td style='padding:4px 12px;'>Countries probed</td><td style='padding:4px 12px;'><b>{AllCountries.Length}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Total clubs fetched</td><td style='padding:4px 12px;'><b>{totalFetched}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Zones added (new)</td><td style='padding:4px 12px;color:#0ea5e9;'><b>{zonesAdded}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Districts added (new)</td><td style='padding:4px 12px;color:#0ea5e9;'><b>{districtsAdded}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Clubs inserted (new)</td><td style='padding:4px 12px;color:#16a34a;'><b>{clubsInserted}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Clubs already in DB</td><td style='padding:4px 12px;color:#64748b;'><b>{clubsAlreadyInDb}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Errors</td><td style='padding:4px 12px;color:#dc2626;'><b>{errorCount}</b></td></tr>
</table>

<h3 style='color:#1a365d;margin-top:20px;'>Top 40 countries (by new clubs inserted)</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:13px;'>
<tr style='background-color:#f1f5f9;font-weight:bold;'>
  <td style='padding:6px 12px;'>Country</td>
  <td style='padding:6px 12px;text-align:right;'>Found</td>
  <td style='padding:6px 12px;text-align:right;'>Inserted</td>
  <td style='padding:6px 12px;text-align:right;'>In DB</td>
  <td style='padding:6px 12px;text-align:right;'>+Districts</td>
  <td style='padding:6px 12px;text-align:right;'>+Zones</td>
  <td style='padding:6px 12px;'>Status</td>
</tr>
{topRows}
</table>

<p style='color:#64748b;font-size:13px;'>Sync log id: {logId}. Full per-country breakdown is in the attached Excel.
New clubs inserted with <code>IsSyncedFromRotaryOrg=0</code>, <code>ROW_as_vendor_selected=1</code>, <code>AddedByCountrySync=1</code>.
Members for foreign clubs are NOT synced (member sync remains scoped to India + Sri Lanka + Nepal + Taiwan).</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[One-time] ROW World Ensure — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "World ensure email FAILED");
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
}
