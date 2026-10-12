using System.Diagnostics;
using System.Text.RegularExpressions;

namespace RotaryApi.Services;

// Recycles IIS application pools for every club website subdomain.
// Used when code is deployed: a single button click recycles all 2000 pools
// instead of clicking each one manually in IIS Manager.
//
// Implementation uses Windows' built-in appcmd.exe rather than a NuGet
// dependency, so deployment doesn't need additional packages.
//
// Permission note: the IIS App Pool identity running this API must have
// permission to run appcmd.exe (typically requires the identity to be in
// the Administrators group, or in IIS_IUSRS with elevated rights granted).
// If the API runs without these rights, recycle calls return permission
// errors and the result reports them in FailedPools.

public class RecycleAllResult
{
    public int TotalPools { get; set; }
    public int Recycled { get; set; }
    public int Failed { get; set; }
    public List<string> RecycledPools { get; set; } = new();
    public List<string> FailedPools { get; set; } = new();
    public long DurationMs { get; set; }
    public string? Error { get; set; }
    // If true, the appcmd.exe call itself was rejected (likely permission issue).
    // Frontend shows a more helpful "elevate the API app pool" message instead of
    // a confusing "0 of 0 pools recycled".
    public bool PermissionDenied { get; set; }
}

public interface IIisAppPoolRecycler
{
    Task<RecycleAllResult> RecycleAllClubWebsitePoolsAsync();
}

public class IisAppPoolRecycler : IIisAppPoolRecycler
{
    private readonly ILogger<IisAppPoolRecycler> _logger;
    private readonly string _parentDomain;
    // Path to appcmd.exe — Sysnative is the 32→64-bit redirector path used when a
    // 32-bit process needs the 64-bit system folder. Try System32 first since most
    // .NET 10 processes are 64-bit; fall back to Sysnative if not found.
    private static readonly string[] AppcmdPaths = new[]
    {
        @"C:\Windows\System32\inetsrv\appcmd.exe",
        @"C:\Windows\Sysnative\inetsrv\appcmd.exe",
    };

    public IisAppPoolRecycler(IConfiguration config, ILogger<IisAppPoolRecycler> logger)
    {
        _logger = logger;
        _parentDomain = (config["PleskSettings:ParentDomain"] ?? RotaryApi.Services.Brand.ClubSiteParentDomain).ToLowerInvariant();
    }

    public async Task<RecycleAllResult> RecycleAllClubWebsitePoolsAsync()
    {
        var result = new RecycleAllResult();
        var sw = Stopwatch.StartNew();

        var appcmd = AppcmdPaths.FirstOrDefault(File.Exists);
        if (appcmd == null)
        {
            result.Error = "appcmd.exe not found. IIS may not be installed on this server.";
            result.DurationMs = sw.ElapsedMilliseconds;
            return result;
        }

        try
        {
            var allPools = await ListPoolsAsync(appcmd);
            // Match pools whose name contains the parent domain. In Plesk the names look like
            // "club.example.org(domain)(plesk)" — case-insensitive substring is sufficient.
            var clubPools = allPools
                .Where(p => p.IndexOf(_parentDomain, StringComparison.OrdinalIgnoreCase) >= 0)
                .ToList();

            result.TotalPools = clubPools.Count;
            _logger.LogInformation("Recycle-all: found {Count} club website pools matching '{Parent}'", clubPools.Count, _parentDomain);

            foreach (var poolName in clubPools)
            {
                try
                {
                    var (ok, output) = await RecyclePoolAsync(appcmd, poolName);
                    if (ok)
                    {
                        result.Recycled++;
                        result.RecycledPools.Add(poolName);
                    }
                    else
                    {
                        result.Failed++;
                        // Truncate long error output so the response stays readable.
                        var summary = output.Length > 200 ? output[..200] + "..." : output;
                        result.FailedPools.Add($"{poolName}: {summary}");

                        if (output.Contains("access is denied", StringComparison.OrdinalIgnoreCase) ||
                            output.Contains("not authorized", StringComparison.OrdinalIgnoreCase))
                        {
                            result.PermissionDenied = true;
                        }
                    }
                }
                catch (Exception ex)
                {
                    result.Failed++;
                    result.FailedPools.Add($"{poolName}: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Recycle-all failed");
            result.Error = ex.Message;
            if (ex.Message.Contains("access is denied", StringComparison.OrdinalIgnoreCase))
                result.PermissionDenied = true;
        }

        sw.Stop();
        result.DurationMs = sw.ElapsedMilliseconds;
        return result;
    }

    private async Task<List<string>> ListPoolsAsync(string appcmd)
    {
        // appcmd output format: APPPOOL "<name>" (MgdVersion:..., MgdMode:..., state:...)
        var output = await RunAsync(appcmd, "list apppool");
        var pools = new List<string>();
        var rx = new Regex("^APPPOOL \"([^\"]+)\"", RegexOptions.Multiline);
        foreach (Match m in rx.Matches(output))
            pools.Add(m.Groups[1].Value);
        return pools;
    }

    private async Task<(bool ok, string output)> RecyclePoolAsync(string appcmd, string poolName)
    {
        // Sanitize — pool name comes from appcmd's own list output but defend anyway.
        if (poolName.Contains('"') || poolName.Contains('\r') || poolName.Contains('\n') || poolName.Length > 250)
            return (false, "Invalid pool name (suspicious characters).");

        var args = $"recycle apppool /apppool.name:\"{poolName}\"";
        var output = await RunAsync(appcmd, args);
        // appcmd success line: "APPPOOL object "<name>" recycled"
        var ok = output.Contains("recycled", StringComparison.OrdinalIgnoreCase);
        return (ok, output);
    }

    private async Task<string> RunAsync(string fileName, string args)
    {
        using var p = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            }
        };
        p.Start();
        var stdout = await p.StandardOutput.ReadToEndAsync();
        var stderr = await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        return (stdout + "\n" + stderr).Trim();
    }
}
