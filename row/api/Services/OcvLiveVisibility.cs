namespace RotaryApi.Services;

/// <summary>
/// "Live right now" SQL predicates for the three date-gated club modules that the OCV / GOV
/// report surfaces — Upcoming Events, Newsletters and Documents. Only PUBLISHED and
/// NOT-YET-EXPIRED rows may appear in the report.
///
/// The predicates are lifted verbatim from what the PUBLIC club website already treats as
/// visible, so the OCV Word report, the OCV Excel export and the per-module Live Documents
/// download can never disagree with each other or with the public site:
///   • Upcoming Events — ClubWebsitePublicDataController.GetUpcomingEvents
///   • Newsletters     — ClubWebsitePublicDataController.GetNewsletters
///   • Documents       — PushLogsController / DistrictAdminDashboardService "active documents"
///
/// NULL handling: all six columns are declared NOT NULL in DatabaseInitializer, but legacy
/// rows predate those definitions, so every expiry test is written NULL-safe — a NULL expiry
/// means "never expires" and must NOT drop the row. Publish columns are compared directly
/// (a NULL publish date yields NULL → the row is hidden, which is the safe direction for an
/// "is it published yet?" gate).
///
/// The stored `Status` VARCHAR column on all three tables is deliberately ignored: it defaults
/// to 'Unpublished' and is never refreshed as time passes. Every other query in this codebase
/// derives status from the dates instead, and so do these.
/// </summary>
public static class OcvLiveVisibility
{
    /// <summary>
    /// upcoming_events: PublishDate &lt;= NOW() and ExpiryDate not passed.
    /// EventDate is deliberately NOT gated here — the public homepage additionally requires
    /// EventDate &gt;= CURDATE() because it lists what is still *upcoming*, but the OCV report
    /// covers the whole Rotary year and must keep events that have already happened while
    /// their listing is still live.
    /// </summary>
    public static string UpcomingEvents(string alias) =>
        $"({alias}.PublishDate <= NOW() AND ({alias}.ExpiryDate IS NULL OR {alias}.ExpiryDate >= NOW()))";

    /// <summary>
    /// newsletters: PublishDateTime &lt;= NOW() and ExpiryDateTime not passed.
    /// The `ExpiryDateTime &lt;= PublishDateTime` arm is required (and carried over verbatim
    /// from the public site): the newsletter admin UI no longer captures a separate expiry —
    /// new rows get a 2099 sentinel, but legacy rows were stored with expiry EQUAL to publish,
    /// which would otherwise make every one of them vanish the instant it went live.
    /// </summary>
    public static string Newsletters(string alias) =>
        $"({alias}.PublishDateTime <= NOW() AND ({alias}.ExpiryDateTime IS NULL OR {alias}.ExpiryDateTime <= {alias}.PublishDateTime OR {alias}.ExpiryDateTime >= NOW()))";

    /// <summary>
    /// club_documents: PublishDateTime &lt;= NOW() and ExpiryDateTime not passed.
    /// </summary>
    public static string ClubDocuments(string alias) =>
        $"({alias}.PublishDateTime <= NOW() AND ({alias}.ExpiryDateTime IS NULL OR {alias}.ExpiryDateTime >= NOW()))";
}
