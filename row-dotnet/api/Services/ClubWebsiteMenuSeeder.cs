using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Self-contained copy of ClubWebsitesController's default-menu seeding, so the self-service
// purchase flow (WebsiteBillingService) can seed the same 8 default menus + 6 avenue sub-menus
// on a newly-created club_websites row WITHOUT editing the controller (whose ProjectsSubMenus is
// referenced elsewhere, e.g. DatabaseInitializer backfill). Keep in sync with the controller's copy.
public static class ClubWebsiteMenuSeeder
{
    // 8 default top-level menus (+ 1 admin-added custom slot). "Club Service" is NOT a default
    // top-level tab — the Club Service *avenue* lives as a sub-menu under Projects instead.
    private static readonly (string Name, string LinkValue)[] DefaultMenus =
    {
        ("Home",            "home"),
        ("About",           "about"),
        ("Directory",       "directory"),
        ("Directors",       "directors"),
        ("Calendar",        "calendar"),
        ("Events",          "events"),
        ("Projects",        "projects"),
        ("Past Presidents", "past-presidents"),
    };

    private static readonly (string Name, string AvenueKey)[] ProjectsSubMenus =
    {
        ("Community Service",      "community_service"),
        ("Club Service",           "club_service"),
        ("Vocational Service",     "vocational_service"),
        ("New Generation Service", "new_generation_service"),
        ("International Service",  "international_service"),
        ("Public Image Initiative","public_image_initiative"),
    };

    // Canonical default link_values seeded below — used for the idempotency guard.
    private const string CanonicalLinkList =
        "('home','about','directory','directors','calendar','events','projects','past-presidents')";

    public static async Task SeedDefaultMenusAsync(MySqlConnection conn, int clubId, int userId)
    {
        // Idempotent: if the canonical default set is already present, do nothing. Re-running
        // the seeder previously stacked a second set of tabs on top → duplicate navigation.
        var canonical = await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM club_website_menu
            WHERE fk_club_id = @ClubId AND is_default = 1 AND isdeleted = 0
              AND link_value IN {CanonicalLinkList}",
            new { ClubId = clubId });
        if (canonical > 0) return;

        // Retire any pre-existing default menus (e.g. legacy .aspx tabs migrated from the old
        // site) + their sub-menus, so the fresh canonical set below can't sit next to a
        // duplicate-label legacy set. Custom (is_default = 0) menus are left untouched.
        await conn.ExecuteAsync(@"
            UPDATE club_website_submenu s
            JOIN club_website_menu m ON m.pk_club_website_menu_id = s.fk_menu_id
            SET s.isdeleted = 1
            WHERE m.fk_club_id = @ClubId AND m.is_default = 1 AND m.isdeleted = 0 AND s.isdeleted = 0",
            new { ClubId = clubId });
        await conn.ExecuteAsync(@"
            UPDATE club_website_menu SET isdeleted = 1
            WHERE fk_club_id = @ClubId AND is_default = 1 AND isdeleted = 0",
            new { ClubId = clubId });

        int? projectsMenuId = null;
        for (int i = 0; i < DefaultMenus.Length; i++)
        {
            var (name, linkValue) = DefaultMenus[i];
            var menuId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO club_website_menu
                    (fk_club_id, menu_name, link_type, link_value, sort_order, is_active, is_default, created_by, isdeleted)
                VALUES (@ClubId, @Name, 'page', @LinkValue, @Sort, 1, 1, @UserId, 0);
                SELECT LAST_INSERT_ID();",
                new { ClubId = clubId, Name = name, LinkValue = linkValue, Sort = i + 1, UserId = userId });
            if (linkValue == "projects") projectsMenuId = menuId;
        }

        if (projectsMenuId.HasValue)
            await SeedProjectsSubMenusAsync(conn, projectsMenuId.Value, userId);
    }

    private static async Task SeedProjectsSubMenusAsync(MySqlConnection conn, int projectsMenuId, int userId)
    {
        for (int i = 0; i < ProjectsSubMenus.Length; i++)
        {
            var (name, key) = ProjectsSubMenus[i];
            // Keyed on the stable avenue link_value (not name) and counting regardless of
            // isdeleted, so admin renames don't duplicate and deletes aren't resurrected.
            var existing = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_website_submenu
                WHERE fk_menu_id = @MenuId AND link_value = @Key",
                new { MenuId = projectsMenuId, Key = key });
            if (existing > 0) continue;

            await conn.ExecuteAsync(@"
                INSERT INTO club_website_submenu
                    (fk_menu_id, submenu_name, link_type, link_value, sort_order,
                     is_active, is_system_managed, created_by, isdeleted)
                VALUES
                    (@MenuId, @Name, 'page', @Key, @Sort, 1, 1, @UserId, 0)",
                new { MenuId = projectsMenuId, Name = name, Key = key, Sort = i + 1, UserId = userId });
        }
    }
}
