using System.Security.Claims;

namespace RotaryApi.Services;

// Reusable helper to read a user's roles from the current HttpContext / ClaimsPrincipal
// and answer permission questions. Used by both web-portal JWTs and mobile JWTs.
//
// Role mutual exclusion:
//   SuperAdmin, Admin (district/club), ZonalCoordinator, RIDirector — only ONE of these at a time.
//   AG, ClubModerator, Member — stackable with any of the above.
public static class UserPermissionHelper
{
    public const string SuperAdmin = "SuperAdmin";
    public const string Admin = "Admin";
    public const string ZonalCoordinator = "ZonalCoordinator";
    public const string RIDirector = "RIDirector";
    public const string AG = "AG";
    public const string ClubModerator = "ClubModerator";
    public const string Member = "Member";

    public static List<string> GetRoles(ClaimsPrincipal? user)
    {
        var claim = user?.FindFirst("roles")?.Value;
        if (string.IsNullOrWhiteSpace(claim)) return new List<string>();
        return claim.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }

    public static bool HasRole(ClaimsPrincipal? user, string roleName)
    {
        var roles = GetRoles(user);
        return roles.Any(r => r.Equals(roleName, StringComparison.OrdinalIgnoreCase));
    }

    public static bool IsSuperAdmin(ClaimsPrincipal? user) => HasRole(user, SuperAdmin);
    public static bool IsAdmin(ClaimsPrincipal? user) => HasRole(user, Admin);
    public static bool IsZonalCoordinator(ClaimsPrincipal? user) => HasRole(user, ZonalCoordinator);
    public static bool IsRIDirector(ClaimsPrincipal? user) => HasRole(user, RIDirector);
    public static bool IsAG(ClaimsPrincipal? user) => HasRole(user, AG);
    public static bool IsClubModerator(ClaimsPrincipal? user) => HasRole(user, ClubModerator);

    // ─── CRUD permission rules ───
    //
    // Zone CRUD:       SuperAdmin only
    // District CRUD:   SuperAdmin only
    // Club CRUD:       SuperAdmin only
    // Member Directory CRUD: SuperAdmin only
    //
    // Everyone else (RIDirector, ZC, Admin, AG, Moderator, Member) is view-only on these.
    public static bool CanCrudZone(ClaimsPrincipal? user) => IsSuperAdmin(user);
    public static bool CanCrudDistrict(ClaimsPrincipal? user) => IsSuperAdmin(user);
    public static bool CanCrudClub(ClaimsPrincipal? user) => IsSuperAdmin(user);
    public static bool CanCrudDirectoryMember(ClaimsPrincipal? user) => IsSuperAdmin(user);

    // Module CRUD (projects, reports, pph-camps, zonal-awards, citation, etc.):
    // Allowed for: SuperAdmin, RIDirector, ZonalCoordinator (in zone), Admin (in scope), AG, ClubModerator.
    // Member / Family: read-only.
    public static bool CanCrudModules(ClaimsPrincipal? user)
    {
        var roles = GetRoles(user);
        if (roles.Count == 0) return false;
        // Anyone with an elevated role can CRUD modules (scoped checks happen elsewhere)
        return roles.Any(r =>
            r.Equals(SuperAdmin, StringComparison.OrdinalIgnoreCase) ||
            r.Equals(RIDirector, StringComparison.OrdinalIgnoreCase) ||
            r.Equals(ZonalCoordinator, StringComparison.OrdinalIgnoreCase) ||
            r.Equals(Admin, StringComparison.OrdinalIgnoreCase) ||
            r.Equals(AG, StringComparison.OrdinalIgnoreCase) ||
            r.Equals(ClubModerator, StringComparison.OrdinalIgnoreCase));
    }

    // Helper: is the member effectively view-only on the org structure (zones/districts/clubs/directory)?
    public static bool IsOrgStructureReadOnly(ClaimsPrincipal? user)
    {
        // View-only for everyone except SuperAdmin
        return !IsSuperAdmin(user);
    }

    // ─── Directory-Member partial-edit policy ────────────────────────────────────
    // SuperAdmin: edit anything.
    // Self (member editing own profile): edit anything (per project rule).
    // Admin (Club Admin / District Admin): edit most fields BUT cannot change the
    //   10 fields listed in DirectoryMemberLockedFields below — those are admin-
    //   maintained identity fields and a CA shouldn't be able to rewrite them on
    //   another member's record.
    // All other roles (RIDirector, ZC, AG, ClubModerator, Member): read-only.
    public static bool CanPartialEditDirectoryMember(ClaimsPrincipal? user) => IsAdmin(user);

    // Field names match UpdateMemberDto property names. Used by both:
    //   1. MembersController.Update — strips Admin attempts to change these fields
    //      by reverting them to the existing DB value before calling the service.
    //   2. Frontend — same list used to mark these inputs as read-only in the UI
    //      so an Admin user sees the value but cannot edit it.
    // If you add/remove a field here, update the frontend list in the matching
    // edit page (app/members/edit/[id]/page.tsx) AND any V2 member edit dialog.
    public static readonly IReadOnlySet<string> DirectoryMemberLockedFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        // Update 2026-06-10: Club Admin needs to maintain Primary Mobile,
        // Email, and Primary Country for their club's members (members change
        // phones, emails, move countries). These three are removed from the
        // lock. Duplicate detection runs in MembersController.Update — a new
        // mobile / email that collides with another active member is rejected
        // with a 409 + friendly message; mobile changes also force the affected
        // member to re-log in on mobile (mobile_force_relogin_at column).
        nameof(DTOs.UpdateMemberDto.SecondaryMobileNumber),
        nameof(DTOs.UpdateMemberDto.RotaryId),
        // IsHonoraryMember moved to club_members 2026-06-26 (per-club); managed by a
        // separate SuperAdmin-only endpoint, no longer part of the member edit DTO lock.
        nameof(DTOs.UpdateMemberDto.IsYouth),
        nameof(DTOs.UpdateMemberDto.JoinedDate),              // Date of Joining (lives on club_members but passed via the DTO)
        nameof(DTOs.UpdateMemberDto.IsPersonalDetailsVisible),
        nameof(DTOs.UpdateMemberDto.FkSecondaryCountryId),
        nameof(DTOs.UpdateMemberDto.IsFamilyDetailsVisible),  // checkbox only — actual family member rows stay editable
        nameof(DTOs.UpdateMemberDto.PrimaryLanguage),
    };

    // ─── Mobile self-edit partial-lock ──────────────────────────────────────
    // When a Member edits their OWN profile via the mobile app, these 4 fields
    // stay read-only. Rationale: changes to mobile / rotary ID / email / honorary
    // status need admin approval — letting members self-modify them would silently
    // break login, billing, and role inheritance. Web self-edit (e.g. a SuperAdmin
    // editing their own profile from the portal) is NOT subject to this lock.
    // Detected via the "loginType=mobile" claim set in MobileAuthService.
    public static bool IsMobileLogin(ClaimsPrincipal? user) =>
        user?.FindFirst("loginType")?.Value?.Equals("mobile", StringComparison.OrdinalIgnoreCase) == true;

    public static readonly IReadOnlySet<string> MobileSelfEditLockedFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        nameof(DTOs.UpdateMemberDto.PrimaryMobileNumber),
        nameof(DTOs.UpdateMemberDto.RotaryId),
        nameof(DTOs.UpdateMemberDto.EmailId),
        // IsHonoraryMember moved to club_members (per-club) 2026-06-26 — not on this DTO anymore.
    };
}
