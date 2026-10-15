using System.Net;
using DnsClient;

namespace RotaryApi.Services;

public record DnsPointingResult(string Domain, string ExpectedIp, IReadOnlyList<string> ResolvedIps, bool PointsToServer);

public interface IDnsPointingChecker
{
    // Resolve the domain's A records via public resolvers and report whether any equals expectedIp.
    Task<DnsPointingResult> CheckAsync(string domain, string expectedIp, CancellationToken ct = default);
}

// Checks whether a third-party (custom) domain currently points at our server IP.
// Queries public recursive resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1) so the result reflects the
// world's view — not the app server's local resolver/cache. A recursive resolver follows any CNAME/ALIAS
// chain and returns the final A records, so a domain CNAME'd to the club subdomain still resolves here.
public class DnsPointingChecker : IDnsPointingChecker
{
    private readonly ILogger<DnsPointingChecker> _logger;

    public DnsPointingChecker(ILogger<DnsPointingChecker> logger) => _logger = logger;

    public async Task<DnsPointingResult> CheckAsync(string domain, string expectedIp, CancellationToken ct = default)
    {
        // Reuse the shared host-stripper (scheme/path/port removed) so pasted URLs still work.
        var host = WebsiteDomainHelper.NormalizeClientDomain(domain) ?? "";
        var ips = new List<string>();
        if (string.IsNullOrWhiteSpace(host))
            return new DnsPointingResult(domain, expectedIp, ips, false);

        try
        {
            var options = new LookupClientOptions(IPAddress.Parse("8.8.8.8"), IPAddress.Parse("1.1.1.1"))
            {
                UseCache = false,
                Timeout = TimeSpan.FromSeconds(5),
                Retries = 2,
            };
            var lookup = new LookupClient(options);
            var result = await lookup.QueryAsync(host, QueryType.A, cancellationToken: ct);
            ips = result.Answers.ARecords()
                .Select(a => a.Address.ToString())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DNS A lookup failed for {Host}", host);
        }

        var points = !string.IsNullOrWhiteSpace(expectedIp)
            && ips.Any(ip => string.Equals(ip, expectedIp.Trim(), StringComparison.OrdinalIgnoreCase));
        return new DnsPointingResult(host, expectedIp, ips, points);
    }
}
