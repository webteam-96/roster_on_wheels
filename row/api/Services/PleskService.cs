using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Xml.Linq;

namespace RotaryApi.Services;

// Plesk XML API client (at /enterprise/control/agent.php)
// REST API v2 is too limited in Plesk Obsidian — no subdomain/alias endpoints — so we use XML API.
// Auth: Basic (HTTP_AUTH_LOGIN/PASSWD headers) preferred; API key (KEY header) fallback.
public class PleskService
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _apiKey;
    private readonly string _username;
    private readonly string _password;
    private readonly string _parentDomain;
    private readonly string _sharedDocroot;
    private readonly string _districtDocroot;
    private readonly List<string> _protectedDocroots;
    private readonly bool _enableAspNet;
    private readonly string _aspNetVersion;
    private readonly string _wildcardCertName;
    private readonly string _serverIp;
    private readonly ILogger<PleskService> _logger;

    public PleskService(IConfiguration config, ILogger<PleskService> logger)
    {
        _logger = logger;
        var s = config.GetSection("PleskSettings");
        _baseUrl = (s["BaseUrl"] ?? "").TrimEnd('/');
        _apiKey = (s["ApiKey"] ?? "").Trim();
        _username = (s["Username"] ?? "").Trim();
        _password = s["Password"] ?? "";
        _parentDomain = (s["ParentDomain"] ?? "").Trim();
        _sharedDocroot = (s["SharedDocroot"] ?? "").Trim();
        _districtDocroot = (s["DistrictWebsiteSharedDocroot"] ?? "").Trim();
        _protectedDocroots = new List<string>();
        if (!string.IsNullOrWhiteSpace(_sharedDocroot)) _protectedDocroots.Add(_sharedDocroot);
        if (!string.IsNullOrWhiteSpace(_districtDocroot)) _protectedDocroots.Add(_districtDocroot);
        _enableAspNet = !bool.TryParse(s["EnableAspNet"], out var asp) || asp; // default true
        _aspNetVersion = (s["AspNetVersion"] ?? "4.0").Trim();
        _wildcardCertName = (s["WildcardCertName"] ?? "").Trim();
        // Public server IP that customer domains must point at (A record). Configured explicitly;
        // falls back to the host of BaseUrl (the Plesk panel host is the same box here).
        var serverIp = (s["ServerIp"] ?? "").Trim();
        if (string.IsNullOrWhiteSpace(serverIp) && Uri.TryCreate(_baseUrl, UriKind.Absolute, out var baseUri))
            serverIp = baseUri.Host;
        _serverIp = serverIp;
        var acceptSelfSigned = bool.TryParse(s["AcceptSelfSignedCert"], out var a) && a;

        var handler = new HttpClientHandler();
        if (acceptSelfSigned)
            handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(60) };
    }

    public string ClubSharedDocroot => _sharedDocroot;
    public string DistrictSharedDocroot => _districtDocroot;
    // Public server IP customer domains must A-record to (for DNS-pointing instructions + checks).
    public string ServerIp => _serverIp;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_baseUrl)
        && (!string.IsNullOrWhiteSpace(_apiKey) || (!string.IsNullOrWhiteSpace(_username) && !string.IsNullOrWhiteSpace(_password)));

    private void ApplyAuthHeaders(HttpRequestMessage req)
    {
        // Prefer Basic (HTTP_AUTH_LOGIN/PASSWD) — XML API auth. Fall back to KEY header.
        if (!string.IsNullOrWhiteSpace(_username))
        {
            req.Headers.Add("HTTP_AUTH_LOGIN", _username);
            req.Headers.Add("HTTP_AUTH_PASSWD", _password);
        }
        else if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            req.Headers.Add("KEY", _apiKey);
        }
    }

    private async Task<XDocument> SendPacketAsync(string xmlPacket)
    {
        if (!IsConfigured) throw new InvalidOperationException("Plesk is not configured.");
        var url = $"{_baseUrl}/enterprise/control/agent.php";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        ApplyAuthHeaders(req);
        req.Headers.Add("HTTP_PRETTY_PRINT", "TRUE");
        req.Content = new StringContent(xmlPacket, Encoding.UTF8, "text/xml");
        using var resp = await _http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogError("Plesk HTTP {Status}: {Body}", (int)resp.StatusCode, body);
            throw new InvalidOperationException($"Plesk HTTP {(int)resp.StatusCode}: {Truncate(body)}");
        }
        XDocument doc;
        try { doc = XDocument.Parse(body); }
        catch (Exception ex) { throw new InvalidOperationException($"Plesk returned non-XML: {Truncate(body)}", ex); }

        // System-level errors (auth failures etc.)
        var sysError = doc.Descendants("system").FirstOrDefault(e => (string?)e.Element("status") == "error");
        if (sysError != null)
        {
            var msg = (string?)sysError.Element("errtext") ?? "Unknown Plesk system error";
            var code = (string?)sysError.Element("errcode") ?? "";
            throw new InvalidOperationException($"Plesk system error {code}: {msg}");
        }
        // Operation-level errors
        var errorNode = doc.Descendants("result").FirstOrDefault(e => (string?)e.Element("status") == "error");
        if (errorNode != null)
        {
            var msg = (string?)errorNode.Element("errtext") ?? "Unknown Plesk error";
            var code = (string?)errorNode.Element("errcode") ?? "";
            throw new InvalidOperationException($"Plesk error {code}: {msg}");
        }
        return doc;
    }

    private static string Truncate(string s) => s.Length > 500 ? s[..500] + "..." : s;

    public async Task TestConnectionAsync()
    {
        var packet = @"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <server>
    <get>
      <stat/>
    </get>
  </server>
</packet>";
        await SendPacketAsync(packet);
    }

    public string WildcardCertName => _wildcardCertName;

    public async Task<int> CreateSubdomainAsync(string label) => await CreateSubdomainAsync(label, _sharedDocroot);

    public async Task<int> CreateSubdomainAsync(string label, string? docroot)
    {
        if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("label required");
        if (string.IsNullOrWhiteSpace(_parentDomain)) throw new InvalidOperationException("ParentDomain not configured");

        // STEP 1: Create subdomain with DEFAULT docroot (no www_root).
        // If we set www_root here, Plesk wipes the target folder and installs skeleton files — BAD for shared folder.
        // So we skip www_root during creation, then update it in step 2 (which just re-binds IIS path without touching files).
        var props = new StringBuilder();
        if (_enableAspNet)
            props.Append(@"<property><name>asp_dot_net</name><value>true</value></property>");

        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <add>
      <parent>{System.Security.SecurityElement.Escape(_parentDomain)}</parent>
      <name>{System.Security.SecurityElement.Escape(label)}</name>
      {props}
    </add>
  </subdomain>
</packet>";
        var doc = await SendPacketAsync(packet);
        var idStr = (string?)doc.Descendants("id").FirstOrDefault() ?? "0";
        int.TryParse(idStr, out var id);
        _logger.LogInformation("Plesk subdomain created: {Sub}.{Parent} (id={Id})", label, _parentDomain, id);

        // STEP 2: Re-point www_root to the shared folder via subdomain.set (does not touch the folder contents).
        // Re-throw on failure so caller's Activate captures and logs it visibly.
        if (!string.IsNullOrWhiteSpace(docroot))
        {
            await SetSubdomainDocrootAsync(label, docroot);
        }
        return id;
    }

    // Changes the docroot of an existing subdomain WITHOUT touching folder contents.
    // Plesk XML API expects <property> directly under <set>, no wrappers.
    public async Task SetSubdomainDocrootAsync(string label, string docroot)
    {
        var fqdn = $"{label}.{_parentDomain}";
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <set>
      <filter><name>{System.Security.SecurityElement.Escape(fqdn)}</name></filter>
      <property><name>www_root</name><value>{System.Security.SecurityElement.Escape(docroot)}</value></property>
    </set>
  </subdomain>
</packet>";
        await SendPacketAsync(packet);
        // Verify by reading back
        var actual = await GetSubdomainDocrootAsync(label);
        if (!string.IsNullOrEmpty(actual) &&
            actual.Trim('/', '\\').Equals(docroot.Trim('/', '\\'), StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("Docroot set successfully for {Sub}: {Root}", fqdn, docroot);
            return;
        }
        throw new InvalidOperationException(
            $"Plesk accepted www_root change but verification shows docroot still '{actual}' instead of '{docroot}'. " +
            $"Workaround: set it manually in Plesk panel → {fqdn} → Hosting Settings → Document root = '{docroot}'.");
    }

    // Reads the currently assigned cert name for a subdomain.
    // On Plesk Windows, subdomains are separate IIS sites — cert info lives under <site> endpoint.
    public async Task<string?> GetSubdomainCertAsync(string label)
    {
        var fqdn = $"{label}.{_parentDomain}";
        var escFqdn = System.Security.SecurityElement.Escape(fqdn);

        // Try <site><get> first (this is where cert info lives for Windows subdomains)
        var sitePacket = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <get>
      <filter><name>{escFqdn}</name></filter>
      <dataset>
        <gen_info/>
        <hosting/>
      </dataset>
    </get>
  </site>
</packet>";
        try
        {
            var doc = await SendPacketAsync(sitePacket);
            var names = new[] { "certificate_name", "certificate", "ssl_certificate" };
            foreach (var n in names)
            {
                var v = doc.Descendants("property")
                    .Where(p => (string?)p.Element("name") == n)
                    .Select(p => (string?)p.Element("value"))
                    .FirstOrDefault();
                if (!string.IsNullOrEmpty(v)) return v;
            }
        }
        catch { /* fall through to subdomain.get */ }

        // Fallback: <subdomain><get>
        var subPacket = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter><name>{escFqdn}</name></filter>
      <dataset>
        <gen_info/>
        <hosting/>
      </dataset>
    </get>
  </subdomain>
</packet>";
        try
        {
            var doc = await SendPacketAsync(subPacket);
            var names = new[] { "certificate_name", "certificate", "ssl_certificate" };
            foreach (var n in names)
            {
                var v = doc.Descendants("property")
                    .Where(p => (string?)p.Element("name") == n)
                    .Select(p => (string?)p.Element("value"))
                    .FirstOrDefault();
                if (!string.IsNullOrEmpty(v)) return v;
            }
            return null;
        }
        catch { return null; }
    }

    // Assign an existing cert to a subdomain/site.
    // Plesk Windows: "subdomain" is actually a SITE internally. Tries multiple packet shapes and records each outcome.
    public async Task AssignCertificateAsync(string label, string certificateName)
    {
        if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("label required");
        if (string.IsNullOrWhiteSpace(certificateName)) throw new ArgumentException("certificateName required");
        var fqdn = $"{label}.{_parentDomain}";
        var escFqdn = System.Security.SecurityElement.Escape(fqdn);
        var escCert = System.Security.SecurityElement.Escape(certificateName);
        var report = new StringBuilder();

        var variants = new (string Name, string Packet)[]
        {
            // Var A: site.set with <values><hosting><vrt_hst> wrapper (Plesk's hinted schema)
            ("A: site + values/hosting/vrt_hst + certificate_name", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <set>
      <filter><name>{escFqdn}</name></filter>
      <values>
        <hosting>
          <vrt_hst>
            <property><name>ssl</name><value>true</value></property>
            <property><name>certificate_name</name><value>{escCert}</value></property>
          </vrt_hst>
        </hosting>
      </values>
    </set>
  </site>
</packet>"),
            // Var B: site.set with hyphen variant of the property name
            ("B: site + values/hosting/vrt_hst + certificate-name (hyphen)", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <set>
      <filter><name>{escFqdn}</name></filter>
      <values>
        <hosting>
          <vrt_hst>
            <property><name>ssl</name><value>true</value></property>
            <property><name>certificate-name</name><value>{escCert}</value></property>
          </vrt_hst>
        </hosting>
      </values>
    </set>
  </site>
</packet>"),
            // Var C: site.set without <values>, direct <hosting>
            ("C: site + hosting/vrt_hst + certificate_name", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <set>
      <filter><name>{escFqdn}</name></filter>
      <hosting>
        <vrt_hst>
          <property><name>ssl</name><value>true</value></property>
          <property><name>certificate_name</name><value>{escCert}</value></property>
        </vrt_hst>
      </hosting>
    </set>
  </site>
</packet>"),
            // Var D: webspace.set with <values><hosting><vrt_hst> (Plesk said <webspace> expects <values>)
            ("D: webspace + values/hosting/vrt_hst + certificate_name", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <webspace>
    <set>
      <filter><name>{_parentDomain}</name></filter>
      <values>
        <hosting>
          <vrt_hst>
            <property><name>ssl</name><value>true</value></property>
            <property><name>certificate_name</name><value>{escCert}</value></property>
          </vrt_hst>
        </hosting>
      </values>
    </set>
  </webspace>
</packet>"),
            // Var E: <certificate><install> operator targeting the site
            ("E: certificate.install targeting site name", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <certificate>
    <install>
      <name>{escCert}</name>
      <domain>{escFqdn}</domain>
    </install>
  </certificate>
</packet>"),
        };

        foreach (var v in variants)
        {
            report.AppendLine($"--- {v.Name} ---");
            string? rawResp = null;
            try
            {
                rawResp = await SendRawAsync(v.Packet);
                report.AppendLine(Truncate(rawResp));
                var actual = await GetSubdomainCertAsync(label);
                report.AppendLine($"  read-back cert = '{actual ?? "<none>"}'");
                if (!string.IsNullOrEmpty(actual) && actual.Equals(certificateName, StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogInformation("Cert '{Cert}' assigned to {Sub} via '{V}'", certificateName, fqdn, v.Name);
                    // Force IIS to rebind — Plesk DB has the cert ref but IIS binding isn't refreshed until we toggle SSL.
                    // Pass cert name so the on-step re-applies it (some Plesk versions clear cert_name when ssl=false).
                    await RefreshSslBindingAsync(label, certificateName);
                    return;
                }
                _logger.LogWarning("Cert assignment '{V}' didn't stick. Raw Plesk response: {Resp}", v.Name, Truncate(rawResp));
            }
            catch (Exception ex)
            {
                report.AppendLine($"  EXCEPTION: {ex.Message}");
                _logger.LogWarning("Cert assignment '{V}' failed: {Err}", v.Name, ex.Message);
            }
        }

        throw new InvalidOperationException(
            $"Could not assign cert '{certificateName}' to '{fqdn}'. " +
            $"All variants tried — see details below.\n\n{report}\n\n" +
            $"Workaround: Plesk panel → {fqdn} → Hosting Settings → Certificate → select '{certificateName}'.");
    }

    // After cert is assigned in Plesk DB, IIS binding doesn't auto-refresh.
    // Toggling SSL off→on forces Plesk to rebuild the IIS SSL binding.
    // IMPORTANT: some Plesk versions clear certificate_name when ssl=false, so we RE-SEND the cert on the on-step.
    public async Task RefreshSslBindingAsync(string label, string? certificateName = null)
    {
        var fqdn = $"{label}.{_parentDomain}";
        var escFqdn = System.Security.SecurityElement.Escape(fqdn);

        string OffPacket = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <set>
      <filter><name>{escFqdn}</name></filter>
      <values>
        <hosting>
          <vrt_hst>
            <property><name>ssl</name><value>false</value></property>
          </vrt_hst>
        </hosting>
      </values>
    </set>
  </site>
</packet>";

        var certProp = string.IsNullOrEmpty(certificateName)
            ? ""
            : $@"<property><name>certificate_name</name><value>{System.Security.SecurityElement.Escape(certificateName)}</value></property>";
        string OnPacket = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <set>
      <filter><name>{escFqdn}</name></filter>
      <values>
        <hosting>
          <vrt_hst>
            <property><name>ssl</name><value>true</value></property>
            {certProp}
          </vrt_hst>
        </hosting>
      </values>
    </set>
  </site>
</packet>";

        try
        {
            await SendRawAsync(OffPacket);
            await Task.Delay(500);
            await SendRawAsync(OnPacket);
            _logger.LogInformation("SSL binding refreshed for {Sub} (cert re-applied: {HadCert})", fqdn, !string.IsNullOrEmpty(certificateName));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SSL binding refresh failed for {Sub}", fqdn);
        }
    }

    // Sends a raw XML packet and returns the raw body (no error parsing).
    // Used when we want to see Plesk's response even on errors.
    private async Task<string> SendRawAsync(string xmlPacket)
    {
        if (!IsConfigured) throw new InvalidOperationException("Plesk is not configured.");
        var url = $"{_baseUrl}/enterprise/control/agent.php";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        ApplyAuthHeaders(req);
        req.Headers.Add("HTTP_PRETTY_PRINT", "TRUE");
        req.Content = new StringContent(xmlPacket, Encoding.UTF8, "text/xml");
        using var resp = await _http.SendAsync(req);
        return await resp.Content.ReadAsStringAsync();
    }

    // Raw dump of site + subdomain details — helps diagnose which endpoint exposes this FQDN and what property names it uses.
    public async Task<string> DiagnosticSubdomainAsync(string label)
    {
        var fqdn = $"{label}.{_parentDomain}";
        var escFqdn = System.Security.SecurityElement.Escape(fqdn);
        var sb = new StringBuilder();

        foreach (var (name, packet) in new[]
        {
            ("site.get", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <get>
      <filter><name>{escFqdn}</name></filter>
      <dataset><gen_info/><hosting/></dataset>
    </get>
  </site>
</packet>"),
            ("subdomain.get", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter><name>{escFqdn}</name></filter>
      <dataset><gen_info/><hosting/></dataset>
    </get>
  </subdomain>
</packet>"),
            ("webspace.get", $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <webspace>
    <get>
      <filter><name>{escFqdn}</name></filter>
      <dataset><gen_info/><hosting/></dataset>
    </get>
  </webspace>
</packet>"),
        })
        {
            sb.AppendLine($"=== {name} ===");
            var url = $"{_baseUrl}/enterprise/control/agent.php";
            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            ApplyAuthHeaders(req);
            req.Headers.Add("HTTP_PRETTY_PRINT", "TRUE");
            req.Content = new StringContent(packet, Encoding.UTF8, "text/xml");
            try
            {
                using var resp = await _http.SendAsync(req);
                var body = await resp.Content.ReadAsStringAsync();
                sb.AppendLine(body);
            }
            catch (Exception ex)
            {
                sb.AppendLine($"EXCEPTION: {ex.Message}");
            }
            sb.AppendLine();
        }
        return sb.ToString();
    }

    public async Task<List<(string Name, string Id)>> ListAllSubdomainsAsync()
    {
        var packet = @"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter/>
    </get>
  </subdomain>
</packet>";
        var doc = await SendPacketAsync(packet);
        var list = new List<(string, string)>();
        foreach (var res in doc.Descendants("result"))
        {
            var id = (string?)res.Element("id") ?? "";
            var name = (string?)res.Descendants("name").FirstOrDefault() ?? "";
            if (!string.IsNullOrEmpty(name)) list.Add((name, id));
        }
        return list;
    }

    public async Task AddDomainAliasAsync(string primarySubdomain, string aliasDomain)
    {
        // Site alias in Plesk XML API. ascii-name is required in the element
        // sequence whenever pref is also present — Plesk's schema rejects the
        // packet (error 1014, "Expected is (ascii-name)") if pref follows
        // name directly. Punycode-encode via IdnMapping for non-ASCII domains;
        // for the ordinary ASCII case it just returns the same string.
        string asciiName;
        try { asciiName = new IdnMapping().GetAscii(aliasDomain.Trim()); }
        catch (ArgumentException) { asciiName = aliasDomain.Trim(); }

        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site-alias>
    <create>
      <site-id>{System.Security.SecurityElement.Escape(await GetSubdomainIdAsync(primarySubdomain))}</site-id>
      <name>{System.Security.SecurityElement.Escape(aliasDomain)}</name>
      <ascii-name>{System.Security.SecurityElement.Escape(asciiName)}</ascii-name>
      <pref>
        <web>true</web>
        <mail>false</mail>
        <seo-redirect>false</seo-redirect>
      </pref>
    </create>
  </site-alias>
</packet>";
        await SendPacketAsync(packet);
        _logger.LogInformation("Plesk alias added: {Alias} -> {Sub}", aliasDomain, primarySubdomain);
    }

    // Returns true if the third-party domain already exists in Plesk as a site-alias (i.e. it was
    // already provisioned as an "application" on our server). Used by the SuperAdmin edit flow to
    // decide whether to show the DNS "Check pointing" step. Mirrors SubdomainExistsAsync's
    // not-found handling — any "does not exist"/error-1013 is treated as false, not an error.
    public async Task<bool> DomainAliasExistsAsync(string domain)
    {
        if (string.IsNullOrWhiteSpace(domain)) return false;
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site-alias>
    <get>
      <filter>
        <name>{System.Security.SecurityElement.Escape(domain.Trim())}</name>
      </filter>
    </get>
  </site-alias>
</packet>";
        try
        {
            var doc = await SendPacketAsync(packet);
            var id = (string?)doc.Descendants("id").FirstOrDefault();
            return !string.IsNullOrEmpty(id);
        }
        catch (InvalidOperationException ex) when (
            ex.Message.Contains("not found", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("error 1013", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
    }

    // Best-effort Let's Encrypt for an exact third-party domain (the wildcard cert doesn't cover it).
    // Runs the LE extension CLI for the raw domain. Never throws — returns success/failure.
    public async Task<bool> TryProvisionLetsEncryptForDomainAsync(string domain)
    {
        if (string.IsNullOrWhiteSpace(domain)) return false;
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <cli>
    <exec>
      <command>{System.Security.SecurityElement.Escape("plesk bin extension --exec letsencrypt cli.php --domain " + domain.Trim())}</command>
    </exec>
  </cli>
</packet>";
        try
        {
            await SendPacketAsync(packet);
            _logger.LogInformation("Let's Encrypt provisioned for custom domain {Domain}", domain);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Let's Encrypt provisioning failed for custom domain {Domain}", domain);
            return false;
        }
    }

    // Returns true if subdomain exists in Plesk (checked by FQDN)
    public async Task<bool> SubdomainExistsAsync(string label)
    {
        var fqdn = $"{label}.{_parentDomain}";
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter>
        <name>{System.Security.SecurityElement.Escape(fqdn)}</name>
      </filter>
    </get>
  </subdomain>
</packet>";
        try
        {
            var doc = await SendPacketAsync(packet);
            var id = (string?)doc.Descendants("id").FirstOrDefault();
            return !string.IsNullOrEmpty(id);
        }
        catch (InvalidOperationException ex) when (
            ex.Message.Contains("not found", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("error 1013", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
    }

    private async Task<string> GetSubdomainIdAsync(string fqdn)
    {
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter>
        <name>{System.Security.SecurityElement.Escape(fqdn)}</name>
      </filter>
    </get>
  </subdomain>
</packet>";
        var doc = await SendPacketAsync(packet);
        var id = (string?)doc.Descendants("id").FirstOrDefault();
        if (string.IsNullOrEmpty(id)) throw new InvalidOperationException($"Subdomain '{fqdn}' not found in Plesk");
        return id;
    }

    // Gets the current docroot (www_root) of a subdomain
    public async Task<string?> GetSubdomainDocrootAsync(string label)
    {
        var fqdn = $"{label}.{_parentDomain}";
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter>
        <name>{System.Security.SecurityElement.Escape(fqdn)}</name>
      </filter>
    </get>
  </subdomain>
</packet>";
        try
        {
            var doc = await SendPacketAsync(packet);
            // Look for www_root property anywhere in the response
            var wwwRoot = doc.Descendants("property")
                .Where(p => (string?)p.Element("name") == "www_root")
                .Select(p => (string?)p.Element("value"))
                .FirstOrDefault();
            return wwwRoot;
        }
        catch { return null; }
    }

    public async Task DeleteSubdomainAsync(string label)
    {
        var fqdn = $"{label}.{_parentDomain}";

        // SAFETY CHECK 1: Read current docroot. If it's our shared folder, we MUST re-point before delete,
        // otherwise Plesk will wipe ClubWebsite.
        var currentDocroot = await GetSubdomainDocrootAsync(label);
        _logger.LogInformation("Current docroot for {Sub}: {Root}", fqdn, currentDocroot ?? "<unknown>");

        // SAFETY CHECK 2: Re-point docroot to a per-subdomain throwaway path regardless of current value
        var throwawayPath = $"subdomains/{label}";
        try
        {
            await SetSubdomainDocrootAsync(label, throwawayPath);
            _logger.LogInformation("Docroot re-pointed before delete: {Path}", throwawayPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not re-point docroot before delete. Current docroot: {Current}", currentDocroot);

            // If we KNOW the current docroot points to ANY protected shared folder → ABORT, don't risk it
            var matchedProtected = _protectedDocroots.FirstOrDefault(p =>
                !string.IsNullOrEmpty(currentDocroot) &&
                currentDocroot!.Trim('/', '\\').Equals(p.Trim('/', '\\'), StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(matchedProtected))
            {
                throw new InvalidOperationException(
                    $"Refusing to delete subdomain '{fqdn}' — docroot is still pointing to protected shared folder '{matchedProtected}' and re-point failed. " +
                    $"Fix: in Plesk panel, manually change this subdomain's docroot to anything else, then retry delete. Plesk error: {ex.Message}");
            }
            _logger.LogWarning("Proceeding with delete despite re-point failure — current docroot '{Current}' does not match any protected folder", currentDocroot);
        }

        var delPacket = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <del>
      <filter>
        <name>{System.Security.SecurityElement.Escape(fqdn)}</name>
      </filter>
    </del>
  </subdomain>
</packet>";
        await SendPacketAsync(delPacket);
        _logger.LogInformation("Plesk subdomain deleted: {Sub}", fqdn);
    }

    public async Task<bool> TryProvisionLetsEncryptAsync(string label, string? clientDomain)
    {
        // Let's Encrypt is a Plesk extension — invoke via CLI packet. Best-effort.
        var fqdn = $"{label}.{_parentDomain}";
        var packet = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <cli>
    <exec>
      <command>{System.Security.SecurityElement.Escape("plesk bin extension --exec letsencrypt cli.php --domain " + fqdn)}</command>
    </exec>
  </cli>
</packet>";
        try
        {
            await SendPacketAsync(packet);
            _logger.LogInformation("Let's Encrypt provisioned for {Sub}", fqdn);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Let's Encrypt provisioning failed for {Sub}", fqdn);
            return false;
        }
    }

    // Raw diagnostic — send a preset XML packet and return request + response
    public async Task<(string Request, string Response)> DiagnosticRawAsync(string type)
    {
        string packet = type switch
        {
            "list-subdomains" => @"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <subdomain>
    <get>
      <filter/>
    </get>
  </subdomain>
</packet>",
            "list-sites" => @"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <site>
    <get>
      <filter/>
      <dataset>
        <gen_info/>
      </dataset>
    </get>
  </site>
</packet>",
            "list-webspaces" => @"<?xml version=""1.0"" encoding=""UTF-8""?>
<packet>
  <webspace>
    <get>
      <filter/>
      <dataset>
        <gen_info/>
      </dataset>
    </get>
  </webspace>
</packet>",
            _ => throw new ArgumentException("Unknown type. Use: list-subdomains, list-sites, list-webspaces")
        };
        var url = $"{_baseUrl}/enterprise/control/agent.php";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        ApplyAuthHeaders(req);
        req.Headers.Add("HTTP_PRETTY_PRINT", "TRUE");
        req.Content = new StringContent(packet, Encoding.UTF8, "text/xml");
        using var resp = await _http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        return (packet, body);
    }
}
