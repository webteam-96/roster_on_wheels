/**
 * Personal-data registry (master plan WS7-01, Appendix G): every table that holds data about a member,
 * how its rows are tied to the member, and what erasure does to it. Export and erasure are both driven
 * from this list, so a new table with personal data needs one entry here.
 *
 * Table and column names are the ROW schema's (database/schema.sql). At run time the privacy service
 * checks each entry against information_schema and skips tables or columns that do not exist, so the
 * registry can name tables a deployment has not created yet (for example the assistant tables).
 */

/** How a table's rows are tied to the member being exported or erased. */
export type Match =
  | { by: "memberId"; column: string }
  | { by: "email"; column: string }
  | { by: "mobile"; column: string }
  | { by: "rotaryId"; column: string };

/** What erasure does to the matched rows. */
export type EraseAction =
  | { action: "deleteRows" }
  /** Set columns to fixed values (null, a marker, a flag); the row stays. */
  | { action: "anonymise"; set: Record<string, string | number | null> }
  /** Leave the rows (financial or activity records pointing at the anonymised member). */
  | { action: "keep" };

export interface PersonalTable {
  table: string;
  match: Match;
  onErase: EraseAction;
  /** Include in the member's export (default true). */
  export?: boolean;
}

/** Marker written over message bodies and recipients of an erased member. */
export const ERASED = "[erased]";
export const ERASED_NAME = "Erased member";

const del: EraseAction = { action: "deleteRows" };
const keep: EraseAction = { action: "keep" };
const anon = (set: Record<string, string | number | null>): EraseAction => ({ action: "anonymise", set });
const byMember = (column = "fk_member_master_profile_id"): Match => ({ by: "memberId", column });

export const PERSONAL_DATA: readonly PersonalTable[] = [
  // ── The member ───────────────────────────────────────────────────────────────────────────
  {
    table: "member_master_profile", match: byMember("pk_member_master_profile_id"),
    onErase: anon({
      MemberName: ERASED_NAME, ProfilePhotoPath: null, FamilyPhotoPath: null, PrimaryMobileNumber: null,
      SecondaryMobileNumber: null, EmailId: null, SecondaryEmailId: null, BirthDate: null, AnniversaryDate: null,
      BloodGroup: null, Gender: null, RotaryId: null, PrimaryLanguage: null, MemberIntroduction: null,
      LastDeviceToken: null, LastDeviceName: null, Facebook: null, Instagram: null, LinkedIn: null, Twitter: null,
      Youtube: null, Website: null, isdeleted: 1,
    }),
  },
  { table: "member_credentials", match: byMember(), onErase: del, export: false },
  // Address and family rows cannot be hard-deleted (schema triggers trg_prevent_hard_delete_*):
  // every personal column is blanked and the row soft-deleted.
  { table: "member_address_details", match: byMember(),
    onErase: anon({ Address: null, PhoneNumber: null, State: null, City: null, PinCode: null, BusinessName: null, BusinessEmailId: null, Keywords: null, isdeleted: 1 }) },
  { table: "member_family_details", match: byMember(),
    onErase: anon({ Name: ERASED_NAME, Relation: null, BloodGroup: null, PhoneNumber: null, EmailId: null, BirthDate: null, AnniversaryDate: null, PhotoPath: null, isdeleted: 1 }) },
  { table: "password_reset_tokens", match: byMember(), onErase: del, export: false },
  { table: "web_sso_token", match: byMember(), onErase: del, export: false },
  { table: "mobile_login_otp", match: byMember(), onErase: del, export: false },
  { table: "member_fcm_tokens", match: byMember(), onErase: del },
  { table: "member_device_sessions", match: byMember(), onErase: del },

  // ── Memberships and roles: facts kept, pointing at the anonymised member ─────────────────
  { table: "club_members", match: byMember(), onErase: anon({ isdeleted: 1 }) },
  { table: "member_roles", match: byMember(), onErase: anon({ isdeleted: 1, IsActive: 0 }) },
  { table: "sub_group_members", match: byMember(), onErase: anon({ isdeleted: 1 }) },
  { table: "board_of_directors", match: byMember(), onErase: anon({ non_member_mobile: null, non_member_email: null }) },
  { table: "past_presidents", match: byMember(), onErase: anon({ non_member_photo: null }) },

  // ── Copies of name, email, mobile, photo ──────────────────────────────────────────────────
  ...["district_committee_member", "district_committee_group_member", "district_committee_sub_group_member"].map(
    (table): PersonalTable => ({ table, match: byMember("fk_member_id"), onErase: anon({ name: ERASED_NAME, mobile: null, email: null, profile_photo: null }) }),
  ),
  // A governor's name and year are public record; anonymised until counsel says otherwise (master plan Q6).
  { table: "district_governors", match: byMember("fk_member_id"), onErase: anon({ member_name: ERASED_NAME, profile_photo: null, email: null, mobile_number: null }) },
  ...["district_ag", "district_club_moderator", "goal_role_assignments", "goal_oversight_access"].map(
    (table): PersonalTable => ({ table, match: byMember("fk_member_id"), onErase: del }),
  ),
  { table: "club_attendance_members", match: byMember("fk_member_id"), onErase: keep },
  { table: "club_mass_email_recipients", match: byMember("fk_member_id"), onErase: anon({ MemberName: ERASED_NAME, Email: ERASED }) },
  { table: "club_leadership_email_log", match: byMember("fk_member_id"), onErase: anon({ Email: ERASED }) },
  { table: "district_report_reminder_log", match: byMember("fk_member_id"), onErase: anon({ member_name: ERASED_NAME }) },
  { table: "district_directory_submission_log", match: byMember("fk_member_id"), onErase: anon({ IpAddress: null, FilledByAdminMobile: null }) },
  { table: "directory_data_member_status", match: byMember("fk_member_id"), onErase: keep },
  { table: "event_payment_members", match: byMember("fk_member_profile_id"),
    onErase: anon({ MemberName: ERASED_NAME, Mobile: null, Email: null, PartnerName: null, PartnerMobile: null, PartnerEmail: null, PartnerGender: null }) },
  { table: "event_payment_otp", match: { by: "email", column: "Email" }, onErase: del, export: false },
  { table: "event_payment_otp", match: { by: "mobile", column: "Mobile" }, onErase: del, export: false },
  { table: "potential_members", match: byMember("fk_member_master_profile_id_as_referrer"), onErase: anon({ fk_member_master_profile_id_as_referrer: null }) },

  // ── Message logs: tied by address, not by member ─────────────────────────────────────────
  { table: "email_log", match: { by: "email", column: "recipient_email" }, onErase: anon({ recipient_email: ERASED, cc_emails: null, body_html: ERASED }) },
  { table: "whatsapp_log", match: { by: "mobile", column: "recipient_mobile" }, onErase: anon({ recipient_mobile: ERASED, recipient_name: ERASED, body_preview: ERASED }) },
  { table: "whatsapp_log", match: byMember("fk_member_profile_id"), onErase: anon({ recipient_mobile: ERASED, recipient_name: ERASED, body_preview: ERASED }) },
  ...["announcement_push_log", "announcement_reminder_push_log", "event_push_log", "event_reminder_push_log", "document_push_log", "newsletter_push_log", "project_push_log"].map(
    (table): PersonalTable => ({ table, match: byMember(), onErase: del, export: false }),
  ),
  ...["greeting_send_log", "login_announcement_reads", "goal_message_seen", "goal_message_thread_seen"].map(
    (table): PersonalTable => ({ table, match: byMember("fk_member_id"), onErase: del }),
  ),

  // ── Audit ─────────────────────────────────────────────────────────────────────────────────
  { table: "audit_log", match: byMember(), onErase: anon({ member_name: null, ip_address: null }) },
  { table: "login_audit_logs", match: byMember("fk_member_id"), onErase: del },
  { table: "superadmin_audit", match: byMember("fk_target_member_id"), onErase: anon({ IpAddress: null, OtpSentTo: null }) },

  // ── Rotary.org caches and sync records (by Rotary id) ────────────────────────────────────
  { table: "rotary_org_club_members_cache", match: { by: "rotaryId", column: "RotaryMemberId" }, onErase: del },
  { table: "rotary_org_terminated_cache", match: { by: "rotaryId", column: "RotaryMemberId" }, onErase: del },
  { table: "rotary_org_member_recognition", match: byMember(), onErase: del },
  { table: "sync_exception_log", match: { by: "rotaryId", column: "rotary_id" }, onErase: del },
  { table: "sync_exception_log", match: byMember(), onErase: del },

  // ── Other references ─────────────────────────────────────────────────────────────────────
  { table: "website_training_appointments", match: byMember("fk_booker_member_id"), onErase: anon({ fk_booker_member_id: null }) },
  { table: "ri_director_credential_email", match: byMember("fk_member_id"), onErase: del, export: false },
  { table: "assistant_conversations", match: byMember("fk_member_id"), onErase: del },
  { table: "assistant_turns", match: byMember("fk_member_id"), onErase: del },

  // ── Tables created by the privacy work ───────────────────────────────────────────────────
  { table: "member_consents", match: byMember("fk_member_id"), onErase: anon({ ip_address: null }) },
  { table: "privacy_requests", match: byMember("fk_member_id"), onErase: keep, export: false },
];

/** Column names that look personal (WS7-01 audit): a table holding one of these must be in the registry or ignored. */
export const PERSONAL_COLUMN_PATTERN = /email|mobile|phone|birth|anniv|blood|address|photo|(^|_)ip(_|$)|ipaddress|device|fcm|password|spouse|gender|recipient|member_?name/i;

/** Columns that match the pattern but are flags, counters or campaign settings, not data about a person. */
export const NOT_PERSONAL_COLUMN = /^(pk_|is|has|total)|count$|sent_?date$|subject|body|header|reminder|target|type$|zoneids|districtids|subgroupids|logo/i;

/**
 * Tables with personal-looking columns that are not about a member (club and district contacts,
 * configuration, camp attendees outside member erasure) — the audit does not report them.
 */
export const AUDIT_IGNORED_TABLES: readonly string[] = [
  "club_master", "district_master", "zone_master", "club_website_contact_detail", "rotary_org_clubs_cache",
  "district_directory_config", "pph_camp_attendies", "pph_camp_attendance", "cashfree_kyc", "system_settings",
  "country_master", "designation_master", "email_templates", "club_websites", "district_websites",
  // Campaign and report settings: addresses typed in by admins for a campaign or report, not a member's data.
  "club_dues", "membership_dues", "event_payment_links", "club_mass_emails", "district_performance_report_log",
  // Public office holders (Rotary International president), camp venues, club-level Rotary.org credentials.
  "international_president", "pph_camps", "club_rotary_org_credentials",
  // Project-sync audit: caller IP of a sync request, kept with the sync log's own retention.
  "rotary_org_project_sync_log",
];
