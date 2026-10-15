using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/admin/directory-config")]
[Authorize]
public class DirectoryDataCollectionController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IEmailService _email;
    private readonly IWhatsAppService _whatsapp;
    private readonly ILogger<DirectoryDataCollectionController> _logger;
    private readonly IConfiguration _config;
    private readonly string _apiBase;

    public DirectoryDataCollectionController(
        IConfiguration config,
        IEmailService email,
        IWhatsAppService whatsapp,
        ILogger<DirectoryDataCollectionController> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _whatsapp = whatsapp;
        _logger = logger;
        _config = config;
        // Image URLs embedded in reminder emails were resolving to localhost:5000
        // whenever the Api section wasn't loaded — recipient saw broken images.
        // BackendUrl is set in both appsettings files, so this always lands on
        // portal.example.org/API even if env=Production isn't applied.
        _apiBase = config["Api:BaseUrl"]
                   ?? config["BackendUrl"]
                   ?? RotaryApi.Services.Brand.ApiOrigin;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // Return the full member-field metadata (auto-grows as fields are added in DirectoryDataCollectionFields.cs)
    [HttpGet("member-fields")]
    public ActionResult GetMemberFields()
    {
        if (!IsSuperAdmin()) return Forbid();
        var sections = DirectoryDataCollectionFields.AllFields
            .GroupBy(f => f.Section)
            .Select(g => new
            {
                section = g.Key,
                fields = g.Select(f => new
                {
                    key = f.Key,
                    label = f.Label,
                    type = f.Type,
                }).ToList()
            })
            .ToList();
        return Ok(sections);
    }

    public record ConfigListRow(
        int Id, int DistrictId, string DistrictNumber, int YearId, string YearLabel,
        string UrlHash, string? FirstContactName, string? FirstContactMobile,
        string? SecondContactName, string? SecondContactMobile,
        long SendEmail, long SendWhatsapp, long IsActive,
        DateTime CreatedDate, DateTime? ModifiedDate);

    [HttpGet]
    public async Task<ActionResult> GetList([FromQuery] int? districtId, [FromQuery] int? yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<ConfigListRow>(@"
            SELECT c.pk_id AS Id, c.fk_district_id AS DistrictId, d.DistrictNumber,
                   c.fk_year_id AS YearId, y.YearLabel,
                   c.UrlHash, c.FirstContactName, c.FirstContactMobile,
                   c.SecondContactName, c.SecondContactMobile,
                   CAST(COALESCE(c.SendEmail, 1) AS SIGNED) AS SendEmail, CAST(COALESCE(c.SendWhatsapp, 1) AS SIGNED) AS SendWhatsapp,
                   CAST(COALESCE(c.IsActive, 1) AS SIGNED) AS IsActive,
                   c.created_date AS CreatedDate, c.modified_date AS ModifiedDate
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.isdeleted = 0
              AND (@districtId IS NULL OR c.fk_district_id = @districtId)
              AND (@yearId IS NULL OR c.fk_year_id = @yearId)
            ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { districtId, yearId });
        return Ok(rows);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult> GetById(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.pk_id AS id, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   c.fk_year_id AS yearId, y.YearLabel AS yearLabel,
                   c.UrlHash AS urlHash,
                   c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile,
                   (c.FirstContactPasswordHash IS NOT NULL AND c.FirstContactPasswordHash <> '') AS isFirstContactPasswordSet,
                   c.SecondContactName AS secondContactName, c.SecondContactMobile AS secondContactMobile,
                   (c.SecondContactPasswordHash IS NOT NULL AND c.SecondContactPasswordHash <> '') AS isSecondContactPasswordSet,
                   c.DcFieldsJson AS dcFieldsJson, c.BodFieldsJson AS bodFieldsJson, c.MemberFieldsJson AS memberFieldsJson,
                   COALESCE(c.SendEmail, 1) AS sendEmail, COALESCE(c.SendWhatsapp, 1) AS sendWhatsapp,
                   c.created_date AS createdDate, c.modified_date AS modifiedDate
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.pk_id = @id AND c.isdeleted = 0",
            new { id });
        if (row == null) return NotFound();

        var dict = (IDictionary<string, object?>)row;
        dict["dcFields"] = DirectoryDataCollectionFields.DeserializeKeys(dict["dcFieldsJson"] as string);
        dict["bodFields"] = DirectoryDataCollectionFields.DeserializeKeys(dict["bodFieldsJson"] as string);
        dict["memberFields"] = DirectoryDataCollectionFields.DeserializeKeys(dict["memberFieldsJson"] as string);
        return Ok(row);
    }

    public class ConfigUpsertRequest
    {
        public int DistrictId { get; set; }
        public int YearId { get; set; }
        public string? FirstContactName { get; set; }
        public string? FirstContactMobile { get; set; }
        public string? SecondContactName { get; set; }
        public string? SecondContactMobile { get; set; }
        // Admin-proxy passwords. On Create: the values are hashed and stored. On Update: a non-empty
        // value REPLACES the existing hash; blank = keep current. SuperAdmin sets these so the 2 contact
        // persons can fill the public form on behalf of members (used by ?fetch=admin URL flow).
        public string? FirstContactPassword { get; set; }
        public string? SecondContactPassword { get; set; }
        public List<string> DcFields { get; set; } = new();
        public List<string> BodFields { get; set; } = new();
        public List<string> MemberFields { get; set; } = new();
        // Per-district notification toggles — gate the reminder batch + the post-submit confirmation
        // Email / WhatsApp for this district. OTP is NOT affected. Default true (send).
        public bool SendEmail { get; set; } = true;
        public bool SendWhatsapp { get; set; } = true;
    }

    [HttpPost]
    public async Task<ActionResult> Create([FromBody] ConfigUpsertRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.DistrictId <= 0 || req.YearId <= 0) return BadRequest(new { message = "DistrictId and YearId are required" });
        if (string.IsNullOrWhiteSpace(req.FirstContactName) || string.IsNullOrWhiteSpace(req.FirstContactMobile))
            return BadRequest(new { message = "First Contact Name and First Contact Mobile are required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var dup = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM district_directory_config
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0",
            new { req.DistrictId, req.YearId });
        if (dup > 0) return Conflict(new { message = "A config already exists for this district + year. Edit it instead." });

        var urlHash = GenerateUrlHash();
        var userId = GetUserId();

        var firstHash = !string.IsNullOrEmpty(req.FirstContactPassword) ? AdminProxyAuth.HashPassword(req.FirstContactPassword) : null;
        var secondHash = !string.IsNullOrEmpty(req.SecondContactPassword) ? AdminProxyAuth.HashPassword(req.SecondContactPassword) : null;

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_directory_config
                (fk_district_id, fk_year_id, UrlHash,
                 FirstContactName, FirstContactMobile, FirstContactPasswordHash,
                 SecondContactName, SecondContactMobile, SecondContactPasswordHash,
                 DcFieldsJson, BodFieldsJson, MemberFieldsJson, SendEmail, SendWhatsapp, created_by)
            VALUES (@DistrictId, @YearId, @UrlHash,
                    @FirstContactName, @FirstContactMobile, @FirstHash,
                    @SecondContactName, @SecondContactMobile, @SecondHash,
                    @Dc, @Bod, @Mem, @SendEmail, @SendWhatsapp, @UserId);
            SELECT LAST_INSERT_ID();",
            new
            {
                req.DistrictId,
                req.YearId,
                UrlHash = urlHash,
                req.FirstContactName,
                req.FirstContactMobile,
                FirstHash = firstHash,
                req.SecondContactName,
                req.SecondContactMobile,
                SecondHash = secondHash,
                Dc = DirectoryDataCollectionFields.SerializeKeys(req.DcFields),
                Bod = DirectoryDataCollectionFields.SerializeKeys(req.BodFields),
                Mem = DirectoryDataCollectionFields.SerializeKeys(req.MemberFields),
                SendEmail = req.SendEmail,
                SendWhatsapp = req.SendWhatsapp,
                UserId = userId
            });

        return Ok(new { id, urlHash });
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult> Update(int id, [FromBody] ConfigUpsertRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(req.FirstContactName) || string.IsNullOrWhiteSpace(req.FirstContactMobile))
            return BadRequest(new { message = "First Contact Name and First Contact Mobile are required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_directory_config WHERE pk_id = @id AND isdeleted = 0",
            new { id });
        if (exists == 0) return NotFound();

        // Hash only if a non-empty password came through; null = "no change" so we don't blow away the existing hash.
        var firstHash = !string.IsNullOrEmpty(req.FirstContactPassword) ? AdminProxyAuth.HashPassword(req.FirstContactPassword) : null;
        var secondHash = !string.IsNullOrEmpty(req.SecondContactPassword) ? AdminProxyAuth.HashPassword(req.SecondContactPassword) : null;

        await conn.ExecuteAsync(@"
            UPDATE district_directory_config SET
                FirstContactName = @FirstContactName,
                FirstContactMobile = @FirstContactMobile,
                FirstContactPasswordHash = COALESCE(@FirstHash, FirstContactPasswordHash),
                SecondContactName = @SecondContactName,
                SecondContactMobile = @SecondContactMobile,
                SecondContactPasswordHash = COALESCE(@SecondHash, SecondContactPasswordHash),
                DcFieldsJson = @Dc,
                BodFieldsJson = @Bod,
                MemberFieldsJson = @Mem,
                SendEmail = @SendEmail,
                SendWhatsapp = @SendWhatsapp,
                modified_by = @UserId
            WHERE pk_id = @id",
            new
            {
                id,
                req.FirstContactName,
                req.FirstContactMobile,
                FirstHash = firstHash,
                req.SecondContactName,
                req.SecondContactMobile,
                SecondHash = secondHash,
                Dc = DirectoryDataCollectionFields.SerializeKeys(req.DcFields),
                Bod = DirectoryDataCollectionFields.SerializeKeys(req.BodFields),
                Mem = DirectoryDataCollectionFields.SerializeKeys(req.MemberFields),
                SendEmail = req.SendEmail,
                SendWhatsapp = req.SendWhatsapp,
                UserId = GetUserId()
            });

        return Ok(new { id });
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Parity with the UI: a live (enabled) link can't be deleted — close it first.
        var isActive = await conn.QueryFirstOrDefaultAsync<int?>(
            "SELECT COALESCE(IsActive, 1) FROM district_directory_config WHERE pk_id = @id AND isdeleted = 0",
            new { id });
        if (isActive == null) return NotFound();
        if (isActive == 1) return Conflict(new { message = "Close (disable) the link before deleting it." });
        var n = await conn.ExecuteAsync(@"
            UPDATE district_directory_config SET isdeleted = 1, modified_by = @u WHERE pk_id = @id AND isdeleted = 0",
            new { id, u = GetUserId() });
        if (n == 0) return NotFound();
        return Ok(new { id, deleted = true });
    }

    // Enable / disable the public collection link. Disabled → the public form shows
    // "Link is closed" and every public action is blocked (see PublicDirectoryController).
    [HttpPut("{id:int}/toggle-active")]
    public async Task<ActionResult> ToggleActive(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var n = await conn.ExecuteAsync(@"
            UPDATE district_directory_config
            SET IsActive = IF(COALESCE(IsActive, 1) = 1, 0, 1), modified_by = @u
            WHERE pk_id = @id AND isdeleted = 0",
            new { id, u = GetUserId() });
        if (n == 0) return NotFound();
        var isActive = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(IsActive, 1) FROM district_directory_config WHERE pk_id = @id", new { id });
        return Ok(new { id, isActive, message = isActive == 1 ? "Link enabled." : "Link disabled — the public form now shows \"Link is closed\"." });
    }

    // Send Email / WhatsApp reminders to every member with <100% completion for their group
    [HttpPost("{id:int}/send-reminders")]
    public async Task<ActionResult> SendReminders(int id, [FromQuery] string channel = "both")
    {
        if (!IsSuperAdmin()) return Forbid();
        if (channel != "email" && channel != "whatsapp" && channel != "both")
            return BadRequest(new { message = "channel must be email|whatsapp|both" });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadConfig(conn, id);
        if (cfg == null) return NotFound();

        // Fire-and-forget — don't block the HTTP response
        var publicBase = _config["PublicFrontend:BaseUrl"]
                         ?? _config["FrontendUrl"]
                         ?? RotaryApi.Services.Brand.PortalOrigin;
        _ = Task.Run(() => SendRemindersBackgroundAsync(cfg, channel, publicBase));
        return Ok(new { message = "Reminders queued. They will be sent in background." });
    }

    private async Task SendRemindersBackgroundAsync(ConfigRecord cfg, string channel, string publicBase)
    {
        int emailOk = 0, emailFail = 0, waOk = 0, waFail = 0, skippedComplete = 0, skippedNoFields = 0, processed = 0;
        try
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();

            var members = await GetDistrictMembersAsync(conn, cfg.DistrictId);
            var url = $"{publicBase.TrimEnd('/')}/public/directory-data-collection?ID={cfg.UrlHash}";

            // Bulk-load spouse-not-applicable flags for this config so each member iteration is one DB call lighter.
            var spouseNaMap = await DirectoryDataCollectionFields.GetSpouseNotApplicableMapAsync(conn, cfg.Id);

            _logger.LogInformation("🔔 REMINDER BATCH START — config={ConfigId} district={District} year={Year} channel={Channel} members={Count}",
                cfg.Id, cfg.DistrictNumber, cfg.YearLabel, channel, members.Count);

            foreach (var m in members)
            {
                try
                {
                    var group = await DirectoryDataCollectionFields.ResolveGroupAsync(conn, m.MemberId, cfg.DistrictId, cfg.YearId);
                    var rawKeys = DirectoryDataCollectionFields.GroupKeys(group, cfg.DcFieldsJson, cfg.BodFieldsJson, cfg.MemberFieldsJson);
                    if (rawKeys.Count == 0) { skippedNoFields++; continue; }

                    bool memberSpouseNa = spouseNaMap.TryGetValue(m.MemberId, out var f) && f;
                    var keys = DirectoryDataCollectionFields.ApplySpouseNotApplicable(rawKeys, memberSpouseNa);

                    var values = await DirectoryDataCollectionFields.LoadValuesAsync(conn, m.MemberId, keys);
                    var (filled, total, pending) = DirectoryDataCollectionFields.ComputeCompletion(values, keys);
                    if (filled >= total) { skippedComplete++; continue; }

                    processed++;
                    if (channel is "email" or "both" && cfg.SendEmail != 0 && !string.IsNullOrWhiteSpace(m.Email))
                    {
                        var detailedHtml = DirectoryDataCollectionFields.BuildCompletedAndPendingHtml(keys, values, _apiBase);
                        var contactTextEmail = DirectoryDataCollectionFields.BuildContactText(
                            cfg.FirstContactName, cfg.FirstContactMobile, cfg.SecondContactName, cfg.SecondContactMobile);
                        var html = BuildReminderHtml(m.Name, cfg.YearLabel, cfg.DistrictNumber, filled, total, detailedHtml, url, contactTextEmail);
                        try
                        {
                            await _email.SendGenericEmailAsync(m.Email, $"District Directory {cfg.YearLabel} — Data Collection Reminder", html);
                            emailOk++;
                            _logger.LogInformation("📧 [EMAIL] ✅ {Member} → {Email} ({Group}, {Pending}/{Total} pending)",
                                m.Name, m.Email, group, pending.Count, total);
                        }
                        catch (Exception ex)
                        {
                            emailFail++;
                            _logger.LogWarning("📧 [EMAIL] ❌ {Member} → {Email} FAILED: {Error}", m.Name, m.Email, ex.Message);
                        }
                    }
                    if (channel is "whatsapp" or "both" && cfg.SendWhatsapp != 0 && !string.IsNullOrWhiteSpace(m.Mobile))
                    {
                        var pendingList = string.Join("\n", pending.Select((p, i) => $"{i + 1}) {p}"));
                        var contactText = DirectoryDataCollectionFields.BuildContactText(
                            cfg.FirstContactName, cfg.FirstContactMobile, cfg.SecondContactName, cfg.SecondContactMobile);
                        var bodyValues = new[]
                        {
                            m.Name ?? "",                         // {{1}} Member Name
                            cfg.YearLabel,                         // {{2}} Rotary Year
                            cfg.DistrictNumber,                    // {{3}} District Number
                            pending.Count.ToString(),              // {{4}} Pending fields count
                            total.ToString(),                      // {{5}} Total fields count
                            pendingList,                           // {{6}} Pending fields list
                            url,                                   // {{7}} Link
                            contactText,                           // {{8}} Contact details
                        };
                        try
                        {
                            var sent = await _whatsapp.SendWhatsAppWithBodyValuesAsync(m.Mobile, "district_directory_form_incomplete_final", bodyValues);
                            if (sent) { waOk++; _logger.LogInformation("💬 [WHATSAPP] ✅ {Member} → {Mobile} ({Group}, {Pending}/{Total} pending)", m.Name, m.Mobile, group, pending.Count, total); }
                            else { waFail++; _logger.LogWarning("💬 [WHATSAPP] ❌ {Member} → {Mobile} returned false (check the Meta template and account)", m.Name, m.Mobile); }
                        }
                        catch (Exception ex)
                        {
                            waFail++;
                            _logger.LogWarning("💬 [WHATSAPP] ❌ {Member} → {Mobile} FAILED: {Error}", m.Name, m.Mobile, ex.Message);
                        }
                    }
                }
                catch (Exception ex) { _logger.LogWarning(ex, "Reminder failed for member {MemberId}", m.MemberId); }
            }
        }
        catch (Exception ex) { _logger.LogError(ex, "SendRemindersBackgroundAsync failed for config {ConfigId}", cfg.Id); }
        finally
        {
            _logger.LogInformation("🔔 REMINDER BATCH DONE — config={ConfigId} processed={Processed} skippedComplete={SkipComplete} skippedNoFields={SkipNoFields} | 📧 email: ✅{EmailOk} ❌{EmailFail} | 💬 whatsapp: ✅{WaOk} ❌{WaFail}",
                cfg.Id, processed, skippedComplete, skippedNoFields, emailOk, emailFail, waOk, waFail);
        }
    }

    // Report: returns overall stats + per-member completion list, split by group
    [HttpGet("{id:int}/report")]
    public async Task<ActionResult> GetReport(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadConfig(conn, id);
        if (cfg == null) return NotFound();

        var members = await GetDistrictMembersAsync(conn, cfg.DistrictId);
        var spouseNaMap = await DirectoryDataCollectionFields.GetSpouseNotApplicableMapAsync(conn, cfg.Id);
        var dcRows = new List<object>();
        var bodRows = new List<object>();
        var memRows = new List<object>();
        int dcFilled = 0, dcTotal = 0, bodFilled = 0, bodTotal = 0, memFilled = 0, memTotal = 0;

        foreach (var m in members)
        {
            var group = await DirectoryDataCollectionFields.ResolveGroupAsync(conn, m.MemberId, cfg.DistrictId, cfg.YearId);
            var rawKeys = DirectoryDataCollectionFields.GroupKeys(group, cfg.DcFieldsJson, cfg.BodFieldsJson, cfg.MemberFieldsJson);
            if (rawKeys.Count == 0) continue;

            bool memberSpouseNa = spouseNaMap.TryGetValue(m.MemberId, out var fl) && fl;
            var keys = DirectoryDataCollectionFields.ApplySpouseNotApplicable(rawKeys, memberSpouseNa);
            bool hadSpouseFields = DirectoryDataCollectionFields.ConfigIncludesSpouseFields(rawKeys);

            var values = await DirectoryDataCollectionFields.LoadValuesAsync(conn, m.MemberId, keys);
            var (filled, total, pending) = DirectoryDataCollectionFields.ComputeCompletion(values, keys);
            var pct = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0;

            var row = new
            {
                memberId = m.MemberId,
                name = m.Name,
                mobile = m.Mobile,
                email = m.Email,
                clubName = m.ClubName,
                filled,
                total,
                percent = pct,
                pendingFields = pending,
                spouseApplicable = !memberSpouseNa,
                spouseInConfig = hadSpouseFields,
            };

            if (group == "DC") { dcRows.Add(row); dcFilled += filled; dcTotal += total; }
            else if (group == "BOD") { bodRows.Add(row); bodFilled += filled; bodTotal += total; }
            else { memRows.Add(row); memFilled += filled; memTotal += total; }
        }

        int Pct(int f, int t) => t > 0 ? (int)Math.Round(100.0 * f / t) : 0;
        return Ok(new
        {
            config = new { cfg.Id, cfg.DistrictNumber, cfg.YearLabel, cfg.UrlHash },
            summary = new
            {
                dc = new { count = dcRows.Count, filled = dcFilled, total = dcTotal, percent = Pct(dcFilled, dcTotal) },
                bod = new { count = bodRows.Count, filled = bodFilled, total = bodTotal, percent = Pct(bodFilled, bodTotal) },
                member = new { count = memRows.Count, filled = memFilled, total = memTotal, percent = Pct(memFilled, memTotal) },
            },
            dc = dcRows,
            bod = bodRows,
            member = memRows,
        });
    }

    // Excel export: 3 sheets — DC, BOD, Members
    [HttpGet("{id:int}/report/excel")]
    public async Task<ActionResult> GetReportExcel(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadConfig(conn, id);
        if (cfg == null) return NotFound();

        var members = await GetDistrictMembersAsync(conn, cfg.DistrictId);
        var spouseNaMap = await DirectoryDataCollectionFields.GetSpouseNotApplicableMapAsync(conn, cfg.Id);
        var dc = new List<(string name, string? mobile, string? email, string? club, int filled, int total, int pct, string pending, string spouseApplicable)>();
        var bod = new List<(string name, string? mobile, string? email, string? club, int filled, int total, int pct, string pending, string spouseApplicable)>();
        var mem = new List<(string name, string? mobile, string? email, string? club, int filled, int total, int pct, string pending, string spouseApplicable)>();

        // Parallelise the per-member completion lookups (bounded concurrency; each task uses its OWN
        // pooled connection). Same queries + same output as the sequential loop, but not one-at-a-time —
        // cuts a big district's wall-time from N*latency to ~(N/concurrency)*latency, which matters a lot
        // when the DB is remote. Results are placed by index so the report keeps member order.
        var slots = new (string group, (string, string?, string?, string?, int, int, int, string, string) row)?[members.Count];
        using (var gate = new System.Threading.SemaphoreSlim(12))
        {
            await Task.WhenAll(members.Select(async (m, idx) =>
            {
                await gate.WaitAsync();
                try
                {
                    await using var c = CreateConnection();
                    await c.OpenAsync();
                    var group = await DirectoryDataCollectionFields.ResolveGroupAsync(c, m.MemberId, cfg.DistrictId, cfg.YearId);
                    var rawKeys = DirectoryDataCollectionFields.GroupKeys(group, cfg.DcFieldsJson, cfg.BodFieldsJson, cfg.MemberFieldsJson);
                    if (rawKeys.Count == 0) return;

                    bool memberSpouseNa = spouseNaMap.TryGetValue(m.MemberId, out var fl) && fl;
                    var keys = DirectoryDataCollectionFields.ApplySpouseNotApplicable(rawKeys, memberSpouseNa);
                    bool hadSpouseFields = DirectoryDataCollectionFields.ConfigIncludesSpouseFields(rawKeys);

                    var values = await DirectoryDataCollectionFields.LoadValuesAsync(c, m.MemberId, keys);
                    var (filled, total, pending) = DirectoryDataCollectionFields.ComputeCompletion(values, keys);
                    var pct = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0;
                    // Spouse-Applicable column: "—" when this config has no spouse fields; otherwise Yes / No.
                    var spouseLabel = !hadSpouseFields ? "—" : (memberSpouseNa ? "No" : "Yes");
                    slots[idx] = (group, (m.Name, m.Mobile, m.Email, m.ClubName, filled, total, pct, string.Join(", ", pending), spouseLabel));
                }
                finally { gate.Release(); }
            }));
        }
        foreach (var s in slots)
        {
            if (s == null) continue;
            var (group, row) = s.Value;
            if (group == "DC") dc.Add(row);
            else if (group == "BOD") bod.Add(row);
            else mem.Add(row);
        }

        using var wb = new XLWorkbook();
        void AddSheet(string title, List<(string name, string? mobile, string? email, string? club, int filled, int total, int pct, string pending, string spouseApplicable)> rows)
        {
            var ws = wb.Worksheets.Add(title);
            ws.Cell(1, 1).Value = $"District {cfg.DistrictNumber} — {cfg.YearLabel} — {title}";
            ws.Range(1, 1, 1, 9).Merge().Style
                .Font.SetBold().Font.SetFontSize(14)
                .Alignment.SetHorizontal(XLAlignmentHorizontalValues.Center);

            var headers = new[] { "Sr", "Name", "Mobile", "Email", "Club", "Filled / Total", "%", "Spouse Applicable", "Pending Fields" };
            for (int i = 0; i < headers.Length; i++)
            {
                var c = ws.Cell(3, i + 1);
                c.Value = headers[i];
                c.Style.Font.Bold = true;
                c.Style.Fill.BackgroundColor = XLColor.LightGray;
                c.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
            }
            int r = 4;
            for (int i = 0; i < rows.Count; i++)
            {
                var x = rows[i];
                ws.Cell(r, 1).Value = i + 1;
                ws.Cell(r, 2).Value = x.name;
                ws.Cell(r, 3).Value = x.mobile ?? "";
                ws.Cell(r, 4).Value = x.email ?? "";
                ws.Cell(r, 5).Value = x.club ?? "";
                ws.Cell(r, 6).Value = $"{x.filled} / {x.total}";
                ws.Cell(r, 7).Value = $"{x.pct}%";
                ws.Cell(r, 8).Value = x.spouseApplicable;
                ws.Cell(r, 9).Value = x.pending;
                r++;
            }
            ws.Columns().AdjustToContents();
            ws.Column(9).Width = 60;
        }

        AddSheet("DC (District Committee)", dc);
        AddSheet("BOD (Pres+Sec)", bod);
        AddSheet("Members", mem);

        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        var bytes = stream.ToArray();
        var fileName = $"DistrictDirectory_{cfg.DistrictNumber}_{cfg.YearLabel}.xlsx".Replace("/", "-");
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    // Copy-URL helper endpoint — returns the public URL
    [HttpGet("{id:int}/public-url")]
    public async Task<ActionResult> GetPublicUrl(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var hash = await conn.ExecuteScalarAsync<string>(
            "SELECT UrlHash FROM district_directory_config WHERE pk_id = @id AND isdeleted = 0",
            new { id });
        if (string.IsNullOrEmpty(hash)) return NotFound();
        var baseUrl = _config["PublicFrontend:BaseUrl"]
                      ?? _config["FrontendUrl"]
                      ?? RotaryApi.Services.Brand.PortalOrigin;
        return Ok(new { url = $"{baseUrl.TrimEnd('/')}/public/directory-data-collection?ID={hash}" });
    }

    // ---------- helpers ----------

    private record ConfigRecord(
        int Id, int DistrictId, string DistrictNumber, int YearId, string YearLabel,
        string UrlHash, string DcFieldsJson, string BodFieldsJson, string MemberFieldsJson,
        string? FirstContactName, string? FirstContactMobile,
        string? SecondContactName, string? SecondContactMobile,
        long SendEmail, long SendWhatsapp);

    private static async Task<ConfigRecord?> LoadConfig(MySqlConnection conn, int id)
    {
        return await conn.QueryFirstOrDefaultAsync<ConfigRecord>(@"
            SELECT c.pk_id AS Id, c.fk_district_id AS DistrictId, d.DistrictNumber,
                   c.fk_year_id AS YearId, y.YearLabel,
                   c.UrlHash,
                   COALESCE(c.DcFieldsJson, '[]') AS DcFieldsJson,
                   COALESCE(c.BodFieldsJson, '[]') AS BodFieldsJson,
                   COALESCE(c.MemberFieldsJson, '[]') AS MemberFieldsJson,
                   c.FirstContactName, c.FirstContactMobile,
                   c.SecondContactName, c.SecondContactMobile,
                   CAST(COALESCE(c.SendEmail, 1) AS SIGNED) AS SendEmail, CAST(COALESCE(c.SendWhatsapp, 1) AS SIGNED) AS SendWhatsapp
            FROM district_directory_config c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
            WHERE c.pk_id = @id AND c.isdeleted = 0",
            new { id });
    }

    public record DistrictMember(int MemberId, string Name, string? Mobile, string? Email, string? ClubName);

    private static async Task<List<DistrictMember>> GetDistrictMembersAsync(MySqlConnection conn, int districtId)
    {
        var rows = await conn.QueryAsync<DistrictMember>(@"
            SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name,
                   m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email, c.ClubName AS ClubName
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                 AND (cm.isdeleted IS NULL OR cm.isdeleted = 0)
                 AND cm.IsActive = 1
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @districtId
              AND (m.isdeleted IS NULL OR m.isdeleted = 0)
            ORDER BY m.MemberName",
            new { districtId });
        return rows.ToList();
    }

    private static string GenerateUrlHash()
    {
        var bytes = new byte[24];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexString(bytes).ToLowerInvariant(); // 48 chars
    }

    private static string BuildReminderHtml(string? name, string yearLabel, string districtNumber, int filled, int total, string detailedHtml, string url, string contactText)
    {
        var pct = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0;
        return $@"{EmailService.EMAIL_HEADER}
<h2 style=""color:#1a365d;margin-top:0;"">District Directory — Data Collection Reminder</h2>
<p>Hello {System.Net.WebUtility.HtmlEncode(name ?? "")},</p>
<p>Your Data Collection Form for the <b>District Directory {yearLabel} (District {districtNumber})</b> is currently incomplete.</p>
<p>Status: <b>{filled} of {total} fields completed — {pct}%</b>.</p>
{detailedHtml}
<p style=""margin-top:20px;"">Please complete the remaining details using the link below:</p>
<p><a href=""{url}"" style=""color:#2563eb;"">{url}</a></p>
<p>If you require any assistance, please contact <b>{System.Net.WebUtility.HtmlEncode(contactText)}</b>.</p>
<p style=""color:#64748b;font-size:13px;margin-top:20px;"">This message is sent for record completion purposes.</p>
<p>Regards,<br/><b>District Team</b></p>
{EmailService.EMAIL_FOOTER}";
    }
}
