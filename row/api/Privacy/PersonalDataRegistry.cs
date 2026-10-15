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
        Del("district_club_moderator", "fk_member_id"),
        Del("goal_role_assignments", "fk_member_id"),
        Del("goal_oversight_access", "fk_member_id"),
        Keep("club_attendance_members", "fk_member_id"),
        Anon("club_mass_email_recipients", "fk_member_id", new() { ["MemberName"] = ErasedName, ["Email"] = Erased }),
        Anon("club_leadership_email_log", "fk_member_id", new() { ["Email"] = Erased }),
        Anon("district_report_reminder_log", "fk_member_id", new() { ["member_name"] = ErasedName }),
        Anon("district_directory_submission_log", "fk_member_id", new() { ["IpAddress"] = null, ["FilledByAdminMobile"] = null }),
        Keep("directory_data_member_status", "fk_member_id"),
        Anon("event_payment_members", "fk_member_profile_id", new()
        {
            ["MemberName"] = ErasedName, ["Mobile"] = null, ["Email"] = null, ["PartnerName"] = null,
            ["PartnerMobile"] = null, ["PartnerEmail"] = null, ["PartnerGender"] = null,
        }),
        new("event_payment_otp", MatchBy.Email, "Email", EraseAction.DeleteRows, null, false),
        new("event_payment_otp", MatchBy.Mobile, "Mobile", EraseAction.DeleteRows, null, false),
        Anon("potential_members", "fk_member_master_profile_id_as_referrer", new() { ["fk_member_master_profile_id_as_referrer"] = null }),

        // ── Message logs: tied by address, not by member ─────────────────────────────────────
        Anon("email_log", "recipient_email", new() { ["recipient_email"] = Erased, ["cc_emails"] = null, ["body_html"] = Erased }, MatchBy.Email),
        Anon("whatsapp_log", "recipient_mobile", new() { ["recipient_mobile"] = Erased, ["recipient_name"] = Erased, ["body_preview"] = Erased }, MatchBy.Mobile),
        Anon("whatsapp_log", "fk_member_profile_id", new() { ["recipient_mobile"] = Erased, ["recipient_name"] = Erased, ["body_preview"] = Erased }),
        Del("announcement_push_log", export: false), Del("announcement_reminder_push_log", export: false), Del("event_push_log", export: false),
        Del("event_reminder_push_log", export: false), Del("document_push_log", export: false), Del("newsletter_push_log", export: false),
        Del("project_push_log", export: false),
        Del("greeting_send_log", "fk_member_id"), Del("login_announcement_reads", "fk_member_id"),
        Del("goal_message_seen", "fk_member_id"), Del("goal_message_thread_seen", "fk_member_id"),

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
        Del("ri_director_credential_email", "fk_member_id", export: false),
        Del("assistant_conversations", "fk_member_id"),
        Del("assistant_turns", "fk_member_id"),

        // ── Tables created by the privacy work ───────────────────────────────────────────────
        Anon("member_consents", "fk_member_id", new() { ["ip_address"] = null }),
        Keep("privacy_requests", "fk_member_id", export: false),
    };

    /// <summary>Column names that look personal (WS7-01 audit).</summary>
    public static readonly Regex PersonalColumn = new(@"email|mobile|phone|birth|anniv|blood|address|photo|(^|_)ip(_|$)|ipaddress|device|fcm|password|spouse|gender|recipient|member_?name", RegexOptions.IgnoreCase);

    /// <summary>Columns that match the pattern but are flags, counters or campaign settings.</summary>
    public static readonly Regex NotPersonalColumn = new(@"^(pk_|is|has|total)|count$|sent_?date$|subject|body|header|reminder|target|type$|zoneids|districtids|subgroupids|logo", RegexOptions.IgnoreCase);

    /// <summary>Tables with personal-looking columns that are not about a member; the audit does not report them.</summary>
    public static readonly IReadOnlySet<string> AuditIgnoredTables = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "club_master", "district_master", "zone_master", "club_website_contact_detail", "rotary_org_clubs_cache",
        "district_directory_config", "pph_camp_attendies", "pph_camp_attendance", "cashfree_kyc", "system_settings",
        "country_master", "designation_master", "email_templates", "club_websites", "district_websites",
        // Campaign and report settings typed in by admins, not a member's data.
        "club_dues", "membership_dues", "event_payment_links", "club_mass_emails", "district_performance_report_log",
        // Public office holders, camp venues, club-level Rotary.org credentials, project-sync caller IPs.
        "international_president", "pph_camps", "club_rotary_org_credentials", "rotary_org_project_sync_log",
    };
}
