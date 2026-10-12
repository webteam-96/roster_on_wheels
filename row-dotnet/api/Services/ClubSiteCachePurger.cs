using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Fires a fire-and-forget cache-invalidation request at the club-website Next.js
// app whenever admin saves something that affects what the public site renders
// (theme, banners, projects, BOD, events, etc.).
//
// The flow:
//   1. Admin saves → controller updates DB → calls IClubSiteCachePurger.PurgeByClubAsync(clubId)
//   2. We look up the club's subdomain (and any third-party domain) from club_websites
//   3. For each host, POST https://{host}/api/purge-cache?host={host}
//      with x-purge-secret header (shared secret from ClubSite:PurgeSecret config)
//   4. Club-website clears its in-memory tenant cache + revalidates fetch tags
//   5. Next page request renders fresh data — no app pool recycle, no waiting
//
// All calls are fire-and-forget — save never blocks on a slow/unreachable purge.
// If the purge HTTP call fails, the worst case is the old 5-min TTL applies and
// the change shows up a few minutes later instead of instantly.
public interface IClubSiteCachePurger
{
    // Purges the cache for all hosts (subdomain + client domain) registered for the given club.
    // Returns immediately; the HTTP calls run in the background.
    void PurgeByClub(int clubId);

    // Purges the cache for a specific host. Useful when the controller already knows the host.
    void PurgeHost(string host);

    // Purges everything (used by admin "Clear all caches" panic button, if/when we add one).
    void PurgeAll();
}

public class ClubSiteCachePurger : IClubSiteCachePurger
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<ClubSiteCachePurger> _logger;
    private readonly string _connectionString;
    private readonly string? _secret;
    private readonly bool _useHttps;

    public ClubSiteCachePurger(
        IHttpClientFactory httpFactory,
        IConfiguration config,
        ILogger<ClubSiteCachePurger> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _secret = config["ClubSite:PurgeSecret"];
        // ClubSite:UseHttps defaults to true. Set false for local dev where the
        // club-website is on http://localhost:3001.
        _useHttps = !string.Equals(config["ClubSite:UseHttps"], "false", StringComparison.OrdinalIgnoreCase);
    }

    public void PurgeByClub(int clubId)
    {
        if (string.IsNullOrWhiteSpace(_secret))
        {
            _logger.LogWarning("ClubSite:PurgeSecret not configured — skipping purge for club {ClubId}", clubId);
            return;
        }

        // Run in background — controller doesn't wait.
        _ = Task.Run(async () =>
        {
            try
            {
                using var conn = new MySqlConnection(_connectionString);
                await conn.OpenAsync();
                var hosts = (await conn.QueryAsync<(string? subdomain, string? clientDomain)>(@"
                    SELECT Subdomain AS subdomain, ClientDomain AS clientDomain
                    FROM club_websites
                    WHERE fk_club_id = @ClubId AND isdeleted = 0
                    LIMIT 1",
                    new { ClubId = clubId })).ToList();

                if (hosts.Count == 0)
                {
                    _logger.LogDebug("No club_websites row for club {ClubId} — nothing to purge", clubId);
                    return;
                }

                foreach (var row in hosts)
                {
                    if (!string.IsNullOrWhiteSpace(row.subdomain))
                        await PurgeOneHostAsync(row.subdomain);
                    if (!string.IsNullOrWhiteSpace(row.clientDomain))
                        await PurgeOneHostAsync(row.clientDomain);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Purge-by-club failed for club {ClubId}", clubId);
            }
        });
    }

    public void PurgeHost(string host)
    {
        if (string.IsNullOrWhiteSpace(_secret) || string.IsNullOrWhiteSpace(host)) return;
        _ = Task.Run(async () => await PurgeOneHostAsync(host));
    }

    public void PurgeAll()
    {
        // No-op without a host list — relies on caller iterating known hosts.
        // The /api/purge-cache route does support a no-host "purge all" mode if
        // we ever wire it up via a known endpoint, but that requires hitting
        // every IIS worker which isn't practical here.
        _logger.LogInformation("PurgeAll requested — no implementation (per-host purge is the supported path).");
    }

    private async Task PurgeOneHostAsync(string host)
    {
        try
        {
            var normalized = host.Trim().ToLowerInvariant();
            var scheme = _useHttps ? "https" : "http";
            var url = $"{scheme}://{normalized}/api/purge-cache?host={Uri.EscapeDataString(normalized)}";

            using var client = _httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);

            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Add("x-purge-secret", _secret);

            var resp = await client.SendAsync(req);
            if (resp.IsSuccessStatusCode)
                _logger.LogDebug("Purged cache for {Host}", normalized);
            else
                _logger.LogDebug("Purge returned {Status} for {Host}", (int)resp.StatusCode, normalized);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Purge call to {Host} failed (non-blocking)", host);
        }
    }
}
