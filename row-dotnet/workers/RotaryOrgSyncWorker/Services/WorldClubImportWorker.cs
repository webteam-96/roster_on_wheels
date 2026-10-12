using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// MANUAL-ONLY world club import (--world-clubs). Adds every Rotary club worldwide that is NOT
/// yet in club_master, as a NON-SYNC club row. Nothing else is created — no members, no BOD,
/// no committees, no default club modules.
///
/// Rules (user, 2026-09-18):
///   - Existing clubs are NEVER touched: a ClubRotaryId already in club_master (sync, non-sync,
///     or soft-deleted) is skipped — no UPDATE, no flag change, no delete.
///   - Only EXISTING club_master columns are filled, and only with what Rotary.org returns;
///     a value Rotary.org doesn't send stays NULL. No new columns.
///   - District numbers are NEVER duplicated and never country-wise: matched on DistrictNumber
///     alone (Rotary district numbers are unique worldwide; one district can span countries).
///     A number not in district_master is inserted ONCE under the "Other Zones" zone.
///   - Clubs with no district number on Rotary.org are skipped and listed in the report.
///   - India / Sri Lanka / Nepal are skipped — the daily --country-sync already owns them
///     (and their districts belong to real zones, not "Other Zones").
///
/// Insert-only: never deletes. --dry-run fetches + reports what WOULD be inserted, no DB writes.
/// </summary>
public class WorldClubImportWorker
{
    private const string OtherZonesName = "Other Zones";

    // Owned by the daily --country-sync; never imported here.
    private static readonly HashSet<string> SkipCountries =
        new(new[] { "India", "Sri Lanka", "Nepal" }, StringComparer.OrdinalIgnoreCase);

    // Country names EXACTLY as Rotary.org's /Clubs/search expects them — verified live 2026-09-18.
    // Rotary.org uses formal names ("Korea, Republic of", "Russian Federation", "Viet Nam", "Côte d'Ivoire")
    // and splits the UK into England / Scotland / Wales / Northern Ireland. A few (Cuba, Kuwait, Oman,
    // Qatar, Saudi Arabia, Tajikistan, Uzbekistan, Yemen) genuinely return 0 today — kept so new clubs
    // there are picked up. Any name returning 0 is listed in the report. Results are de-duplicated by ClubId.
    private static readonly string[] AllCountries = new[]
    {
        "Afghanistan", "Albania", "Algeria", "American Samoa", "Andorra", "Angola", "Anguilla",
        "Antigua and Barbuda", "Argentina", "Armenia", "Aruba", "Australia", "Austria",
        "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
        "Belize", "Benin", "Bermuda", "Bhutan", "Bolivia", "Bonaire", "Bosnia and Herzegovina",
        "Botswana", "Brazil", "British Virgin Islands", "Brunei Darussalam", "Bulgaria",
        "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Cayman Islands",
        "Central African Republic", "Chad", "Chile", "China, People's Republic of", "Colombia",
        "Comoros", "Congo", "Congo, The Democratic Republic of the", "Cook Islands", "Costa Rica",
        "Croatia", "Cuba", "Curaçao", "Cyprus", "Czech Republic", "Côte d'Ivoire", "Denmark",
        "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "England",
        "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Faroe Islands", "Fiji",
        "Finland", "France", "French Guiana", "French Polynesia", "Gabon", "Gambia", "Georgia",
        "Germany", "Ghana", "Gibraltar", "Greece", "Greenland", "Grenada", "Guadeloupe", "Guam",
        "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong",
        "Hungary", "Iceland", "Indonesia", "Iraq", "Ireland", "Isle of Man", "Israel", "Italy",
        "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Korea, Republic of", "Kosovo",
        "Kuwait", "Kyrgyzstan", "Lao People's Democratic Republic", "Latvia", "Lebanon", "Lesotho",
        "Liberia", "Liechtenstein", "Lithuania", "Luxembourg", "Macao", "Madagascar", "Malawi",
        "Malaysia", "Maldives", "Mali", "Malta", "Martinique", "Mauritania", "Mauritius", "Mayotte",
        "Mexico", "Micronesia, Federated States of", "Moldova", "Monaco", "Mongolia", "Montenegro",
        "Montserrat", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Netherlands",
        "New Caledonia", "New Zealand", "Nicaragua", "Niger", "Nigeria", "Norfolk Island",
        "North Macedonia", "Northern Ireland", "Northern Mariana Islands", "Norway", "Oman",
        "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
        "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar", "Romania",
        "Russian Federation", "Rwanda", "Réunion", "Saint Barthélemy", "Saint Kitts and Nevis",
        "Saint Lucia", "Saint Martin", "Saint Pierre and Miquelon",
        "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
        "Saudi Arabia", "Scotland", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
        "Sint Maarten", "Slovakia", "Slovenia", "Solomon Islands", "South Africa", "South Sudan",
        "Spain", "Sudan", "Suriname", "Sweden", "Switzerland", "Taiwan", "Tajikistan",
        "Tanzania, United Republic of", "Thailand", "Timor-Leste", "Togo", "Tonga",
        "Trinidad and Tobago", "Tunisia", "Turkey", "Turks and Caicos Islands", "Uganda", "Ukraine",
        "United Arab Emirates", "United States", "United States Virgin Islands", "Uruguay",
        "Uzbekistan", "Vanuatu", "Venezuela", "Viet Nam", "Wales", "Yemen", "Zambia", "Zimbabwe",
        // India / Sri Lanka / Nepal are owned by the daily --country-sync (see SkipCountries).
    };

    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<WorldClubImportWorker> _logger;
    private readonly string _connectionString;

    public WorldClubImportWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<WorldClubImportWorker> logger)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private sealed class CountryStat
    {
        public string Country = "";
        public int Found;
        public int Inserted;
        public int AlreadyInDb;
        public int Skipped;
        public string Status = "ok";
    }

    private sealed class InsertedRow
    {
        public string ClubRotaryId = "";
        public string ClubName = "";
        public string DistrictNumber = "";
        public string Country = "";
        public string City = "";
        public bool NewDistrict;
    }

    private sealed class SkippedRow
    {
        public string ClubRotaryId = "";
        public string ClubName = "";
        public string Country = "";
        public string DistrictNumber = "";
        public string Reason = "";
    }

    public async Task RunAsync(bool dryRun, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === World Clubs Import {(dryRun ? "DRY RUN" : "APPLY")} START ===");
        if (dryRun) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] *** DRY RUN — no DB writes ***");

        int logId = 0;
        if (!dryRun)
        {
            await using var conn0 = CreateConnection();
            await conn0.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn0.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('WorldClubs', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");
        }

        var stats = new Dictionary<string, CountryStat>(StringComparer.OrdinalIgnoreCase);
        var inserted = new List<InsertedRow>();
        var skipped = new List<SkippedRow>();
        var newDistricts = new List<(string DistrictNumber, string Country)>();
        var failedCountries = new List<(string Country, string Error)>();
        var zeroCountries = new List<string>();
        int totalFetched = 0, alreadyInDb = 0, errorCount = 0;

        try
        {
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // "Other Zones" must already exist — never create a zone here.
            var otherZoneId = await dbConn.ExecuteScalarAsync<int?>(@"
                SELECT pk_zone_id FROM zone_master
                WHERE ZoneName = @Name AND isdeleted = 0
                ORDER BY pk_zone_id LIMIT 1",
                new { Name = OtherZonesName });
            if (otherZoneId == null)
                throw new InvalidOperationException($"Zone '{OtherZonesName}' not found in zone_master — aborting (no zone is created by this mode).");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] '{OtherZonesName}' zone id = {otherZoneId}");

            // Districts keyed by DistrictNumber ONLY (never country-wise). Active rows win; a number
            // that exists only as a soft-deleted row is NOT re-created (would duplicate the number)
            // — those clubs are skipped and reported instead.
            var districtRows = (await dbConn.QueryAsync<(int pk_id, string districtNumber, int isdeleted)>(@"
                SELECT pk_district_id AS pk_id, TRIM(DistrictNumber) AS districtNumber, IFNULL(isdeleted,0) AS isdeleted
                FROM district_master
                WHERE DistrictNumber IS NOT NULL AND TRIM(DistrictNumber) <> ''")).ToList();
            var activeDistricts = districtRows.Where(d => d.isdeleted == 0)
                .GroupBy(d => d.districtNumber, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Min(x => x.pk_id), StringComparer.OrdinalIgnoreCase);
            var deletedOnlyDistricts = new HashSet<string>(
                districtRows.Where(d => d.isdeleted != 0 && !activeDistricts.ContainsKey(d.districtNumber)).Select(d => d.districtNumber),
                StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {activeDistricts.Count} district numbers");

            // Every ClubRotaryId we hold — INCLUDING soft-deleted — so a club removed on purpose
            // is never re-inserted and no existing row is ever touched.
            var existingClubIds = (await dbConn.QueryAsync<string>(@"
                SELECT TRIM(ClubRotaryId) FROM club_master
                WHERE ClubRotaryId IS NOT NULL AND TRIM(ClubRotaryId) <> ''"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {existingClubIds.Count} existing ClubRotaryIds (incl. deleted)");

            // 1. Fetch every country. One failed country is logged and skipped — never aborts the run.
            var countries = AllCountries.Where(c => !SkipCountries.Contains(c))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var unique = new Dictionary<string, (RotaryOrgClubSearchDto Club, string SearchCountry)>(StringComparer.OrdinalIgnoreCase);
            int idx = 0;
            foreach (var country in countries)
            {
                ct.ThrowIfCancellationRequested();
                idx++;
                var st = new CountryStat { Country = country };
                stats[country] = st;
                List<RotaryOrgClubSearchDto> list;
                try
                {
                    list = await _api.SearchClubsByCountryAsync(country, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    errorCount++;
                    st.Status = "API error";
                    failedCountries.Add((country, ex.Message));
                    _logger.LogError(ex, "World clubs: search failed for {Country}", country);
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{idx}/{countries.Count}] {country,-32} API ERROR: {ex.Message}");
                    continue;
                }

                totalFetched += list.Count;
                if (list.Count == 0)
                {
                    st.Status = "0 clubs in API";
                    zeroCountries.Add(country);
                }
                foreach (var c in list)
                {
                    var key = c.ClubId.ToString();
                    if (c.ClubId <= 0) continue;
                    if (!unique.TryGetValue(key, out var prev))
                    {
                        unique[key] = (c, country);
                        st.Found++;
                    }
                    else if (!IsMeetingAddress(prev.Club.Address) && IsMeetingAddress(c.Address))
                    {
                        // /Clubs/search repeats a club once per address — prefer the meeting address.
                        unique[key] = (c, prev.SearchCountry);
                    }
                }
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{idx}/{countries.Count}] {country,-32} {list.Count,6} rows");
            }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Unique clubs from Rotary.org: {unique.Count}");

            // 2. Insert clubs not in DB.
            foreach (var (rotaryId, (c, searchCountry)) in unique)
            {
                ct.ThrowIfCancellationRequested();
                var st = stats[searchCountry];
                var clubCountry = Clean(c.Address?.Country) ?? Clean(c.Location?.Country) ?? searchCountry;

                if (existingClubIds.Contains(rotaryId))
                {
                    st.AlreadyInDb++;
                    alreadyInDb++;
                    continue;
                }

                // Also leave India / Sri Lanka / Nepal clubs that surfaced under another country's
                // search to the daily --country-sync.
                if (SkipCountries.Contains(clubCountry))
                    continue;

                var districtNumber = Clean(c.District);
                if (districtNumber == null)
                {
                    st.Skipped++;
                    skipped.Add(new SkippedRow { ClubRotaryId = rotaryId, ClubName = c.ClubName ?? "", Country = clubCountry, Reason = "No district number on Rotary.org" });
                    continue;
                }
                if (!activeDistricts.ContainsKey(districtNumber) && deletedOnlyDistricts.Contains(districtNumber))
                {
                    st.Skipped++;
                    skipped.Add(new SkippedRow { ClubRotaryId = rotaryId, ClubName = c.ClubName ?? "", Country = clubCountry, DistrictNumber = districtNumber, Reason = "District exists only as a deleted row — not re-created" });
                    continue;
                }

                try
                {
                    bool createdDistrict = false;
                    if (!activeDistricts.TryGetValue(districtNumber, out var districtPk))
                    {
                        if (!dryRun)
                        {
                            districtPk = await dbConn.ExecuteScalarAsync<int>(@"
                                INSERT INTO district_master (DistrictNumber, fk_zone_id, Country, IsActive, created_date, isdeleted)
                                VALUES (@DistrictNumber, @ZoneId, @Country, 1, NOW(), 0);
                                SELECT LAST_INSERT_ID();",
                                new { DistrictNumber = Truncate(districtNumber, 50), ZoneId = otherZoneId, Country = Truncate(clubCountry, 100) });
                        }
                        else districtPk = -1;
                        activeDistricts[districtNumber] = districtPk;
                        newDistricts.Add((districtNumber, clubCountry));
                        createdDistrict = true;
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {(dryRun ? "[DRY RUN] would create" : "+ created")} district D{districtNumber} ({clubCountry}) under '{OtherZonesName}'");
                    }

                    var (lat, lng) = ValidLatLng(c.Latitude, c.Longitude);
                    var city = Truncate(c.Address?.City, 100);

                    if (!dryRun)
                    {
                        // Only existing columns; NULL where Rotary.org sends nothing. Timezone written
                        // NULL explicitly (column default is Asia/Kolkata). NO default modules.
                        await dbConn.ExecuteAsync(@"
                            INSERT INTO club_master (
                                fk_district_id, ClubRotaryId, ClubName, ClubType, Timezone,
                                ClubCharterDate, ActiveFromDate,
                                MeetingDay, MeetingFromTime, MeetingAddress,
                                Country, State, City, Pincode,
                                ClubWebsite, ClubEmail, Latitude, Longitude,
                                IsAutomaticMeetingReminder, IsFamilyLogin, IsActive,
                                IsSyncedFromRotaryOrg, LastSyncedFromRotaryOrg,
                                ROW_as_vendor_selected, AddedByCountrySync,
                                created_date, isdeleted
                            ) VALUES (
                                @DistrictPk, @ClubRotaryId, @ClubName, @ClubType, NULL,
                                @CharterDate, @CharterDate,
                                @MeetingDay, @MeetingFromTime, @MeetingAddress,
                                @Country, @State, @City, @PinCode,
                                @Website, @Email, @Lat, @Lng,
                                1, 0, 1,
                                0, NOW(),
                                1, 1,
                                NOW(), 0
                            )",
                            new
                            {
                                DistrictPk = districtPk,
                                ClubRotaryId = rotaryId,
                                ClubName = Truncate(c.ClubName, 300),
                                ClubType = Truncate(c.ClubType, 50),
                                CharterDate = c.CharterDate?.Date,
                                MeetingDay = Truncate(NormalizeMeetingDay(c.Address?.MeetingDay), 20),
                                MeetingFromTime = ParseTimeFromHHMM(c.Address?.MeetingTime),
                                MeetingAddress = BuildMeetingAddress(c.Address),
                                Country = Truncate(clubCountry, 100),
                                State = Truncate(c.Address?.State ?? c.Location?.State ?? c.Location?.InternationalProvince, 100),
                                City = city,
                                PinCode = Truncate(c.Address?.PostalCode, 50),
                                Website = Truncate(c.Website, 500),
                                Email = Truncate(c.Email, 200),
                                Lat = lat,
                                Lng = lng,
                            });
                    }

                    existingClubIds.Add(rotaryId);
                    st.Inserted++;
                    inserted.Add(new InsertedRow
                    {
                        ClubRotaryId = rotaryId,
                        ClubName = c.ClubName ?? "",
                        DistrictNumber = districtNumber,
                        Country = clubCountry,
                        City = city ?? "",
                        NewDistrict = createdDistrict,
                    });
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    errorCount++;
                    st.Skipped++;
                    skipped.Add(new SkippedRow { ClubRotaryId = rotaryId, ClubName = c.ClubName ?? "", Country = clubCountry, DistrictNumber = districtNumber, Reason = "Insert error: " + ex.Message });
                    _logger.LogError(ex, "World clubs: insert failed for {ClubId}", rotaryId);
                }
            }

            var elapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === World Clubs Import {(dryRun ? "DRY RUN" : "APPLY")} DONE in {elapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Countries searched:          {countries.Count} (skipped: {string.Join(", ", SkipCountries)})");
            Console.WriteLine($"  Countries failed (API):      {failedCountries.Count}");
            Console.WriteLine($"  Countries with 0 clubs:      {zeroCountries.Count}");
            Console.WriteLine($"  Unique clubs on Rotary.org:  {unique.Count}");
            Console.WriteLine($"  Already in DB (untouched):   {alreadyInDb}");
            Console.WriteLine($"  {(dryRun ? "Would insert" : "Inserted")} clubs:        {inserted.Count}");
            Console.WriteLine($"  {(dryRun ? "Would create" : "Created")} districts:     {newDistricts.Count}");
            Console.WriteLine($"  Skipped clubs:               {skipped.Count}");
            Console.WriteLine($"  Errors:                      {errorCount}");

            if (!dryRun)
                await dbConn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                        TotalFetched = @Total, InsertedCount = @Ins,
                        SkippedDistrictMissing = @Skip, ErrorCount = @Err
                    WHERE pk_id = @Id",
                    new { Id = logId, Total = unique.Count, Ins = inserted.Count, Skip = skipped.Count, Err = errorCount });

            await SendEmailReportAsync(dryRun, logId, elapsed, countries.Count, unique.Count, alreadyInDb,
                stats.Values.ToList(), inserted, newDistricts, skipped, failedCountries, zeroCountries, errorCount);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] WORLD CLUBS IMPORT FAILED: {ex.Message}");
            _logger.LogError(ex, "World clubs import FAILED");
            if (!dryRun)
            {
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
            }
            throw;
        }
    }

    private async Task SendEmailReportAsync(
        bool dryRun, int logId, TimeSpan elapsed, int countriesSearched, int uniqueClubs, int alreadyInDb,
        List<CountryStat> stats, List<InsertedRow> inserted, List<(string DistrictNumber, string Country)> newDistricts,
        List<SkippedRow> skipped, List<(string Country, string Error)> failedCountries, List<string> zeroCountries, int errorCount)
    {
        try
        {
            using var wb = new XLWorkbook();

            var s = wb.Worksheets.Add("Summary");
            s.Cell(1, 1).Value = $"Rotary.org World Clubs Import{(dryRun ? " — DRY RUN (no DB changes)" : "")}";
            s.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            var summaryRows = new (string, object)[]
            {
                ("Log ID", dryRun ? "(dry run)" : logId.ToString()),
                ("Duration (min)", Math.Round(elapsed.TotalMinutes, 1)),
                ("Countries searched", countriesSearched),
                ("Countries skipped (owned by --country-sync)", string.Join(", ", SkipCountries)),
                ("Countries failed (API)", failedCountries.Count),
                ("Countries with 0 clubs", zeroCountries.Count),
                ("Unique clubs on Rotary.org", uniqueClubs),
                ("Already in DB (untouched)", alreadyInDb),
                (dryRun ? "Clubs that would be inserted" : "Clubs inserted", inserted.Count),
                (dryRun ? "Districts that would be created" : "Districts created (Other Zones)", newDistricts.Count),
                ("Clubs skipped", skipped.Count),
                ("Errors", errorCount),
            };
            for (int i = 0; i < summaryRows.Length; i++)
            {
                s.Cell(i + 3, 1).Value = summaryRows[i].Item1;
                s.Cell(i + 3, 2).Value = XLCellValue.FromObject(summaryRows[i].Item2);
            }
            s.Columns().AdjustToContents();

            var pc = wb.Worksheets.Add("Per Country");
            WriteHeader(pc, "Country", "Found (unique)", dryRun ? "Would Insert" : "Inserted", "Already in DB", "Skipped", "Status");
            int r = 2;
            foreach (var x in stats.OrderByDescending(x => x.Inserted).ThenBy(x => x.Country, StringComparer.OrdinalIgnoreCase))
            {
                pc.Cell(r, 1).Value = x.Country; pc.Cell(r, 2).Value = x.Found; pc.Cell(r, 3).Value = x.Inserted;
                pc.Cell(r, 4).Value = x.AlreadyInDb; pc.Cell(r, 5).Value = x.Skipped; pc.Cell(r, 6).Value = x.Status;
                r++;
            }
            pc.Columns().AdjustToContents();

            var ins = wb.Worksheets.Add(dryRun ? "Would Insert" : "Inserted Clubs");
            WriteHeader(ins, "ClubRotaryId", "Club Name", "District", "Country", "City", "New District");
            r = 2;
            foreach (var x in inserted.OrderBy(x => x.Country).ThenBy(x => x.DistrictNumber).ThenBy(x => x.ClubName))
            {
                ins.Cell(r, 1).Value = x.ClubRotaryId; ins.Cell(r, 2).Value = x.ClubName; ins.Cell(r, 3).Value = x.DistrictNumber;
                ins.Cell(r, 4).Value = x.Country; ins.Cell(r, 5).Value = x.City; ins.Cell(r, 6).Value = x.NewDistrict ? "Yes" : "";
                r++;
            }
            ins.Columns().AdjustToContents();

            var nd = wb.Worksheets.Add("New Districts");
            WriteHeader(nd, "District Number", "Country (first club)", "Zone");
            r = 2;
            foreach (var x in newDistricts.OrderBy(x => x.DistrictNumber))
            {
                nd.Cell(r, 1).Value = x.DistrictNumber; nd.Cell(r, 2).Value = x.Country; nd.Cell(r, 3).Value = OtherZonesName;
                r++;
            }
            nd.Columns().AdjustToContents();

            var sk = wb.Worksheets.Add("Skipped");
            WriteHeader(sk, "ClubRotaryId", "Club Name", "Country", "District", "Reason");
            r = 2;
            foreach (var x in skipped)
            {
                sk.Cell(r, 1).Value = x.ClubRotaryId; sk.Cell(r, 2).Value = x.ClubName; sk.Cell(r, 3).Value = x.Country;
                sk.Cell(r, 4).Value = x.DistrictNumber; sk.Cell(r, 5).Value = x.Reason;
                r++;
            }
            sk.Columns().AdjustToContents();

            var fc = wb.Worksheets.Add("Country Issues");
            WriteHeader(fc, "Country", "Issue");
            r = 2;
            foreach (var x in failedCountries) { fc.Cell(r, 1).Value = x.Country; fc.Cell(r, 2).Value = "API error: " + x.Error; r++; }
            foreach (var x in zeroCountries) { fc.Cell(r, 1).Value = x; fc.Cell(r, 2).Value = "0 clubs returned — check country name"; r++; }
            fc.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            var fileName = $"RotaryOrg_WorldClubs{(dryRun ? "_DryRun" : "")}_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            string Row(string label, object value, string color = "#0f172a") =>
                $"<tr><td style='padding:4px 12px;'>{label}</td><td style='padding:4px 12px;color:{color};'><b>{value}</b></td></tr>";

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org World Clubs Import{(dryRun ? " — DRY RUN" : "")}</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>{(dryRun ? "Dry run complete — <b>no database changes were made</b>. Below is what a real run would do:" : "World clubs import complete. Summary:")}</p>
<table style='border-collapse:collapse;margin:12px 0;'>
{Row("Duration", $"{Math.Round(elapsed.TotalMinutes, 1)} min")}
{Row("Countries searched", countriesSearched)}
{Row("Countries failed (API)", failedCountries.Count, failedCountries.Count > 0 ? "#dc2626" : "#0f172a")}
{Row("Countries with 0 clubs", zeroCountries.Count, "#64748b")}
{Row("Unique clubs on Rotary.org", uniqueClubs)}
{Row("Already in DB (untouched)", alreadyInDb, "#64748b")}
{Row(dryRun ? "Clubs that would be inserted" : "Clubs inserted", inserted.Count, "#16a34a")}
{Row(dryRun ? "Districts that would be created" : "Districts created (Other Zones)", newDistricts.Count, "#0ea5e9")}
{Row("Clubs skipped", skipped.Count, skipped.Count > 0 ? "#d97706" : "#0f172a")}
{Row("Errors", errorCount, errorCount > 0 ? "#dc2626" : "#0f172a")}
</table>
<p style='color:#64748b;font-size:13px;'>New clubs are NON-SYNC (<code>IsSyncedFromRotaryOrg=0</code>) — club row only: no members, no BOD, no modules.
Existing clubs were not touched. India / Sri Lanka / Nepal are handled by the daily country sync.
Full breakdown is in the attached Excel.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync(
                $"{(dryRun ? "[DRY RUN] " : "")}ROW World Clubs Import — {DateTime.Now:dd MMM yyyy}",
                body, ms.ToArray(), fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "World clubs email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private static void WriteHeader(IXLWorksheet ws, params string[] headers)
    {
        for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        ws.Range(1, 1, 1, headers.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
    }

    private static bool IsMeetingAddress(RotaryOrgSearchAddressDto? a)
        => a?.AddressType != null && a.AddressType.Contains("Meeting", StringComparison.OrdinalIgnoreCase);

    private static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static string? Truncate(string? value, int maxLen)
    {
        var t = Clean(value);
        if (t == null) return null;
        return t.Length <= maxLen ? t : t.Substring(0, maxLen);
    }

    // Venue name + address lines, same shape the sync path stores ("Wisdom Chamber, Line1, Line2").
    private static string? BuildMeetingAddress(RotaryOrgSearchAddressDto? addr)
    {
        if (addr == null) return null;
        var parts = new[] { addr.MeetingName, addr.AddressLine1, addr.AddressLine2 }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim())
            .ToList();
        return parts.Count == 0 ? null : string.Join(", ", parts);
    }

    // 0/0 and out-of-range coordinates mean "not set" — store NULL rather than a bogus pin.
    private static (decimal? Lat, decimal? Lng) ValidLatLng(double? lat, double? lng)
    {
        if (lat == null || lng == null) return (null, null);
        if (double.IsNaN(lat.Value) || double.IsNaN(lng.Value)) return (null, null);
        if (lat.Value == 0 && lng.Value == 0) return (null, null);
        if (lat.Value < -90 || lat.Value > 90 || lng.Value < -180 || lng.Value > 180) return (null, null);
        return (Math.Round((decimal)lat.Value, 7), Math.Round((decimal)lng.Value, 7));
    }

    // "Thu" / "thurs" / "THURSDAY" → "Thursday"; unknown values kept as sent; blank → null.
    private static string? NormalizeMeetingDay(string? raw)
    {
        var s = Clean(raw);
        if (s == null) return null;
        var l = s.ToLowerInvariant();
        string[] days = { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" };
        foreach (var d in days)
            if (l.StartsWith(d.Substring(0, 3).ToLowerInvariant())) return d;
        return s;
    }

    private static TimeSpan? ParseTimeFromHHMM(string? raw)
    {
        var s = Clean(raw);
        if (s == null) return null;
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
}
