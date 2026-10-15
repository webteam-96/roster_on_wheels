using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Privacy;

/// <summary>A request the caller may not make or that cannot run; the controller turns it into 400/403/404.</summary>
public sealed class PrivacyException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed record PrivacyCaller(int Id, bool SuperAdmin);

/// <summary>Statuses as the admin's privacy screens use them (src/types/privacy.ts).</summary>
public sealed class PrivacyRequestDto
{
    public int Id { get; set; }
    public string Kind { get; set; } = "export";
    public string Status { get; set; } = "";
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? ClubName { get; set; }
    public string? Reason { get; set; }
    public string RequestedBy { get; set; } = "";
    public string RequestedAt { get; set; } = "";
    public string? ApprovedBy { get; set; }
    public string? CompletedAt { get; set; }
    public string? DownloadUrl { get; set; }
    public string? DownloadExpiresAt { get; set; }
}

/// <summary>
/// Member privacy (master plan WS7): consent at first sign-in after a policy change, data export, erasure the
/// Rotary.org sync honours (tombstone), the registry audit and log retention. Behind the flag privacy.enabled.
/// Same behaviour and JSON as the NestJS edition (row/api/src/modules/privacy/privacy.service.ts).
/// </summary>
public class PrivacyService
{
    private const int ExportDays = 7;
    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<PrivacyService> _log;
    private static volatile bool _tablesReady;

    public PrivacyService(IConfiguration config, IWebHostEnvironment env, ILogger<PrivacyService> log)
    {
        _config = config;
        _env = env;
        _log = log;
        _connectionString = config.GetConnectionString("DefaultConnection") ?? "";
    }

    public static bool Enabled => Brand.Feature("privacy.enabled");
    private static string UtcNow => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss");
    private static string Iso(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");

    private async Task<MySqlConnection> OpenAsync()
    {
        var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);
        return conn;
    }

    /// <summary>Tables created by the privacy work (Appendix B.13 to B.15), on first use.</summary>
    public static async Task EnsureTablesAsync(MySqlConnection conn)
    {
        if (_tablesReady) return;
        await conn.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS privacy_requests (
              pk_request_id INT AUTO_INCREMENT PRIMARY KEY, request_type VARCHAR(10) NOT NULL, fk_member_id INT NOT NULL,
              fk_district_id INT NULL, requested_by INT NOT NULL, approved_by INT NULL, reason VARCHAR(500) NULL,
              status VARCHAR(20) NOT NULL, export_guid CHAR(36) NULL, export_expires_at DATETIME NULL,
              requested_at DATETIME NOT NULL, completed_at DATETIME NULL, error VARCHAR(500) NULL,
              KEY ix_privreq_district (fk_district_id, requested_at), KEY ix_privreq_member (fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await conn.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS member_erasure_tombstone (
              rotary_id_hash CHAR(64) NOT NULL PRIMARY KEY, fk_club_id INT NULL, erased_at_utc DATETIME NOT NULL,
              erased_by INT NOT NULL, reason VARCHAR(500) NULL, KEY ix_tomb_club (fk_club_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await conn.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS member_consents (
              pk_consent_id INT AUTO_INCREMENT PRIMARY KEY, fk_member_id INT NOT NULL, policy_version VARCHAR(20) NOT NULL,
              accepted_at_utc DATETIME NOT NULL, withdrawn_at_utc DATETIME NULL, language VARCHAR(10) NOT NULL,
              ip_address VARCHAR(45) NULL, channel VARCHAR(10) NOT NULL, KEY ix_consent_member (fk_member_id, policy_version)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        _tablesReady = true;
    }

    // ── Consent (WS7-05) ──────────────────────────────────────────────────────────────────────

    public async Task<object> ConsentStatusAsync(int memberId)
    {
        await using var conn = await OpenAsync();
        var accepted = await conn.ExecuteScalarAsync<string?>(
            @"SELECT policy_version FROM member_consents WHERE fk_member_id = @Id AND withdrawn_at_utc IS NULL
              ORDER BY accepted_at_utc DESC, pk_consent_id DESC LIMIT 1", new { Id = memberId });
        var version = Brand.PolicyVersion;
        return new { required = Enabled && version != "" && accepted != version, policyVersion = version, acceptedVersion = accepted };
    }

    public async Task AcceptConsentAsync(int memberId, string policyVersion, string language, string? ip, string channel)
    {
        if (Brand.PolicyVersion == "" || policyVersion != Brand.PolicyVersion) throw new PrivacyException(400, "The policy version is not the current one.");
        await using var conn = await OpenAsync();
        await conn.ExecuteAsync(
            @"INSERT INTO member_consents (fk_member_id, policy_version, accepted_at_utc, language, ip_address, channel)
              VALUES (@Id, @Version, @Now, @Lang, @Ip, @Channel)",
            new { Id = memberId, Version = policyVersion, Now = UtcNow, Lang = language.Length > 10 ? language[..10] : (language == "" ? "en" : language), Ip = ip, Channel = channel });
    }

    public async Task WithdrawConsentAsync(int memberId)
    {
        await using var conn = await OpenAsync();
        await conn.ExecuteAsync("UPDATE member_consents SET withdrawn_at_utc = @Now WHERE fk_member_id = @Id AND withdrawn_at_utc IS NULL", new { Id = memberId, Now = UtcNow });
    }

    // ── Who may act on whom ───────────────────────────────────────────────────────────────────

    private sealed class MemberFacts
    {
        public int Id;
        public string Name = "";
        public string? RotaryId;
        public List<string> Emails = new();
        public List<string> Mobiles = new();
        public int? ClubId;
        public List<int> DistrictIds = new();
        public List<string> PhotoPaths = new();
    }

    private static async Task<MemberFacts> FactsAsync(MySqlConnection conn, int memberId)
    {
        var p = (IDictionary<string, object?>?)await conn.QueryFirstOrDefaultAsync(
            "SELECT * FROM member_master_profile WHERE pk_member_master_profile_id = @Id", new { Id = memberId })
            ?? throw new PrivacyException(404, "Member not found.");
        var clubs = (await conn.QueryAsync<(int ClubId, int? DistrictId)>(
            @"SELECT c.pk_club_id, c.fk_district_id FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0 ORDER BY cm.IsActive DESC, cm.pk_club_member_id", new { Id = memberId })).ToList();
        var familyPhotos = await conn.QueryAsync<string?>("SELECT PhotoPath FROM member_family_details WHERE fk_member_master_profile_id = @Id", new { Id = memberId });
        string? S(string key) => p.TryGetValue(key, out var v) && v is string s && s.Trim() != "" ? s.Trim() : null;
        return new MemberFacts
        {
            Id = memberId,
            Name = S("MemberName") ?? "",
            RotaryId = S("RotaryId"),
            Emails = new[] { S("EmailId"), S("SecondaryEmailId") }.Where(v => v != null).Select(v => v!).ToList(),
            Mobiles = new[] { S("PrimaryMobileNumber"), S("SecondaryMobileNumber") }.Where(v => v != null).Select(v => v!).ToList(),
            ClubId = clubs.FirstOrDefault().ClubId is var c && c > 0 ? c : null,
            DistrictIds = clubs.Select(x => x.DistrictId ?? 0).Where(d => d > 0).Distinct().ToList(),
            PhotoPaths = new[] { S("ProfilePhotoPath"), S("FamilyPhotoPath") }.Concat(familyPhotos)
                .Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v!.Trim()).ToList(),
        };
    }

    private static async Task<bool> IsDistrictAdminAsync(MySqlConnection conn, int userId, IEnumerable<int> districtIds)
    {
        var ids = districtIds.ToList();
        if (ids.Count == 0 || userId <= 0) return false;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @User AND fk_role_id = 2
                AND fk_district_id IN @Districts AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
            new { User = userId, Districts = ids }) > 0;
    }

    // ── Requests ──────────────────────────────────────────────────────────────────────────────

    private const string RequestSelect = @"
        SELECT r.pk_request_id AS Id, r.request_type AS Kind, r.status AS Status, r.fk_member_id AS MemberId, r.reason AS Reason,
               r.requested_at AS RequestedAt, r.completed_at AS CompletedAt, r.export_guid AS ExportGuid,
               r.export_expires_at AS ExportExpiresAt, m.MemberName AS MemberName, rb.MemberName AS RequestedBy, ab.MemberName AS ApprovedBy,
               (SELECT c.ClubName FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                 WHERE cm.fk_member_master_profile_id = r.fk_member_id ORDER BY cm.IsActive DESC, cm.pk_club_member_id LIMIT 1) AS ClubName
        FROM privacy_requests r
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id
        LEFT JOIN member_master_profile rb ON rb.pk_member_master_profile_id = r.requested_by
        LEFT JOIN member_master_profile ab ON ab.pk_member_master_profile_id = r.approved_by";

    private sealed class RequestRow
    {
        public int Id { get; set; }
        public string Kind { get; set; } = "";
        public string Status { get; set; } = "";
        public int MemberId { get; set; }
        public string? Reason { get; set; }
        public DateTime RequestedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public Guid? ExportGuid { get; set; }   // CHAR(36): MySqlConnector reads it as a Guid
        public DateTime? ExportExpiresAt { get; set; }
        public string? MemberName { get; set; }
        public string? RequestedBy { get; set; }
        public string? ApprovedBy { get; set; }
        public string? ClubName { get; set; }
    }

    private PrivacyRequestDto ToDto(RequestRow r)
    {
        var guid = r.ExportGuid?.ToString();
        var live = r.Status == "completed" && guid != null && r.ExportExpiresAt is { } e && e > DateTime.UtcNow;
        return new PrivacyRequestDto
        {
            Id = r.Id, Kind = r.Kind == "erase" ? "erase" : "export", Status = r.Status, MemberId = r.MemberId,
            MemberName = r.MemberName ?? "", ClubName = r.ClubName, Reason = r.Reason, RequestedBy = r.RequestedBy ?? "",
            RequestedAt = Iso(r.RequestedAt), ApprovedBy = r.ApprovedBy, CompletedAt = r.CompletedAt is { } c ? Iso(c) : null,
            DownloadUrl = live ? SignedDownloadUrl(guid!, new DateTimeOffset(DateTime.SpecifyKind(r.ExportExpiresAt!.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds()) : null,
            DownloadExpiresAt = live ? Iso(r.ExportExpiresAt!.Value) : null,
        };
    }

    private async Task<PrivacyRequestDto> LoadRequestAsync(MySqlConnection conn, int id)
    {
        var r = await conn.QueryFirstOrDefaultAsync<RequestRow>(RequestSelect + " WHERE r.pk_request_id = @Id", new { Id = id })
                ?? throw new PrivacyException(404, "Request not found.");
        return ToDto(r);
    }

    public async Task<List<PrivacyRequestDto>> ListRequestsAsync(PrivacyCaller user, int districtId)
    {
        await using var conn = await OpenAsync();
        if (!user.SuperAdmin && !await IsDistrictAdminAsync(conn, user.Id, new[] { districtId }))
            throw new PrivacyException(403, "Only the district's admins can see its privacy requests.");
        var rows = await conn.QueryAsync<RequestRow>(RequestSelect + " WHERE r.fk_district_id = @District ORDER BY r.requested_at DESC, r.pk_request_id DESC LIMIT 500", new { District = districtId });
        return rows.Select(ToDto).ToList();
    }

    private static async Task<int> InsertRequestAsync(MySqlConnection conn, string kind, MemberFacts m, int by, string status, string? reason) =>
        await conn.ExecuteScalarAsync<int>(
            @"INSERT INTO privacy_requests (request_type, fk_member_id, fk_district_id, requested_by, reason, status, requested_at)
              VALUES (@Kind, @Member, @District, @By, @Reason, @Status, @Now); SELECT LAST_INSERT_ID();",
            new { Kind = kind, Member = m.Id, District = m.DistrictIds.Count > 0 ? m.DistrictIds[0] : (int?)null, By = by, Reason = reason, Status = status, Now = UtcNow });

    private async Task AuditAsync(MySqlConnection conn, int byId, string action, int memberId, string details)
    {
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO audit_log (fk_member_master_profile_id, action, entity_type, entity_id, details, created_date)
                  VALUES (@By, @Action, 'privacy', @Member, @Details, @Now)",
                new { By = byId, Action = action, Member = memberId, Details = details.Length > 2000 ? details[..2000] : details, Now = UtcNow });
        }
        catch (Exception ex) { _log.LogWarning("audit row not written: {Message}", ex.Message); }
    }

    // ── Export (WS7-02) ──────────────────────────────────────────────────────────────────────

    public async Task<PrivacyRequestDto> RequestExportAsync(PrivacyCaller user, int memberId)
    {
        await using var conn = await OpenAsync();
        var m = await FactsAsync(conn, memberId);
        if (!(user.SuperAdmin || user.Id == memberId || await IsDistrictAdminAsync(conn, user.Id, m.DistrictIds)))
            throw new PrivacyException(403, "Only the member, their District Admin or a SuperAdmin can export this member's data.");
        var id = await InsertRequestAsync(conn, "export", m, user.Id, "processing", null);
        try
        {
            var guid = Guid.NewGuid().ToString();
            await WriteExportAsync(conn, m, guid);
            await conn.ExecuteAsync(
                @"UPDATE privacy_requests SET status = 'completed', export_guid = @Guid, export_expires_at = @Expires, completed_at = @Now WHERE pk_request_id = @Id",
                new { Id = id, Guid = guid, Expires = DateTime.UtcNow.AddDays(ExportDays).ToString("yyyy-MM-dd HH:mm:ss"), Now = UtcNow });
            await AuditAsync(conn, user.Id, "PRIVACY_EXPORT", memberId, $"request {id}");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "export {Id} failed", id);
            await conn.ExecuteAsync("UPDATE privacy_requests SET status = 'failed', error = @Err WHERE pk_request_id = @Id", new { Id = id, Err = Trunc(ex.Message, 500) });
        }
        return await LoadRequestAsync(conn, id);
    }

    private string ExportRoot() => _config["Privacy:ExportRoot"] is { Length: > 0 } r ? r : Path.Combine(_env.ContentRootPath, "App_Data", "privacy-exports");

    private async Task WriteExportAsync(MySqlConnection conn, MemberFacts m, string guid)
    {
        var schema = await SchemaAsync(conn);
        var readme = new StringBuilder()
            .AppendLine($"{Brand.ProductName}: data held about member {m.Id}")
            .AppendLine($"Created {Iso(DateTime.UtcNow)} (UTC). One JSON and one CSV file per table that holds rows about this member.")
            .AppendLine();
        Directory.CreateDirectory(ExportRoot());
        var path = Path.Combine(ExportRoot(), guid + ".zip");
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            foreach (var entry in PersonalDataRegistry.Tables.Where(t => t.Export))
            {
                var where = WhereFor(entry, schema, m);
                if (where == null) continue;
                var rows = (await conn.QueryAsync($"SELECT * FROM `{entry.Table}` WHERE {where.Value.Sql}", where.Value.Params))
                    .Select(r => ((IDictionary<string, object?>)r)
                        .Where(kv => !System.Text.RegularExpressions.Regex.IsMatch(kv.Key, "password|token|otp", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                        .ToDictionary(kv => kv.Key, kv => kv.Value))
                    .ToList();
                if (rows.Count == 0) continue;
                var name = entry.By == MatchBy.MemberId ? entry.Table : $"{entry.Table}.by-{entry.By.ToString().ToLowerInvariant()}";
                await WriteEntryAsync(zip, $"{name}.json", JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
                await WriteEntryAsync(zip, $"{name}.csv", ToCsv(rows));
                readme.AppendLine($"{name}: {rows.Count} row(s)");
            }
            await WriteEntryAsync(zip, "README.txt", readme.ToString());
        }
    }

    private static async Task WriteEntryAsync(ZipArchive zip, string name, string text)
    {
        await using var w = new StreamWriter(zip.CreateEntry(name, CompressionLevel.Optimal).Open(), new UTF8Encoding(false));
        await w.WriteAsync(text);
    }

    private byte[] SigningKey()
    {
        var raw = _config["Privacy:LinkKey"] is { Length: > 0 } k ? k : _config["JwtSettings:Secret"];
        if (string.IsNullOrEmpty(raw)) throw new PrivacyException(400, "Privacy:LinkKey or JwtSettings:Secret must be configured.");
        return SHA256.HashData(Encoding.UTF8.GetBytes(raw));
    }

    private string Signature(string guid, long expiresMs)
    {
        using var h = new HMACSHA256(SigningKey());
        return Convert.ToHexString(h.ComputeHash(Encoding.UTF8.GetBytes($"{guid}.{expiresMs}"))).ToLowerInvariant();
    }

    /// <summary>The admin opens the file with a plain link, so the link itself carries an expiring signature.</summary>
    private string SignedDownloadUrl(string guid, long expiresMs)
    {
        var baseUrl = (_config["BackendUrl"] is { Length: > 0 } b ? b : Brand.ApiOrigin).TrimEnd('/');
        return $"{baseUrl}/api/privacy/exports/{guid}?expires={expiresMs}&sig={Signature(guid, expiresMs)}";
    }

    public async Task<byte[]> ExportFileAsync(string guid, string expires, string sig)
    {
        if (!Guid.TryParse(guid, out _) || !long.TryParse(expires, out var expiresMs) || expiresMs < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            throw new PrivacyException(404, "The download link has expired.");
        var expected = Encoding.ASCII.GetBytes(Signature(guid, expiresMs));
        var given = Encoding.ASCII.GetBytes(sig ?? "");
        if (!CryptographicOperations.FixedTimeEquals(expected, given)) throw new PrivacyException(404, "The download link is not valid.");
        var path = Path.Combine(ExportRoot(), guid + ".zip");
        if (!File.Exists(path)) throw new PrivacyException(404, "The export is no longer available.");
        try
        {
            await using var conn = await OpenAsync();
            await conn.ExecuteAsync("INSERT INTO audit_log (action, entity_type, details, created_date) VALUES ('PRIVACY_DOWNLOAD', 'privacy', @Guid, @Now)", new { Guid = guid, Now = UtcNow });
        }
        catch { /* audit only */ }
        return await File.ReadAllBytesAsync(path);
    }

    // ── Erasure (WS7-03) ─────────────────────────────────────────────────────────────────────

    public async Task<PrivacyRequestDto> RequestErasureAsync(PrivacyCaller user, int memberId, string reason)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw new PrivacyException(400, "A reason is required.");
        await using var conn = await OpenAsync();
        var m = await FactsAsync(conn, memberId);
        if (!user.SuperAdmin && !await IsDistrictAdminAsync(conn, user.Id, m.DistrictIds))
            throw new PrivacyException(403, "Only the member's District Admin or a SuperAdmin can erase a member.");
        // A District Admin's request waits for a second District Admin (or a SuperAdmin) to approve it.
        var id = await InsertRequestAsync(conn, "erase", m, user.Id, user.SuperAdmin ? "processing" : "awaiting_approval", Trunc(reason.Trim(), 500));
        if (user.SuperAdmin) await RunErasureAsync(conn, id, m, user.Id, reason.Trim());
        return await LoadRequestAsync(conn, id);
    }

    public async Task<PrivacyRequestDto> ApproveAsync(PrivacyCaller user, int requestId)
    {
        await using var conn = await OpenAsync();
        var r = await conn.QueryFirstOrDefaultAsync<(string Type, string Status, int MemberId, int By, string? Reason, int? District)>(
            "SELECT request_type, status, fk_member_id, requested_by, reason, fk_district_id FROM privacy_requests WHERE pk_request_id = @Id", new { Id = requestId });
        if (r.Type == null) throw new PrivacyException(404, "Request not found.");
        if (r.Type != "erase" || r.Status != "awaiting_approval") throw new PrivacyException(400, "Only an erasure waiting for approval can be approved.");
        if (r.By == user.Id && !user.SuperAdmin) throw new PrivacyException(403, "A second District Admin must approve this erasure.");
        if (!user.SuperAdmin && !await IsDistrictAdminAsync(conn, user.Id, r.District is { } d ? new[] { d } : Array.Empty<int>()))
            throw new PrivacyException(403, "Only the district's admins can approve this erasure.");
        await conn.ExecuteAsync("UPDATE privacy_requests SET approved_by = @By, status = 'processing' WHERE pk_request_id = @Id", new { Id = requestId, By = user.Id });
        var m = await FactsAsync(conn, r.MemberId);
        await RunErasureAsync(conn, requestId, m, user.Id, r.Reason ?? "");
        return await LoadRequestAsync(conn, requestId);
    }

    public async Task<PrivacyRequestDto> RejectAsync(PrivacyCaller user, int requestId)
    {
        await using var conn = await OpenAsync();
        var r = await conn.QueryFirstOrDefaultAsync<(string Status, int? District)>(
            "SELECT status, fk_district_id FROM privacy_requests WHERE pk_request_id = @Id", new { Id = requestId });
        if (r.Status == null) throw new PrivacyException(404, "Request not found.");
        if (r.Status != "awaiting_approval" && r.Status != "pending") throw new PrivacyException(400, "Only a waiting request can be rejected.");
        if (!user.SuperAdmin && !await IsDistrictAdminAsync(conn, user.Id, r.District is { } d ? new[] { d } : Array.Empty<int>()))
            throw new PrivacyException(403, "Only the district's admins can reject this request.");
        await conn.ExecuteAsync("UPDATE privacy_requests SET status = 'rejected', approved_by = @By, completed_at = @Now WHERE pk_request_id = @Id", new { Id = requestId, By = user.Id, Now = UtcNow });
        return await LoadRequestAsync(conn, requestId);
    }

    private string TombstoneSalt() =>
        _config["Brand:Privacy:TombstoneSalt"] is { Length: > 0 } s ? s
        : _config["JwtSettings:Secret"] is { Length: > 0 } j ? j
        : throw new PrivacyException(400, "Brand:Privacy:TombstoneSalt must be configured.");

    /// <summary>SHA-256(instance salt + Rotary id): what the sync compares against so an erased member is not recreated.</summary>
    public static string RotaryIdHash(string salt, string rotaryId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(salt + rotaryId.Trim()))).ToLowerInvariant();

    private async Task RunErasureAsync(MySqlConnection conn, int requestId, MemberFacts m, int byId, string reason)
    {
        try
        {
            var schema = await SchemaAsync(conn);
            var touched = new List<string>();
            await using (var tx = await conn.BeginTransactionAsync())
            {
                foreach (var entry in PersonalDataRegistry.Tables.Where(t => t.OnErase != EraseAction.Keep))
                {
                    var where = WhereFor(entry, schema, m);
                    if (where == null) continue;
                    int n;
                    if (entry.OnErase == EraseAction.DeleteRows)
                    {
                        n = await conn.ExecuteAsync($"DELETE FROM `{entry.Table}` WHERE {where.Value.Sql}", where.Value.Params, tx);
                    }
                    else
                    {
                        var cols = schema[entry.Table];
                        var sets = entry.Set!.Where(kv => cols.Contains(kv.Key)).ToList();
                        if (sets.Count == 0) continue;
                        var p = new DynamicParameters(where.Value.Params);
                        var assignments = sets.Select((kv, i) => { p.Add($"V{i}", kv.Value); return $"`{kv.Key}` = @V{i}"; });
                        n = await conn.ExecuteAsync($"UPDATE `{entry.Table}` SET {string.Join(", ", assignments)} WHERE {where.Value.Sql}", p, tx);
                    }
                    if (n > 0) touched.Add($"{entry.Table}:{n}");
                }
                if (m.RotaryId != null)
                {
                    await conn.ExecuteAsync(
                        @"INSERT INTO member_erasure_tombstone (rotary_id_hash, fk_club_id, erased_at_utc, erased_by, reason)
                          VALUES (@Hash, @Club, @Now, @By, @Reason)
                          ON DUPLICATE KEY UPDATE erased_at_utc = VALUES(erased_at_utc), erased_by = VALUES(erased_by)",
                        new { Hash = RotaryIdHash(TombstoneSalt(), m.RotaryId), Club = m.ClubId, Now = UtcNow, By = byId, Reason = Trunc(reason, 500) }, tx);
                }
                await conn.ExecuteAsync("UPDATE privacy_requests SET status = 'completed', completed_at = @Now WHERE pk_request_id = @Id", new { Id = requestId, Now = UtcNow }, tx);
                await tx.CommitAsync();
            }
            DeletePhotos(m.PhotoPaths);
            await AuditAsync(conn, byId, "PRIVACY_ERASE", m.Id, $"request {requestId}; {string.Join(", ", touched)}");
            _log.LogInformation("member {Member} erased (request {Request}): {Touched}", m.Id, requestId, string.Join(", ", touched));
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "erasure {Request} failed", requestId);
            await conn.ExecuteAsync("UPDATE privacy_requests SET status = 'failed', error = @Err WHERE pk_request_id = @Id", new { Id = requestId, Err = Trunc(ex.Message, 500) });
        }
    }

    /// <summary>Profile and family photos, only inside the web root.</summary>
    private void DeletePhotos(IEnumerable<string> paths)
    {
        var root = Path.GetFullPath(_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"));
        foreach (var raw in paths)
        {
            var rel = System.Text.RegularExpressions.Regex.Replace(raw, "^https?://[^/]+", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).TrimStart('/');
            if (rel.StartsWith("API/", StringComparison.OrdinalIgnoreCase)) rel = rel[4..];
            var full = Path.GetFullPath(Path.Combine(root, rel));
            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
            try { if (File.Exists(full)) File.Delete(full); } catch { /* best effort */ }
        }
    }

    // ── Registry plumbing ────────────────────────────────────────────────────────────────────

    private static async Task<Dictionary<string, HashSet<string>>> SchemaAsync(MySqlConnection conn)
    {
        var rows = await conn.QueryAsync<(string T, string C)>(
            "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
        var map = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (t, c) in rows)
        {
            if (!map.TryGetValue(t, out var set)) map[t] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            set.Add(c);
        }
        return map;
    }

    private static (string Sql, object Params)? WhereFor(PersonalTable entry, Dictionary<string, HashSet<string>> schema, MemberFacts m)
    {
        if (!schema.TryGetValue(entry.Table, out var cols) || !cols.Contains(entry.MatchColumn)) return null;
        var col = $"`{entry.MatchColumn}`";
        return entry.By switch
        {
            MatchBy.MemberId => ($"{col} = @M0", new { M0 = m.Id }),
            MatchBy.Email => m.Emails.Count == 0 ? null : ($"{col} IN @Ms", new { Ms = m.Emails }),
            MatchBy.Mobile => m.Mobiles.Count == 0 ? null : ($"{col} IN @Ms", new { Ms = MobileVariants(m.Mobiles) }),
            MatchBy.RotaryId => m.RotaryId == null ? null : ($"{col} = @M0", new { M0 = m.RotaryId }),
            _ => null,
        };
    }

    /// <summary>A number as stored, plus the digits-only form (logs keep "+44 7700 900123" and "447700900123" alike).</summary>
    private static List<string> MobileVariants(IEnumerable<string> mobiles)
    {
        var set = new HashSet<string>();
        foreach (var v in mobiles)
        {
            set.Add(v);
            var digits = new string(v.Where(char.IsDigit).ToArray());
            if (digits.Length >= 6) { set.Add(digits); set.Add("+" + digits); }
        }
        return set.ToList();
    }

    /// <summary>WS7-01 audit: personal-looking columns on tables the registry does not list.</summary>
    public async Task<List<object>> UnlistedColumnsAsync()
    {
        await using var conn = await OpenAsync();
        var schema = await SchemaAsync(conn);
        var listed = new HashSet<string>(PersonalDataRegistry.Tables.Select(t => t.Table), StringComparer.OrdinalIgnoreCase);
        var skip = new System.Text.RegularExpressions.Regex(@"^(bak_|tmp_|_tmp|temp$)|_20\d\d_\d\d$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return schema
            .Where(kv => !listed.Contains(kv.Key) && !PersonalDataRegistry.AuditIgnoredTables.Contains(kv.Key) && !skip.IsMatch(kv.Key))
            .Select(kv => (Table: kv.Key, Columns: kv.Value.Select(c => c.ToLowerInvariant())
                .Where(c => PersonalDataRegistry.PersonalColumn.IsMatch(c) && !PersonalDataRegistry.NotPersonalColumn.IsMatch(c)).ToList()))
            .Where(x => x.Columns.Count > 0)
            .OrderBy(x => x.Table)
            .Select(x => (object)new { table = x.Table, columns = x.Columns })
            .ToList();
    }

    // ── Retention (WS7-07) ───────────────────────────────────────────────────────────────────

    /// <summary>Deletes or blanks old rows by Brand:Privacy:RetentionDays. Returns what it did, for the log.</summary>
    public async Task<List<string>> ApplyRetentionAsync()
    {
        var days = Brand.RetentionDays;
        var done = new List<string>();
        await using var conn = await OpenAsync();
        var schema = await SchemaAsync(conn);
        bool Has(string t, string c) => schema.TryGetValue(t, out var cols) && cols.Contains(c);
        async Task Run(string label, string table, string dateCol, string sql, string key)
        {
            if (!days.TryGetValue(key, out var d) || d <= 0 || !Has(table, dateCol)) return;
            var n = await conn.ExecuteAsync(sql, new { Cutoff = DateTime.UtcNow.AddDays(-d).ToString("yyyy-MM-dd HH:mm:ss") });
            if (n > 0) done.Add($"{label}: {n}");
        }
        await Run("email_log bodies", "email_log", "sent_at", "UPDATE email_log SET body_html = NULL WHERE sent_at < @Cutoff AND body_html IS NOT NULL", "email_log_body");
        await Run("whatsapp_log", "whatsapp_log", "sent_at", "DELETE FROM whatsapp_log WHERE sent_at < @Cutoff", "whatsapp_log");
        foreach (var t in new[] { "announcement_push_log", "announcement_reminder_push_log", "event_push_log", "event_reminder_push_log", "document_push_log", "newsletter_push_log", "project_push_log" })
            await Run(t, t, "created_date", $"DELETE FROM `{t}` WHERE created_date < @Cutoff", "push_log");
        await Run("login_audit_logs", "login_audit_logs", "login_time", "DELETE FROM login_audit_logs WHERE login_time < @Cutoff", "login_audit");
        foreach (var t in new[] { "mobile_login_otp", "event_payment_otp", "password_reset_tokens", "web_sso_token" })
            await Run(t, t, "created_date", $"DELETE FROM `{t}` WHERE created_date < @Cutoff", "otp");
        await Run("assistant_turns", "assistant_turns", "created_date", "DELETE FROM assistant_turns WHERE created_date < @Cutoff", "assistant_turns");

        var exportDays = days.TryGetValue("export_files", out var ed) ? ed : ExportDays;
        if (Directory.Exists(ExportRoot()))
        {
            var removed = 0;
            foreach (var f in Directory.GetFiles(ExportRoot()))
                if (DateTime.UtcNow - File.GetLastWriteTimeUtc(f) > TimeSpan.FromDays(exportDays)) { File.Delete(f); removed++; }
            if (removed > 0) done.Add($"export files: {removed}");
        }
        return done;
    }

    private static string Trunc(string s, int n) => s.Length > n ? s[..n] : s;

    private static string ToCsv(List<Dictionary<string, object?>> rows)
    {
        var cols = rows.SelectMany(r => r.Keys).Distinct().ToList();
        static string Cell(object? v)
        {
            if (v == null) return "";
            var s = v is DateTime d ? Iso(d) : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) ?? "";
            return s.IndexOfAny(new[] { '"', ',', '\r', '\n' }) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
        }
        var sb = new StringBuilder().Append(string.Join(",", cols)).Append("\r\n");
        foreach (var r in rows) sb.Append(string.Join(",", cols.Select(c => Cell(r.GetValueOrDefault(c))))).Append("\r\n");
        return sb.ToString();
    }
}
