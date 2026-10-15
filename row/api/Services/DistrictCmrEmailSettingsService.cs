using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Per-(district, year) settings that a DISTRICT admin controls for the Club Monthly
// Report submission email. When ANY club in that district uploads its CMR to the
// district for that year, CmrSubmissionMailer reads these settings:
//   • SendToDistrictGovernor = false → the District Governor is dropped from the
//     recipients (President / Secretary / Assistant Governor still receive it).
//   • CcEmails → extra comma-separated addresses that are ALWAYS CC'd (regardless
//     of the DG toggle).
// Default when a district has never saved: DG = Yes, no extra CC (current behaviour).
public class DistrictCmrEmailSettingsDto
{
    public bool SendToDistrictGovernor { get; set; } = true;
    public string CcEmails { get; set; } = "";
}

public interface IDistrictCmrEmailSettingsService
{
    Task<DistrictCmrEmailSettingsDto> GetAsync(int districtId, int yearId);
    Task SaveAsync(int districtId, int yearId, bool sendToDistrictGovernor, string? ccEmails, int modifiedBy);
    // Used by the mailer with an already-open connection; returns the flag + the parsed,
    // de-duplicated CC address list. Never throws — falls back to (true, empty) on any error
    // so a settings problem can never block the submission email.
    Task<(bool SendToDistrictGovernor, List<string> CcEmails)> ResolveAsync(MySqlConnection conn, int districtId, int yearId);
}

public class DistrictCmrEmailSettingsService : IDistrictCmrEmailSettingsService
{
    private readonly string _conn;
    private static bool _tableEnsured;
    private static readonly SemaphoreSlim _ensureLock = new(1, 1);

    public DistrictCmrEmailSettingsService(IConfiguration config)
        => _conn = config.GetConnectionString("DefaultConnection")!;

    // Lazy CREATE TABLE IF NOT EXISTS — robust against the server's SkipInit
    // (DatabaseInitializer may be skipped on prod). Runs once per process.
    private static async Task EnsureTableAsync(MySqlConnection conn)
    {
        if (_tableEnsured) return;
        await _ensureLock.WaitAsync();
        try
        {
            if (_tableEnsured) return;
            await conn.ExecuteAsync(@"
                CREATE TABLE IF NOT EXISTS district_cmr_email_settings (
                    pk_id INT PRIMARY KEY AUTO_INCREMENT,
                    fk_district_id INT NOT NULL,
                    fk_year_id INT NOT NULL,
                    SendToDistrictGovernor TINYINT(1) NOT NULL DEFAULT 1,
                    CcEmails VARCHAR(1000) NULL,
                    modified_by INT NULL,
                    modified_date DATETIME NULL,
                    created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_district_year (fk_district_id, fk_year_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
            _tableEnsured = true;
        }
        finally { _ensureLock.Release(); }
    }

    public async Task<DistrictCmrEmailSettingsDto> GetAsync(int districtId, int yearId)
    {
        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();
        await EnsureTableAsync(conn);
        var row = await conn.QueryFirstOrDefaultAsync<(sbyte SendToDistrictGovernor, string? CcEmails)?>(
            @"SELECT SendToDistrictGovernor, CcEmails FROM district_cmr_email_settings
              WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1",
            new { D = districtId, Y = yearId });
        if (row == null) return new DistrictCmrEmailSettingsDto();   // defaults: DG=Yes, no CC
        return new DistrictCmrEmailSettingsDto
        {
            SendToDistrictGovernor = row.Value.SendToDistrictGovernor != 0,
            CcEmails = row.Value.CcEmails ?? "",
        };
    }

    public async Task SaveAsync(int districtId, int yearId, bool sendToDistrictGovernor, string? ccEmails, int modifiedBy)
    {
        // Normalise the CC list: valid-looking addresses only, trimmed + de-duplicated.
        var cleaned = string.Join(", ", ParseEmails(ccEmails));

        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();
        await EnsureTableAsync(conn);
        await conn.ExecuteAsync(
            @"INSERT INTO district_cmr_email_settings
                  (fk_district_id, fk_year_id, SendToDistrictGovernor, CcEmails, modified_by, modified_date)
              VALUES (@D, @Y, @Send, @Cc, @By, NOW())
              ON DUPLICATE KEY UPDATE
                  SendToDistrictGovernor = VALUES(SendToDistrictGovernor),
                  CcEmails               = VALUES(CcEmails),
                  modified_by            = VALUES(modified_by),
                  modified_date          = NOW()",
            new { D = districtId, Y = yearId, Send = sendToDistrictGovernor ? 1 : 0, Cc = cleaned, By = modifiedBy });
    }

    public async Task<(bool SendToDistrictGovernor, List<string> CcEmails)> ResolveAsync(MySqlConnection conn, int districtId, int yearId)
    {
        try
        {
            await EnsureTableAsync(conn);
            var row = await conn.QueryFirstOrDefaultAsync<(sbyte SendToDistrictGovernor, string? CcEmails)?>(
                @"SELECT SendToDistrictGovernor, CcEmails FROM district_cmr_email_settings
                  WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1",
                new { D = districtId, Y = yearId });
            if (row == null) return (true, new List<string>());       // never configured → default DG=Yes
            return (row.Value.SendToDistrictGovernor != 0, ParseEmails(row.Value.CcEmails));
        }
        catch
        {
            return (true, new List<string>());   // any failure → safe default (DG gets the email)
        }
    }

    // Split comma / semicolon / whitespace, keep only address-shaped tokens, de-dup case-insensitively.
    public static List<string> ParseEmails(string? raw)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(raw)) return result;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in raw.Split(new[] { ',', ';', ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var e = part.Trim();
            if (e.Length < 3 || !e.Contains('@') || !e.Contains('.')) continue;   // minimal shape check
            if (seen.Add(e)) result.Add(e);
        }
        return result;
    }
}
