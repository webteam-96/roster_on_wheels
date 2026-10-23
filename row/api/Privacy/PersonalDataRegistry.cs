using System.Text.RegularExpressions;

namespace RotaryApi.Privacy;

/// <summary>How a table's rows are tied to the member being exported or erased.</summary>
public enum MatchBy { MemberId, Email, Mobile, RotaryId }

/// <summary>What erasure does to the matched rows.</summary>
public enum EraseAction { DeleteRows, Anonymise, Keep }

/// <param name="Set">For <see cref="EraseAction.Anonymise"/>: column → fixed value (null, a marker, a flag).</param>
public sealed record PersonalTable(
    string Table, MatchBy By, string MatchColumn, EraseAction OnErase,
    IReadOnlyDictionary<string, object?>? Set = null, bool Export = true);

/// <summary>
/// Personal-data registry (master plan WS7-01, Appendix G): every table that holds data about a member, how
/// its rows are tied to the member, and what erasure does. Export and erasure are both driven from this list.
/// Names are the ROW schema's; at run time the service skips tables or columns that do not exist.
/// Same content as the NestJS edition (row/api/src/modules/privacy/personal-data-registry.ts).
/// </summary>
public static class PersonalDataRegistry
{
    public const string Erased = "[erased]";
    public const string ErasedName = "Erased member";
    private const string MemberCol = "fk_member_master_profile_id";

    private static PersonalTable Del(string t, string col = MemberCol, bool export = true) => new(t, MatchBy.MemberId, col, EraseAction.DeleteRows, null, export);
    private static PersonalTable Keep(string t, string col = MemberCol, bool export = true) => new(t, MatchBy.MemberId, col, EraseAction.Keep, null, export);
    private static PersonalTable Anon(string t, string col, Dictionary<string, object?> set, MatchBy by = MatchBy.MemberId) => new(t, by, col, EraseAction.Anonymise, set);

    public static readonly IReadOnlyList<PersonalTable> Tables = new List<PersonalTable>
    {
        // ── The member ───────────────────────────────────────────────────────────────────────
        Anon("member_master_profile", "pk_member_master_profile_id", new()
        {
            ["MemberName"] = ErasedName, ["ProfilePhotoPath"] = null, ["FamilyPhotoPath"] = null, ["PrimaryMobileNumber"] = null,
            ["SecondaryMobileNumber"] = null, ["EmailId"] = null, ["SecondaryEmailId"] = null, ["BirthDate"] = null, ["AnniversaryDate"] = null,
            ["BloodGroup"] = null, ["Gender"] = null, ["RotaryId"] = null, ["PrimaryLanguage"] = null, ["MemberIntroduction"] = null,
            ["LastDeviceToken"] = null, ["LastDeviceName"] = null, ["Facebook"] = null, ["Instagram"] = null, ["LinkedIn"] = null,
            ["Twitter"] = null, ["Youtube"] = null, ["Website"] = null, ["isdeleted"] = 1,
        }),
        Del("member_credentials", export: false),
        // Address and family rows cannot be hard-deleted (schema triggers trg_prevent_hard_delete_*):
        // every personal column is blanked and the row soft-deleted.
        Anon("member_address_details", MemberCol, new()
        {
            ["Address"] = null, ["PhoneNumber"] = null, ["State"] = null, ["City"] = null, ["PinCode"] = null,
            ["BusinessName"] = null, ["BusinessEmailId"] = null, ["Keywords"] = null, ["isdeleted"] = 1,
        }),
        Anon("member_family_details", MemberCol, new()
        {
            ["Name"] = ErasedName, ["Relation"] = null, ["BloodGroup"] = null, ["PhoneNumber"] = null, ["EmailId"] = null,
            ["BirthDate"] = null, ["AnniversaryDate"] = null, ["PhotoPath"] = null, ["isdeleted"] = 1,
        }),
        Del("password_reset_tokens", export: false),
        Del("web_sso_token", export: false),
        Del("mobile_login_otp", export: false),
        Del("member_fcm_tokens"),
        Del("member_device_sessions"),

        // ── Memberships and roles: facts kept, pointing at the anonymised member ─────────────
        Anon("club_members", MemberCol, new() { ["isdeleted"] = 1 }),
        Anon("member_roles", MemberCol, new() { ["isdeleted"] = 1, ["IsActive"] = 0 }),
        Anon("sub_group_members", MemberCol, new() { ["isdeleted"] = 1 }),
        Anon("board_of_directors", MemberCol, new() { ["non_member_mobile"] = null, ["non_member_email"] = null }),
        Anon("past_presidents", MemberCol, new() { ["non_member_photo"] = null }),

        // ── Copies of name, email, mobile, photo ──────────────────────────────────────────────
        Anon("district_committee_member", "fk_member_id", new() { ["name"] = ErasedName, ["mobile"] = null, ["email"] = null, ["profile_photo"] = null }),
        Anon("district_committee_group_member", "fk_member_id", new() { ["name"] = ErasedName, ["mobile"] = null, ["email"] = null, ["profile_photo"] = null }),
        Anon("district_committee_sub_group_member", "fk_member_id", new() { ["name"] = ErasedName, ["mobile"] = null, ["email"] = null, ["profile_photo"] = null }),
        // A governor's name and year are public record; anonymised until counsel says otherwise (master plan Q6).
        Anon("district_governors", "fk_member_id", new() { ["member_name"] = ErasedName, ["profile_photo"] = null, ["email"] = null, ["mobile_number"] = null }),
        Del("district_ag", "fk_member_id"),
        Keep("club_attendance_members", "fk_member_id"),
        Anon("club_mass_email_recipients", "fk_member_id", new() { ["MemberName"] = ErasedName, ["Email"] = Erased }),
        Anon("club_leadership_email_log", "fk_member_id", new() { ["Email"] = Erased }),
        Anon("district_report_reminder_log", "fk_member_id", new() { ["member_name"] = ErasedName }),
        Anon("event_payment_members", "fk_member_profile_id", new()
        {
            ["MemberName"] = ErasedName, ["Mobile"] = null, ["Email"] = null, ["PartnerName"] = null,
            ["PartnerMobile"] = null, ["PartnerEmail"] = null, ["PartnerGender"] = null,
        }),
        new("event_payment_otp", MatchBy.Email, "Email", EraseAction.DeleteRows, null, false),
        new("event_payment_otp", MatchBy.Mobile, "Mobile", EraseAction.DeleteRows, null, false),
        Anon("potential_members", "fk_member_master_profile_id_as_referrer", new() { ["fk_member_master_profile_id_as_referrer"] = null }),

        // ── Contacts, prospects and guest invites (N3, 2026-10-23): non-members, tied by address ──
        new("contacts", MatchBy.Email, "email", EraseAction.DeleteRows),
        new("contacts", MatchBy.Mobile, "mobile", EraseAction.DeleteRows),
        new("potential_members", MatchBy.Email, "email", EraseAction.DeleteRows),
        new("potential_members", MatchBy.Mobile, "mobile_number", EraseAction.DeleteRows),
        Anon("potential_members", "fk_owner_member_id", new() { ["fk_owner_member_id"] = null }),
        Anon("club_mass_email_recipients", "Email", new() { ["MemberName"] = ErasedName, ["Email"] = Erased }, MatchBy.Email),
        Del("member_invite_links", "fk_member_id", export: false),
        Del("invite_prompt_log", "fk_member_id", export: false),

        // ── Message logs: tied by address, not by member ─────────────────────────────────────
        Anon("email_log", "recipient_email", new() { ["recipient_email"] = Erased, ["cc_emails"] = null, ["body_html"] = Erased }, MatchBy.Email),
        Del("announcement_push_log", export: false), Del("announcement_reminder_push_log", export: false), Del("event_push_log", export: false),
        Del("event_reminder_push_log", export: false), Del("document_push_log", export: false), Del("newsletter_push_log", export: false),
        Del("project_push_log", export: false),
        Del("greeting_send_log", "fk_member_id"), Del("login_announcement_reads", "fk_member_id"),
        Del("goal_message_thread_seen", "fk_member_id"),

        // ── Audit ─────────────────────────────────────────────────────────────────────────────
        Anon("audit_log", MemberCol, new() { ["member_name"] = null, ["ip_address"] = null }),
        Del("login_audit_logs", "fk_member_id"),
        Anon("superadmin_audit", "fk_target_member_id", new() { ["IpAddress"] = null, ["OtpSentTo"] = null }),

        // ── Rotary.org caches and sync records ───────────────────────────────────────────────
        new("rotary_org_club_members_cache", MatchBy.RotaryId, "RotaryMemberId", EraseAction.DeleteRows),
        new("rotary_org_terminated_cache", MatchBy.RotaryId, "RotaryMemberId", EraseAction.DeleteRows),
        Del("rotary_org_member_recognition"),
        new("sync_exception_log", MatchBy.RotaryId, "rotary_id", EraseAction.DeleteRows),
        Del("sync_exception_log"),

        // ── Other references ─────────────────────────────────────────────────────────────────
        Anon("website_training_appointments", "fk_booker_member_id", new() { ["fk_booker_member_id"] = null }),
        Del("assistant_conversations", "fk_member_id"),
        Del("assistant_turns", "fk_member_id"),
        // Foundation designations entered by club / district admins (build spec 3.12).
        Del("member_foundation_designations"),
        // Membership milestones and PHF highlights with their spotlight card status (build list #26-#28).
        // Target celebrations are rows of the club (no member), so they are not touched.
        Del("engagement_events"),
        // Escalation alerts the member received as a club officer: the club's alert log stays, without the recipient.
        Anon("escalation_alerts", "fk_member_id", new() { ["fk_member_id"] = null, ["recipient_name"] = ErasedName }),
        // N8 Meetings: the member's own calendar feed (its token is a credential, not exported) and reminder claims.
        Del("meeting_calendar_feeds", "fk_member_id", export: false),
        Del("meeting_reminder_log", "fk_member_id"),
        // N5 Communication: the member's email / push choices, and bounce or complaint suppressions of their address.
        Del("member_channel_consents", "fk_member_id"),
        new("comm_suppressions", MatchBy.Email, "email", EraseAction.DeleteRows),
        // Chat: the member's messages stay in the other members' history with the text erased.
        Anon("chat_messages", "sender_id", new() { ["body"] = Erased }),
        Del("chat_members", "member_id"),
        Anon("chat_reports", "reporter_id", new() { ["reason"] = null }),

        // ── Tables created by the privacy work ───────────────────────────────────────────────
        Anon("member_consents", "fk_member_id", new() { ["ip_address"] = null }),
        Keep("privacy_requests", "fk_member_id", export: false),

        // ── Grants (Services/GrantService.cs): the club's application record stays; the member's own rows go ──
        Keep("grant_applications", "created_by"),
        Del("grant_application_members", "fk_member_id"),
        Keep("grant_events", "fk_member_id"),
        Del("grant_notifications", "fk_member_id"),
        Keep("grant_payments", "recorded_by"),
        Keep("grant_attachments", "uploaded_by"),

        // ── Volunteers and speakers (Services/VolunteerService.cs, SpeakerService.cs) ──
        // Recorded hours are already in the project's total, so sign-ups are anonymised, not deleted.
        Anon("volunteer_signups", "fk_member_id", new() { ["fk_member_id"] = null, ["name"] = ErasedName, ["email"] = null }),
        Anon("volunteer_signups", "email", new() { ["name"] = ErasedName, ["email"] = null }, MatchBy.Email),
        Del("meeting_duties", "fk_member_id"),
        Anon("club_speakers", "email", new()
        {
            ["name"] = ErasedName, ["email"] = null, ["phone"] = null, ["bio"] = null, ["photo_path"] = null, ["show_on_website"] = 0,
        }, MatchBy.Email),

        // ── Planning mode (Services/PlanningService.cs): the member's elect roles and queued RI officer pushes go ──
        Del("planning_roles", "fk_member_id"),
        Del("ri_outbound_queue", "fk_member_id"),
    };

    /// <summary>Column names that look personal (WS7-01 audit).</summary>
    public static readonly Regex PersonalColumn = new(@"email|mobile|phone|birth|anniv|blood|address|photo|(^|_)ip(_|$)|ipaddress|device|fcm|password|spouse|gender|recipient|member_?name", RegexOptions.IgnoreCase);

    /// <summary>Columns that match the pattern but are flags, counters or campaign settings.</summary>
    public static readonly Regex NotPersonalColumn = new(@"^(pk_|is|has|total)|count$|sent_?date$|subject|body|header|reminder|target|type$|zoneids|districtids|subgroupids|logo", RegexOptions.IgnoreCase);

    /// <summary>Tables with personal-looking columns that are not about a member; the audit does not report them.</summary>
    public static readonly IReadOnlySet<string> AuditIgnoredTables = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "club_master", "district_master", "zone_master", "club_website_contact_detail", "rotary_org_clubs_cache",
        "cashfree_kyc", "system_settings",
        "country_master", "designation_master", "email_templates", "club_websites", "district_websites",
        // Campaign and report settings typed in by admins, not a member's data.
        "club_dues", "membership_dues", "event_payment_links", "club_mass_emails", "district_performance_report_log",
        // Public office holders, club-level Rotary.org credentials, project-sync caller IPs.
        "international_president", "club_rotary_org_credentials", "rotary_org_project_sync_log",
        // N5: a club's or district's sender addresses and the Governor's greeting note (a public office holder's text).
        "comm_settings",
    };
}
