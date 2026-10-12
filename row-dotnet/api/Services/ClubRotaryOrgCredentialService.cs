using Dapper;
using Microsoft.AspNetCore.DataProtection;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Per-club rotary.org login (username/password) the RI Flow-Bot browser extension uses
// to sign in and submit projects to spc.rotary.org on the club's behalf. Encrypted at
// rest via ASP.NET Core Data Protection — see Program.cs's AddDataProtection() call
// (persists keys to App_Data/dp-keys, same folder as firebase-admin.json).
public class ClubRotaryOrgCredentialService : IClubRotaryOrgCredentialService
{
    private readonly string _connectionString;
    private readonly IDataProtector _protector;

    public ClubRotaryOrgCredentialService(IConfiguration configuration, IDataProtectionProvider dpProvider)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _protector = dpProvider.CreateProtector("RotaryApi.ClubRotaryOrgCredentials.v1");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<ClubRotaryOrgCredentialDto> GetAsync(int clubId, int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await ClubAdminAccessHelper.EnsureClubAdminAsync(conn, memberId, clubId);

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT RotaryOrgUsernameEncrypted, RotaryOrgPasswordEncrypted, modified_date
            FROM club_rotary_org_credentials
            WHERE fk_club_id = @ClubId AND isdeleted = 0
            LIMIT 1",
            new { ClubId = clubId });

        if (row == null) return new ClubRotaryOrgCredentialDto { HasCredentials = false };

        // Data Protection keys are per-machine (App_Data/dp-keys) but this credential
        // table lives in the SHARED database — so a row encrypted on another environment
        // (e.g. the server) can't be decrypted here because that key isn't in this
        // machine's key ring. Fail soft: report "not configured on this environment"
        // (200) so the UI prompts re-entry, instead of throwing a 500.
        var username = SafeUnprotect((string?)row.RotaryOrgUsernameEncrypted);
        var password = SafeUnprotect((string?)row.RotaryOrgPasswordEncrypted);
        if (username == null || password == null)
            return new ClubRotaryOrgCredentialDto { HasCredentials = false };

        return new ClubRotaryOrgCredentialDto
        {
            HasCredentials = true,
            Username = username,
            Password = password,
            ModifiedDate = (DateTime?)row.modified_date
        };
    }

    // Decrypt without letting a missing/foreign Data Protection key crash the request.
    private string? SafeUnprotect(string? cipher)
    {
        if (string.IsNullOrEmpty(cipher)) return null;
        try { return _protector.Unprotect(cipher); }
        catch (System.Security.Cryptography.CryptographicException) { return null; }
    }

    public async Task UpsertAsync(int clubId, UpsertClubRotaryOrgCredentialDto dto, int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await ClubAdminAccessHelper.EnsureClubAdminAsync(conn, memberId, clubId);

        var encryptedUsername = _protector.Protect(dto.Username);
        var encryptedPassword = _protector.Protect(dto.Password);

        await conn.ExecuteAsync(@"
            INSERT INTO club_rotary_org_credentials
                (fk_club_id, RotaryOrgUsernameEncrypted, RotaryOrgPasswordEncrypted, created_by, created_date)
            VALUES (@ClubId, @Username, @Password, @MemberId, NOW())
            ON DUPLICATE KEY UPDATE
                RotaryOrgUsernameEncrypted = VALUES(RotaryOrgUsernameEncrypted),
                RotaryOrgPasswordEncrypted = VALUES(RotaryOrgPasswordEncrypted),
                modified_by = @MemberId,
                modified_date = NOW(),
                isdeleted = 0",
            new { ClubId = clubId, Username = encryptedUsername, Password = encryptedPassword, MemberId = memberId });
    }
}
