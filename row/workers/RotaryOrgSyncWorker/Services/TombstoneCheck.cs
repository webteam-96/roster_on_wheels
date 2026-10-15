using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Extensions.Configuration;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Erased members stay erased (master plan WS7-04). The API writes SHA-256(salt + Rotary id) to
/// member_erasure_tombstone when it erases a member; the sweep skips any incoming Rotary id whose hash is
/// there, so the member is neither re-added nor refilled from Rotary.org. Loaded once per run (the table is
/// small). The salt must be the API's: Brand:Privacy:TombstoneSalt, else JwtSettings:Secret (set both
/// processes from the same environment variables).
/// </summary>
public sealed class TombstoneCheck
{
    private readonly HashSet<string> _hashes;
    private readonly string _salt;
    public int Skipped { get; private set; }

    private TombstoneCheck(HashSet<string> hashes, string salt)
    {
        _hashes = hashes;
        _salt = salt;
    }

    public static async Task<TombstoneCheck> LoadAsync(MySqlConnection conn, IConfiguration config)
    {
        var salt = config["Brand:Privacy:TombstoneSalt"] is { Length: > 0 } s ? s : config["JwtSettings:Secret"] ?? "";
        var hashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_erasure_tombstone'");
        if (exists > 0)
            foreach (var h in await conn.QueryAsync<string>("SELECT rotary_id_hash FROM member_erasure_tombstone")) hashes.Add(h);
        if (hashes.Count > 0 && salt.Length == 0)
            Console.WriteLine("[TombstoneCheck] WARNING: erased members exist but no Brand:Privacy:TombstoneSalt / JwtSettings:Secret is configured; they cannot be recognised and may be re-added.");
        return new TombstoneCheck(hashes, salt);
    }

    /// <summary>True when this Rotary id belongs to an erased member; counts the skip.</summary>
    public bool IsErased(string? rotaryId)
    {
        if (_hashes.Count == 0 || _salt.Length == 0 || string.IsNullOrWhiteSpace(rotaryId)) return false;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(_salt + rotaryId.Trim()))).ToLowerInvariant();
        if (!_hashes.Contains(hash)) return false;
        Skipped++;
        return true;
    }
}
