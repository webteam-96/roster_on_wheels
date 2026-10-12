namespace RotaryApi.DTOs;

/// <summary>
/// One row of the mobile bell-icon notification feed. The shape is deliberately uniform across
/// every source (greeting / project / announcement / event / newsletter / document) so the app can
/// render a single list and sort/merge without knowing where a row came from.
/// </summary>
public class MobileNotificationDto
{
    /// <summary>greeting | project | announcement | event | newsletter | document</summary>
    public string Type { get; set; } = "";

    /// <summary>Entity primary key (for greeting rows: the celebrating member's id).</summary>
    public int Id { get; set; }

    public string Title { get; set; } = "";

    /// <summary>Short summary — trimmed server-side so the list stays light.</summary>
    public string? Body { get; set; }

    /// <summary>Site-relative image path (same convention as the mobile calendar), or null.</summary>
    public string? ImageUrl { get; set; }

    /// <summary>The single field the whole feed is sorted by (newest first).</summary>
    public DateTime DateTime { get; set; }

    /// <summary>club | district | ri — where the item came from.</summary>
    public string Scope { get; set; } = "";

    public int? ClubId { get; set; }
    public int? DistrictId { get; set; }

    /// <summary>Human label for the source, e.g. "RC Ratnagiri Midtown", "District 3170", "Rotary International".</summary>
    public string SourceName { get; set; } = "";

    /// <summary>Registration link / newsletter link / document file path — whatever "open the thing" means. Nullable.</summary>
    public string? LinkUrl { get; set; }

    /// <summary>Everything the app needs to route to the right screen. Mirrors the FCM data payload.</summary>
    public MobileNotificationDeepLinkDto DeepLink { get; set; } = new();
}

/// <summary>
/// Routing target for one feed row. <see cref="Type"/> carries the SAME value the push notification's
/// FCM data payload uses (Firebase_Notification_Routes.md contract), so the app can reuse the handler
/// it already has for taps on a push:
///   club_announcement | club_upcoming_event | club_newsletter | document
///   club_project_&lt;avenue&gt; | celebrations_digest
/// </summary>
public class MobileNotificationDeepLinkDto
{
    public string Type { get; set; } = "";
    public int? ClubId { get; set; }
    public int? DistrictId { get; set; }
    /// <summary>announcementId / eventId / newsletterId / documentId / projectId / memberId.</summary>
    public int? EntityId { get; set; }
    /// <summary>Projects only — the year-partitioned table the project lives in.</summary>
    public int? YearId { get; set; }
    /// <summary>Documents only — "club" | "district" | "ri" (matches DocumentPushBackgroundService).</summary>
    public string? Scope { get; set; }
    /// <summary>Documents only — the club or district id that goes with <see cref="Scope"/>.</summary>
    public int? ScopeId { get; set; }
}
