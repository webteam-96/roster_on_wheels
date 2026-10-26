using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RotaryApi.Services;

/// <summary>403 unless the caller is a SuperAdmin: for platform-wide master lists that some routes reach from a club URL.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class SuperAdminOnlyAttribute : ActionFilterAttribute
{
    public override Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (UserPermissionHelper.IsSuperAdmin(context.HttpContext.User)) return next();
        context.Result = new ObjectResult(new { message = "Only a SuperAdmin can change this list." }) { StatusCode = 403 };
        return Task.CompletedTask;
    }
}

/// <summary>Ownership checks for <see cref="OwnedByAttribute"/>: @Id is the record, @Scope its club, district or parent.</summary>
public static class Owns
{
    public const string ClubAdvertisement = "SELECT 1 FROM club_website_advertisement WHERE pk_club_website_advertisement_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string ClubContactDetail = "SELECT 1 FROM club_website_contact_detail WHERE pk_club_website_contact_detail_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string ClubSocialLink = "SELECT 1 FROM club_website_social_link WHERE pk_club_website_social_link_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string ClubMonthlyReport = "SELECT 1 FROM club_monthly_reports WHERE pk_report_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string ClubDocument = "SELECT 1 FROM club_documents WHERE pk_document_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictDocument = "SELECT 1 FROM club_documents WHERE pk_document_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string OcvDocument = "SELECT 1 FROM ocv_documents WHERE pk_document_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string PastPresident = "SELECT 1 FROM past_presidents WHERE pk_past_president_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string ClubSubGroup = "SELECT 1 FROM sub_groups WHERE pk_sub_group_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictSubGroup = "SELECT 1 FROM sub_groups WHERE pk_sub_group_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string TrfContribution = "SELECT 1 FROM trf_contributions WHERE pk_trf_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string ClubWeblink = "SELECT 1 FROM weblinks WHERE pk_weblink_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictWeblink = "SELECT 1 FROM weblinks WHERE pk_weblink_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string ClubAnnouncement = "SELECT 1 FROM announcements WHERE pk_announcement_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictAnnouncement = "SELECT 1 FROM announcements WHERE pk_announcement_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string ClubNewsletter = "SELECT 1 FROM newsletters WHERE pk_newsletter_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictNewsletter = "SELECT 1 FROM newsletters WHERE pk_newsletter_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string ClubEvent = "SELECT 1 FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictEvent = "SELECT 1 FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string BoardDirector = "SELECT 1 FROM board_of_directors WHERE pk_board_director_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string DistrictMenu = "SELECT 1 FROM club_website_menu WHERE pk_club_website_menu_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string SubMenuInMenu = "SELECT 1 FROM club_website_submenu WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @Scope LIMIT 1";
    public const string ClubInDistrict = "SELECT 1 FROM club_master WHERE pk_club_id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string MemberInClub = "SELECT 1 FROM club_members WHERE fk_member_master_profile_id = @Id AND fk_club_id = @Scope LIMIT 1";
    public const string CommitteeGroup = "SELECT 1 FROM district_committee_group WHERE id = @Id AND fk_district_id = @Scope LIMIT 1";
    public const string CommitteeGroupMember = "SELECT 1 FROM district_committee_group_member WHERE id = @Id AND fk_group_id = @Scope LIMIT 1";
    public const string CommitteeSubGroupInGroup = "SELECT 1 FROM district_committee_sub_group WHERE id = @Id AND fk_group_id = @Scope LIMIT 1";
    public const string CommitteeSubGroup = "SELECT 1 FROM district_committee_sub_group sg JOIN district_committee_group g ON g.id = sg.fk_group_id WHERE sg.id = @Id AND g.fk_district_id = @Scope LIMIT 1";
    public const string CommitteeSubGroupMember = "SELECT 1 FROM district_committee_sub_group_member WHERE id = @Id AND fk_sub_group_id = @Scope LIMIT 1";
    public const string EventRegistration = "SELECT 1 FROM event_payment_registrations WHERE pk_id = @Id AND fk_payment_link_id = @Scope LIMIT 1";
    public const string EventDesignation = "SELECT 1 FROM event_payment_designations WHERE pk_id = @Id AND fk_payment_link_id = @Scope LIMIT 1";
}
