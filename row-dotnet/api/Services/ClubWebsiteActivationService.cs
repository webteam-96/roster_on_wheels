using Dapper;
using MySqlConnector;
using System.Data;

namespace RotaryApi.Services;

// Implementation moved verbatim from ClubWebsitesController.PerformActivationAsync (behaviour-preserving).
// Provisions a club_websites row in Plesk (create/reuse subdomain, docroot, alias, wildcard SSL),
// flips status to Active, and emails the club President/Secretary.
public class ClubWebsiteActivationService : IClubWebsiteActivationService
{
    private readonly IEmailService _emailService;
    private readonly PleskService _plesk;
    private readonly IClubSiteCachePurger _purger;
    private readonly string _pleskParentDomain;

    public ClubWebsiteActivationService(IConfiguration config, IEmailService emailService, PleskService plesk, IClubSiteCachePurger purger)
    {
        _emailService = emailService;
        _plesk = plesk;
        _purger = purger;
        _pleskParentDomain = config.GetSection("PleskSettings")["ParentDomain"] ?? "";
    }

    public async Task<ClubWebsiteActivationResult> ActivateAsync(MySqlConnection conn, int id, int userId, bool skipPlesk, string logAction)
    {
        var result = new ClubWebsiteActivationResult { SkipPlesk = skipPlesk };

        var website = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName,
                   w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
                   w.StartDate AS startDate, w.EndDate AS endDate, w.Status AS status
            FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
            WHERE w.pk_id = @Id AND w.isdeleted = 0",
            new { Id = id });
        if (website == null) { result.NotFound = true; return result; }

        // Plesk subdomain LABEL — always reduce to the bare first label. A stored FQDN like
        // "club.example.org" must NOT get the Plesk parent appended a 2nd time (that produced
        // the doubled "club.example.org"). Storage stays verbatim; only the
        // value handed to Plesk is the clean label. fullSub is the clean FQDN for the alias step.
        var label = WebsiteDomainHelper.NormalizeSubdomain((string)website.subdomain);
        var fullSub = $"{label}.{_pleskParentDomain.ToLowerInvariant()}";
        if (!skipPlesk && _plesk.IsConfigured && string.IsNullOrWhiteSpace(label))
        {
            result.NoSubdomain = true;
            return result;
        }

        var pleskStepsDone = result.PleskStepsDone;
        string? pleskError = null;

        if (!skipPlesk && _plesk.IsConfigured)
        {
            try
            {
                // Idempotent: if subdomain already exists in Plesk, skip creation and continue with cert/alias steps
                if (await _plesk.SubdomainExistsAsync(label))
                {
                    pleskStepsDone.Add($"Subdomain already existed ({label}.{_pleskParentDomain}) — reusing");
                    await LogAction(conn, id, "PleskSubdomainReused", $"{label}.{_pleskParentDomain} already existed", userId);
                    // A subdomain left over from a prior (failed) attempt keeps Plesk's default per-site
                    // docroot (e.g. ...\site1). The create path sets the docroot in step 2, but the reuse
                    // path skipped it — so re-point it to the shared ClubWebsite folder here (matches the
                    // DistrictWebsites behaviour). Non-fatal: log if it can't be rebound.
                    if (!string.IsNullOrWhiteSpace(_plesk.ClubSharedDocroot))
                    {
                        try
                        {
                            await _plesk.SetSubdomainDocrootAsync(label, _plesk.ClubSharedDocroot);
                            pleskStepsDone.Add($"Docroot re-pointed to shared folder ({_plesk.ClubSharedDocroot})");
                            await LogAction(conn, id, "PleskDocrootRepointed", _plesk.ClubSharedDocroot, userId);
                        }
                        catch (Exception ex) { await LogAction(conn, id, "PleskDocrootRebindFailed", ex.Message, userId); }
                    }
                }
                else
                {
                    await _plesk.CreateSubdomainAsync(label);
                    pleskStepsDone.Add($"Subdomain created ({label}.{_pleskParentDomain})");
                    await LogAction(conn, id, "PleskSubdomainCreated", $"{label}.{_pleskParentDomain}", userId);
                }

                if (!string.IsNullOrWhiteSpace((string?)website.clientDomain))
                {
                    var clientDomain = (string)website.clientDomain;
                    try
                    {
                        // Idempotent: don't re-add an alias that's already an application on the server.
                        if (await _plesk.DomainAliasExistsAsync(clientDomain))
                        {
                            pleskStepsDone.Add($"Domain already an application ({clientDomain}) — reusing");
                            await LogAction(conn, id, "PleskAliasAlreadyExists", clientDomain, userId);
                        }
                        else
                        {
                            await _plesk.AddDomainAliasAsync(fullSub, clientDomain);
                            pleskStepsDone.Add($"Alias added ({clientDomain})");
                            await LogAction(conn, id, "PleskAliasAdded", clientDomain, userId);
                        }
                        // SSL for the custom domain (wildcard doesn't cover it) — best-effort, non-fatal.
                        var le = await _plesk.TryProvisionLetsEncryptForDomainAsync(clientDomain);
                        pleskStepsDone.Add(le ? $"SSL issued ({clientDomain})" : $"SSL pending ({clientDomain})");
                        await LogAction(conn, id, le ? "PleskDomainLetsEncrypt" : "PleskDomainLetsEncryptFailed", clientDomain, userId);
                        await conn.ExecuteAsync(
                            "UPDATE club_websites SET ClientDomainProvisioned = 1, ClientDomainVerifiedDate = NOW() WHERE pk_id = @Id",
                            new { Id = id });
                    }
                    catch (Exception ex)
                    {
                        await LogAction(conn, id, "PleskAliasFailed", ex.Message, userId);
                        pleskError = $"Alias failed: {ex.Message}";
                    }
                }

                // SSL — assign wildcard cert (best effort, non-fatal)
                if (!string.IsNullOrWhiteSpace(_plesk.WildcardCertName))
                {
                    try
                    {
                        await _plesk.AssignCertificateAsync(label, _plesk.WildcardCertName);
                        pleskStepsDone.Add($"Wildcard cert assigned ({_plesk.WildcardCertName})");
                        await LogAction(conn, id, "PleskCertAssigned", _plesk.WildcardCertName, userId);
                    }
                    catch (Exception ex)
                    {
                        await LogAction(conn, id, "PleskCertFailed", ex.Message, userId);
                    }
                }
                else
                {
                    await LogAction(conn, id, "PleskCertSkipped", "WildcardCertName not configured", userId);
                }
            }
            catch (Exception ex)
            {
                pleskError = ex.Message;
                await LogAction(conn, id, "PleskActivationFailed", ex.Message, userId);
                await conn.ExecuteAsync(
                    "UPDATE club_websites SET Status = 'ActivationFailed', modified_by = @U WHERE pk_id = @Id",
                    new { Id = id, U = userId });
                result.ActivationFailed = true;
                result.PleskError = pleskError;
                return result;
            }
        }
        else if (!skipPlesk && !_plesk.IsConfigured)
        {
            await LogAction(conn, id, "PleskSkippedNotConfigured", "PleskSettings.ApiKey not set — skipped provisioning", userId);
        }
        else if (skipPlesk)
        {
            await LogAction(conn, id, "PleskSkippedManualOverride", "Admin chose manual activation", userId);
        }

        // Update status and send welcome email
        await conn.ExecuteAsync(
            "UPDATE club_websites SET Status = 'Active', modified_by = @U WHERE pk_id = @Id",
            new { Id = id, U = userId });
        await LogAction(conn, id, logAction, "Status set to Active", userId);

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        int emailsSent = 0, emailsTotal = 0;
        if (currentYearId.HasValue)
        {
            var leaders = (await conn.QueryAsync<dynamic>(@"
                SELECT m.MemberName AS memberName, m.EmailId AS email, d.designation_name AS designation
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                  AND d.designation_name IN ('Club President', 'Club Secretary')
                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                new { ClubId = (int)website.clubId, YearId = currentYearId.Value })).ToList();
            emailsTotal = leaders.Count;
            foreach (var l in leaders)
            {
                try
                {
                    await _emailService.SendClubWebsiteActivationEmailAsync(
                        (string)l.email, (string)l.memberName, (string)website.clubName,
                        (string)l.designation, fullSub,
                        (string?)website.clientDomain, (DateTime)website.startDate, (DateTime)website.endDate,
                        ccEmail: RotaryApi.Services.Brand.InternalCc);
                    emailsSent++;
                }
                catch { /* logged via email service */ }
            }
            await LogAction(conn, id, "ActivationEmailSent", $"Sent to {emailsSent} of {emailsTotal} leaders", userId);
        }

        // Purge cache so the now-Active site is reachable on next page load.
        _purger.PurgeByClub((int)website.clubId);

        result.EmailsSent = emailsSent;
        result.EmailsTotal = emailsTotal;
        result.PleskError = pleskError;
        return result;
    }

    private static async Task LogAction(MySqlConnection conn, int websiteId, string action, string? details, int userId, IDbTransaction? tx = null)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
            VALUES (@W, @A, @D, @U)",
            new { W = websiteId, A = action, D = details, U = userId }, tx);
    }
}
