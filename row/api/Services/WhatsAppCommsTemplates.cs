using System.Globalization;

namespace RotaryApi.Services;

/// <summary>
/// One WhatsApp message ready to send: the approved template, its header values (the image URL for
/// image-header templates, null otherwise) and the body values for a given member name.
/// </summary>
public sealed record WhatsAppCommsMessage(string Template, string[]? HeaderValues, Func<string, string[]> BodyFor);

/// <summary>
/// Club / District Upcoming Event and Announcement WhatsApp messages on the approved Meta
/// templates (2026-09-17). When the item has an image, the IMAGE-header template is used and the image
/// URL goes in the header; otherwise the no-image template. The image URL is never part of the text.
///
/// The body texts below are the approved templates verbatim ("club sync.txt"). They size the free-text
/// Details field: a rendered body may hold 600 characters, so Details is cut on a word boundary to what
/// is left. The web page phone preview (rotary-frontend/src/utils/whatsappTemplatePreview.ts) uses the
/// same texts and rules, so the preview shows exactly what members receive.
/// </summary>
public static class WhatsAppCommsTemplates
{
    // Budget room reserved for the member's name when fitting Details, so every member gets the SAME
    // Details as the preview (which uses the same 40). Only a longer name (~0.06% of members) shortens
    // Details a little further for that member.
    public const int NameReserveChars = 40;

    public const string ClubEventImage = "row_club_upcoming_event_image_updated";
    public const string ClubEventNoImage = "row_club_upcoming_event_no_image_updated";
    public const string DistrictEventImage = "row_district_upcoming_event_image_updated";
    public const string DistrictEventNoImage = "row_district_upcoming_event_no_image_updated";
    public const string ClubAnnouncementImage = "row_club_announcement_image_updated";
    public const string ClubAnnouncementNoImage = "row_club_announcement_no_image_updated";
    public const string DistrictAnnouncementImage = "row_district_announcement_image_updated";
    public const string DistrictAnnouncementNoImage = "row_district_announcement_no_image_updated";
    // Club newsletter, approved 2026-09-24. The PDF one carries the file in a document header.
    public const string ClubNewsletterLink = "row_newsletter_link_updated_2i";
    public const string ClubNewsletterPdf = "row_newsletter_pdf_updated";

    private const string ClubEventBody =
        """
        Dear Rtn. {{1}},

        You are invited to attend the upcoming event organised by RC {{2}}:

        Event Title: {{3}}

        Event Date: {{4}}

        Details: {{5}}

        Venue: {{6}}

        Registration Link (if applicable): {{7}}

        This is an automated message from ROW. For further details, please contact your Club Admin.
        """;

    private const string DistrictEventBody =
        """
        Dear Rtn. {{1}},

        You are invited to attend the upcoming event organized by RI District {{2}}:

        Event Title: {{3}}

        Event Date: {{4}}

        Details: {{5}}

        Venue: {{6}}

        Registration Link (if applicable): {{7}}

        This is an automated message from ROW. For further details, please contact your District Admin.
        """;

    private const string ClubAnnouncementBody =
        """
        Dear Rtn. {{1}},

        Your Club {{2}} has shared an announcement for your information.

        Title: {{3}}

        Details: {{4}}

        This is an automated notification from ROW. For any queries regarding this announcement, please contact your Club Admin.
        """;

    private const string DistrictAnnouncementBody =
        """
        Dear Rtn. {{1}},

        Your District {{2}} has shared an announcement for your information.

        Title: {{3}}

        Details: {{4}}

        This is an automated notification from ROW. For any queries regarding this announcement, please contact your District Admin.
        """;

    private static readonly int ClubEventStatic = WhatsAppTemplateText.StaticChars(ClubEventBody);
    private static readonly int DistrictEventStatic = WhatsAppTemplateText.StaticChars(DistrictEventBody);
    private static readonly int ClubAnnouncementStatic = WhatsAppTemplateText.StaticChars(ClubAnnouncementBody);
    private static readonly int DistrictAnnouncementStatic = WhatsAppTemplateText.StaticChars(DistrictAnnouncementBody);

    /// <summary>Upcoming Event (first send and reminders). {{2}} = club name, or bare district number.</summary>
    public static WhatsAppCommsMessage Event(bool isDistrict, string sourceName, string title, DateTime eventDate,
        string? description, string? venue, string? registrationLink, string? imageUrl)
    {
        var hasImage = !string.IsNullOrWhiteSpace(imageUrl);
        var template = isDistrict
            ? (hasImage ? DistrictEventImage : DistrictEventNoImage)
            : (hasImage ? ClubEventImage : ClubEventNoImage);
        var staticChars = isDistrict ? DistrictEventStatic : ClubEventStatic;
        var source = SourceParam(isDistrict, sourceName);
        // Invariant culture: always "25 Sep 2026 06:30 PM", whatever the server's culture.
        var date = eventDate.ToString("dd MMM yyyy hh:mm tt", CultureInfo.InvariantCulture);
        var venueText = string.IsNullOrWhiteSpace(venue) ? "-" : venue!;
        var link = registrationLink ?? "";
        var desc = WhatsAppTemplateText.Normalise(description);

        string Fit(string name) => WhatsAppTemplateText.FitNormalisedText(desc, staticChars, name, source, title, date, venueText, link);
        var shared = Fit(new string('x', NameReserveChars));
        return new WhatsAppCommsMessage(template, hasImage ? new[] { imageUrl!.Trim() } : null, name => new[]
        {
            name, source, title, date,
            WhatsAppTemplateText.CollapseWhitespace(name).Length > NameReserveChars ? Fit(name) : shared,
            venueText, link,
        });
    }

    /// <summary>Announcement (first send and reminders). {{2}} = club name, or bare district number.</summary>
    public static WhatsAppCommsMessage Announcement(bool isDistrict, string sourceName, string title,
        string? description, string? imageUrl)
    {
        var hasImage = !string.IsNullOrWhiteSpace(imageUrl);
        var template = isDistrict
            ? (hasImage ? DistrictAnnouncementImage : DistrictAnnouncementNoImage)
            : (hasImage ? ClubAnnouncementImage : ClubAnnouncementNoImage);
        var staticChars = isDistrict ? DistrictAnnouncementStatic : ClubAnnouncementStatic;
        var source = SourceParam(isDistrict, sourceName);
        var desc = WhatsAppTemplateText.Normalise(description);

        string Fit(string name) => WhatsAppTemplateText.FitNormalisedText(desc, staticChars, name, source, title);
        var shared = Fit(new string('x', NameReserveChars));
        return new WhatsAppCommsMessage(template, hasImage ? new[] { imageUrl!.Trim() } : null, name => new[]
        {
            name, source, title,
            WhatsAppTemplateText.CollapseWhitespace(name).Length > NameReserveChars ? Fit(name) : shared,
        });
    }

    /// <summary>
    /// Club newsletter (user 2026-09-24). Two approved templates: the newsletter saved as a LINK sends the
    /// link as {{4}}; the one saved as a PDF sends the file itself in the template's document header and
    /// says "check the attachment" instead. Neither carries free text, so nothing is ever truncated.
    /// District newsletters stay on the old template until their own new one is approved.
    /// </summary>
    public static WhatsAppCommsMessage ClubNewsletter(string clubName, string title, string? linkUrl, string? pdfUrl)
    {
        var hasPdf = !string.IsNullOrWhiteSpace(pdfUrl);
        var template = hasPdf ? ClubNewsletterPdf : ClubNewsletterLink;
        var body = hasPdf
            ? new[] { "", clubName, title }              // name filled per member below
            : new[] { "", clubName, title, linkUrl ?? "" };
        return new WhatsAppCommsMessage(template, hasPdf ? new[] { pdfUrl!.Trim() } : null, name =>
        {
            var values = (string[])body.Clone();
            values[0] = name;
            return values;
        });
    }

    // Club name as stored; for districts the bare number (the scheduler's source name is "District 3141").
    private static string SourceParam(bool isDistrict, string sourceName)
        => isDistrict && sourceName.StartsWith("District ") ? sourceName["District ".Length..] : sourceName;
}
