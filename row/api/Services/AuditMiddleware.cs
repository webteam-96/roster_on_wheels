using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Global middleware that automatically logs every successful POST/PUT/DELETE to audit_log.
/// Extracts entity type from URL path, action from HTTP method, user info from JWT.
/// </summary>
public class AuditMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IConfiguration _config;

    // Map URL segments to entity type names
    private static readonly Dictionary<string, string> EntityMap = new(StringComparer.OrdinalIgnoreCase)
    {
        // Club modules
        { "projects", "Project" },
        { "announcements", "Announcement" },
        { "upcoming-events", "Upcoming Event" },
        { "newsletters", "Newsletter" },
        { "documents", "Document" },
        { "attendance", "Attendance" },
        { "board-of-directors", "Board of Directors" },
        { "greetings", "Greeting" },
        { "weblinks", "Weblink" },
        { "sub-groups", "Sub Group" },
        { "potential-members", "Potential Member" },
        { "past-presidents", "Past President" },
        { "trf", "TRF Contribution" },
        { "pph-camps", "PPH Camp" },
        { "membership-dues", "Club Dues" },
        { "club-monthly-report", "Club Monthly Report" },
        // Club website data
        { "about", "Website About" },
        { "banners", "Website Banner" },
        { "menu_list", "Website Menu" },
        { "menus", "Website Menu" },
        { "social_media_links", "Website Social Link" },
        { "social-links", "Website Social Link" },
        { "contact_details", "Website Contact" },
        { "contact-details", "Website Contact" },
        { "advertisements", "Website Advertisement" },
        { "theme", "Website Theme" },
        // District modules
        { "committee", "District Committee" },
        { "groups", "Committee Group" },
        { "district-events", "District Event" },
        { "club-moderators", "Club Moderator" },
        { "ag", "Assistant Governor" },
        { "mass-emails", "Mass Email" },
        { "citation", "District Awards" },
        // RI Director
        { "ri-director", "RI Director" },
        // Settings / Masters
        { "clubs", "Club" },
        { "districts", "District" },
        { "members", "Member" },
        { "zones", "Zone" },
        { "area-of-focus", "Area of Focus" },
        { "categories", "Category" },
        { "sub-categories", "Sub Category" },
        { "funding", "Funding" },
        { "designations", "Designation" },
        { "themes", "Theme" },
        { "website-data-modules", "Website Data Module" },
        { "modules", "Module" },
        { "module-categories", "Module Category" },
        { "credit-management", "Credit Management" },
        { "credits", "RI Director Credit" },
        { "event-masters", "Event Master" },
        { "event-payment", "Event Payment" },
        { "tshirt-sizes", "T-Shirt Size" },
        { "food-preferences", "Food Preference" },
        { "cashfree-kyc", "Cashfree KYC" },
        { "rotary-years", "Rotary Year" },
        { "zonal-awards", "Zonal Award" },
        { "project-approval", "Project Approval" },
        { "document-types", "Document Type" },
        { "funds", "Fund" },
    };

    // Skip these paths (read-only, auth, webhooks)
    private static readonly string[] SkipPrefixes = {
        "/api/auth", "/api/mobile-auth", "/api/public/", "/api/whatsapp-info",
        "/api/district-directory", "/swagger", "/api/countries"
    };

    public AuditMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _config = config;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var method = context.Request.Method;

        // Only audit POST/PUT/DELETE
        if (method != "POST" && method != "PUT" && method != "DELETE")
        {
            await _next(context);
            return;
        }

        var path = context.Request.Path.Value ?? "";

        // Skip non-auditable paths
        if (SkipPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            await _next(context);
            return;
        }

        // Read request body for entity name extraction
        string? requestBody = null;
        if (context.Request.ContentType?.Contains("application/json") == true)
        {
            context.Request.EnableBuffering();
            using var reader = new StreamReader(context.Request.Body, Encoding.UTF8, leaveOpen: true);
            requestBody = await reader.ReadToEndAsync();
            context.Request.Body.Position = 0;
        }

        await _next(context);

        // Only log if response was successful (2xx)
        if (context.Response.StatusCode < 200 || context.Response.StatusCode >= 300) return;

        try
        {
            var memberId = context.User.FindFirst("memberId")?.Value;
            var memberName = context.User.FindFirst("name")?.Value ?? "System";
            var roleName = context.User.FindFirst("roles")?.Value ?? "";
            var ipAddress = context.Connection.RemoteIpAddress?.ToString() ?? "";
            var userAgent = context.Request.Headers.UserAgent.ToString();

            var action = method switch
            {
                "POST" => "Create",
                "PUT" => "Update",
                "DELETE" => "Delete",
                _ => method
            };

            // Refine action from URL patterns
            if (path.Contains("/reorder", StringComparison.OrdinalIgnoreCase)) action = "Reorder";
            if (path.Contains("/upload", StringComparison.OrdinalIgnoreCase)) action = "Upload";
            if (path.Contains("/approve", StringComparison.OrdinalIgnoreCase)) action = "Approve";
            if (path.Contains("/reject", StringComparison.OrdinalIgnoreCase)) action = "Reject";
            if (path.Contains("/assign", StringComparison.OrdinalIgnoreCase)) action = "Assign";
            if (path.Contains("/remove", StringComparison.OrdinalIgnoreCase)) action = "Remove";

            var entityType = ResolveEntityType(path);
            var entityName = ExtractEntityName(requestBody);
            var entityId = ExtractEntityId(path);

            var connStr = _config.GetConnectionString("DefaultConnection");
            using var conn = new MySqlConnection(connStr);
            await conn.OpenAsync();
            await conn.ExecuteAsync(@"
                INSERT INTO audit_log (fk_member_master_profile_id, member_name, role_name, action, entity_type,
                    entity_id, entity_name, details, ip_address, user_agent, created_date)
                VALUES (@MemberId, @MemberName, @RoleName, @Action, @EntityType,
                    @EntityId, @EntityName, @Details, @IpAddress, @UserAgent, NOW())",
                new
                {
                    MemberId = int.TryParse(memberId, out var mid) ? mid : (int?)null,
                    MemberName = memberName,
                    RoleName = roleName,
                    Action = action,
                    EntityType = entityType,
                    EntityId = entityId,
                    EntityName = entityName,
                    Details = $"{method} {path}",
                    IpAddress = ipAddress,
                    UserAgent = userAgent?.Length > 500 ? userAgent[..500] : userAgent
                });
        }
        catch
        {
            // Never block requests due to audit failures
        }
    }

    private static string ResolveEntityType(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);

        // Walk segments from end to find best match
        for (int i = segments.Length - 1; i >= 0; i--)
        {
            // Skip numeric/guid segments
            if (int.TryParse(segments[i], out _)) continue;
            if (segments[i] == "api") continue;

            if (EntityMap.TryGetValue(segments[i], out var entity))
                return entity;
        }

        // Fallback: use last non-numeric segment
        for (int i = segments.Length - 1; i >= 0; i--)
        {
            if (!int.TryParse(segments[i], out _) && segments[i] != "api")
                return segments[i];
        }

        return "Unknown";
    }

    private static int? ExtractEntityId(string path)
    {
        var segments = path.Split('/');
        // Last numeric segment is likely the entity ID
        for (int i = segments.Length - 1; i >= 0; i--)
        {
            if (int.TryParse(segments[i], out var id))
                return id;
        }
        return null;
    }

    private static string? ExtractEntityName(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            // Try common name fields
            foreach (var field in new[] { "title", "Title", "name", "Name", "clubName", "ClubName",
                "groupName", "group_name", "subGroupName", "sub_group_name", "designationName",
                "designation_name", "description", "subject", "Subject", "moduleName" })
            {
                if (root.TryGetProperty(field, out var val) && val.ValueKind == JsonValueKind.String)
                {
                    var s = val.GetString();
                    if (!string.IsNullOrWhiteSpace(s))
                        return s.Length > 200 ? s[..200] : s;
                }
            }
        }
        catch { }
        return null;
    }
}
