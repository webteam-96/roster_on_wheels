using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubMenuService : IClubMenuService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public ClubMenuService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ===== Menu =====

    public async Task<List<ClubMenuDto>> GetMenusByClubAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Inline SQL — SP `sp_club_menu_get_by_club` cannot be updated due to SYSTEM_USER privilege issue.
        // link_value: filename-only when link_type='document'; wrapped via CASE/CONCAT so callers
        // continue to receive the full /uploads/menu/<file> URL transparently.
        return (await connection.QueryAsync<ClubMenuDto>(@"
            SELECT m.pk_club_website_menu_id AS Id,
                   m.fk_club_id AS ClubId,
                   m.menu_name AS MenuName,
                   m.link_type AS LinkType,
                   CASE
                       WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                       WHEN m.link_type = 'document'
                            AND m.link_value NOT LIKE '/%'
                            AND m.link_value NOT LIKE 'http%'
                            THEN CONCAT('/Documents/WebsiteData/Group', m.fk_club_id, '/MENU/', m.link_value)
                       ELSE m.link_value
                   END AS LinkValue,
                   m.content_html AS ContentHtml,
                   m.sort_order AS SortOrder,
                   m.is_active AS IsActive,
                   COALESCE(m.is_default, 0) AS IsDefault,
                   (SELECT COUNT(*) FROM club_website_submenu sm
                      WHERE sm.fk_menu_id = m.pk_club_website_menu_id AND sm.isdeleted = 0) AS SubMenuCount
            FROM club_website_menu m
            WHERE m.fk_club_id = @ClubId AND m.isdeleted = 0
            ORDER BY m.sort_order, m.pk_club_website_menu_id",
            new { ClubId = clubId })).ToList();
    }

    public async Task<ClubMenuDto?> GetMenuByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubMenuDto>(@"
            SELECT m.pk_club_website_menu_id AS Id,
                   m.fk_club_id AS ClubId,
                   m.menu_name AS MenuName,
                   m.link_type AS LinkType,
                   CASE
                       WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                       WHEN m.link_type = 'document'
                            AND m.link_value NOT LIKE '/%'
                            AND m.link_value NOT LIKE 'http%'
                            THEN CONCAT('/Documents/WebsiteData/Group', m.fk_club_id, '/MENU/', m.link_value)
                       ELSE m.link_value
                   END AS LinkValue,
                   m.content_html AS ContentHtml,
                   m.sort_order AS SortOrder,
                   m.is_active AS IsActive,
                   COALESCE(m.is_default, 0) AS IsDefault,
                   (SELECT COUNT(*) FROM club_website_submenu sm
                      WHERE sm.fk_menu_id = m.pk_club_website_menu_id AND sm.isdeleted = 0) AS SubMenuCount
            FROM club_website_menu m
            WHERE m.pk_club_website_menu_id = @Id AND m.isdeleted = 0",
            new { Id = id });
    }

    // Converted from sp_club_menu_create to inline SQL — the SP can't be updated
    // (SYSTEM_USER privilege), and we need to write the new content_html column.
    public async Task<int> CreateMenuAsync(int clubId, CreateClubMenuDto dto, int createdBy)
    {
        if (string.IsNullOrWhiteSpace(dto.MenuName))
            throw new InvalidOperationException("Menu name is required.");

        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_menu
                (fk_club_id, menu_name, link_type, link_value, content_html,
                 sort_order, is_active, is_default, created_by, created_date, isdeleted)
            VALUES (@ClubId, @MenuName, @LinkType, @LinkValue, @ContentHtml,
                 @SortOrder, @IsActive, 0, @CreatedBy, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new
            {
                ClubId      = clubId,
                MenuName    = dto.MenuName,
                LinkType    = dto.LinkType,
                LinkValue   = dto.LinkValue,
                ContentHtml = dto.ContentHtml,
                SortOrder   = dto.SortOrder,
                IsActive    = dto.IsActive ? 1 : 0,
                CreatedBy   = createdBy,
            });
    }

    // Converted from sp_club_menu_update to inline SQL — same reason as Create.
    public async Task UpdateMenuAsync(int id, UpdateClubMenuDto dto, int modifiedBy)
    {
        if (string.IsNullOrWhiteSpace(dto.MenuName))
            throw new InvalidOperationException("Menu name is required.");

        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE club_website_menu
            SET menu_name    = @MenuName,
                link_type    = @LinkType,
                link_value   = @LinkValue,
                content_html = @ContentHtml,
                sort_order   = @SortOrder,
                is_active    = @IsActive,
                modified_by  = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_club_website_menu_id = @Id AND isdeleted = 0",
            new
            {
                Id          = id,
                MenuName    = dto.MenuName,
                LinkType    = dto.LinkType,
                LinkValue   = dto.LinkValue,
                ContentHtml = dto.ContentHtml,
                SortOrder   = dto.SortOrder,
                IsActive    = dto.IsActive ? 1 : 0,
                ModifiedBy  = modifiedBy,
            });
    }

    public async Task DeleteMenuAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_menu_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task ReorderMenusAsync(int id1, int id2)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_menu_reorder",
            new { p_Id1 = id1, p_Id2 = id2 },
            commandType: CommandType.StoredProcedure);
    }

    public async Task ReorderMenusBulkAsync(int clubId, IEnumerable<int> orderedIds)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Inline SQL — assigns sort_order 1..N. Scoped to clubId so a stale client list can't
        // accidentally reshuffle another club's menus.
        var idList = orderedIds.ToList();
        for (int i = 0; i < idList.Count; i++)
        {
            await connection.ExecuteAsync(
                @"UPDATE club_website_menu SET sort_order = @Sort, modified_date = NOW()
                  WHERE pk_club_website_menu_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
                new { Sort = i + 1, Id = idList[i], ClubId = clubId });
        }
    }

    // ===== SubMenu =====
    // Inline SQL on every method below — needed so we can SELECT/SET is_system_managed.
    // The SPs cannot be updated (SYSTEM_USER privilege). System-managed rows are the 6
    // avenue sub-menus auto-seeded under "Projects" — update and delete reject them.

    // link_value: filename-only when link_type='document'; wrapped via CASE/CONCAT so callers
    // continue to receive the full /Documents/WebsiteData/Group{clubId}/MENU/<file> URL
    // transparently. Now uses the parent menu's fk_club_id (via JOIN m on each query)
    // since the path is club-scoped.
    private const string SubMenuSelectColumns = @"
        sm.pk_club_website_submenu_id AS Id,
        sm.fk_menu_id AS MenuId,
        sm.submenu_name AS SubMenuName,
        sm.link_type AS LinkType,
        CASE
            WHEN sm.link_value IS NULL OR sm.link_value = '' THEN sm.link_value
            WHEN sm.link_type = 'document'
                 AND sm.link_value NOT LIKE '/%'
                 AND sm.link_value NOT LIKE 'http%'
                 THEN CONCAT('/Documents/WebsiteData/Group', m.fk_club_id, '/MENU/', sm.link_value)
            ELSE sm.link_value
        END AS LinkValue,
        sm.sort_order AS SortOrder,
        sm.is_active AS IsActive,
        COALESCE(sm.is_system_managed, 0) AS IsSystemManaged";

    public async Task<List<ClubSubMenuDto>> GetSubMenusByMenuAsync(int menuId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubSubMenuDto>($@"
            SELECT {SubMenuSelectColumns}
            FROM club_website_submenu sm
            JOIN club_website_menu m ON m.pk_club_website_menu_id = sm.fk_menu_id
            WHERE sm.fk_menu_id = @MenuId AND sm.isdeleted = 0
            ORDER BY sm.sort_order, sm.pk_club_website_submenu_id",
            new { MenuId = menuId })).ToList();
    }

    public async Task<ClubSubMenuDto?> GetSubMenuByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubSubMenuDto>($@"
            SELECT {SubMenuSelectColumns}
            FROM club_website_submenu sm
            JOIN club_website_menu m ON m.pk_club_website_menu_id = sm.fk_menu_id
            WHERE sm.pk_club_website_submenu_id = @Id AND sm.isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateSubMenuAsync(int menuId, CreateClubSubMenuDto dto, int createdBy)
    {
        if (string.IsNullOrWhiteSpace(dto.SubMenuName))
            throw new InvalidOperationException("Sub-menu name is required.");
        if (string.IsNullOrWhiteSpace(dto.LinkValue))
            throw new InvalidOperationException("Sub-menu link value is required.");

        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_submenu
                (fk_menu_id, submenu_name, link_type, link_value, sort_order,
                 is_active, is_system_managed, created_by, created_date, isdeleted)
            VALUES (@MenuId, @SubMenuName, @LinkType, @LinkValue, @SortOrder,
                 @IsActive, 0, @CreatedBy, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new
            {
                MenuId      = menuId,
                SubMenuName = dto.SubMenuName,
                LinkType    = dto.LinkType,
                LinkValue   = dto.LinkValue,
                SortOrder   = dto.SortOrder,
                IsActive    = dto.IsActive ? 1 : 0,
                CreatedBy   = createdBy,
            });
    }

    public async Task UpdateSubMenuAsync(int id, UpdateClubSubMenuDto dto, int modifiedBy)
    {
        if (string.IsNullOrWhiteSpace(dto.SubMenuName))
            throw new InvalidOperationException("Sub-menu name is required.");
        if (string.IsNullOrWhiteSpace(dto.LinkValue))
            throw new InvalidOperationException("Sub-menu link value is required.");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // System-managed (auto-seeded avenue) sub-menus are editable — admins can rename them
        // or change their link. They stay identified by their stable link_value so the avenue
        // seeders (ClubWebsitesController / ClubWebsiteMenuSeeder / DatabaseInitializer backfill)
        // recognise the renamed row and never re-insert a duplicate.
        await connection.ExecuteAsync(@"
            UPDATE club_website_submenu
            SET submenu_name = @SubMenuName,
                link_type    = @LinkType,
                link_value   = @LinkValue,
                sort_order   = @SortOrder,
                is_active    = @IsActive,
                modified_by  = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_club_website_submenu_id = @Id AND isdeleted = 0",
            new
            {
                Id          = id,
                SubMenuName = dto.SubMenuName,
                LinkType    = dto.LinkType,
                LinkValue   = dto.LinkValue,
                SortOrder   = dto.SortOrder,
                IsActive    = dto.IsActive ? 1 : 0,
                ModifiedBy  = modifiedBy,
            });
    }

    public async Task DeleteSubMenuAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // System-managed avenue sub-menus can be deleted too. The avenue seeders key on
        // link_value and count rows regardless of isdeleted, so a deleted avenue is NOT
        // re-created on the next seed/backfill (the admin's removal is respected).
        await connection.ExecuteAsync(@"
            UPDATE club_website_submenu
            SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
            WHERE pk_club_website_submenu_id = @Id AND isdeleted = 0",
            new { Id = id, DeletedBy = deletedBy });
    }

    public async Task ReorderSubMenusAsync(int id1, int id2)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_submenu_reorder",
            new { p_Id1 = id1, p_Id2 = id2 },
            commandType: CommandType.StoredProcedure);
    }

    public async Task ReorderSubMenusBulkAsync(int menuId, IEnumerable<int> orderedIds)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var idList = orderedIds.ToList();
        for (int i = 0; i < idList.Count; i++)
        {
            await connection.ExecuteAsync(
                @"UPDATE club_website_submenu SET sort_order = @Sort, modified_date = NOW()
                  WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId AND isdeleted = 0",
                new { Sort = i + 1, Id = idList[i], MenuId = menuId });
        }
    }

    // ===== Document Upload =====

    public async Task<string> UploadDocumentAsync(int clubId, IFormFile file)
    {
        // Per user direction 2026-06-24: menu documents live alongside other
        // per-club website assets (banners, ads) under
        //   {Media:WebRoot}/Documents/WebsiteData/Group{clubId}/MENU/<filename>
        // _env.WebRootPath is already redirected to Media:WebRoot at startup
        // (Program.cs:18) — in prod that resolves to the example.org vhost
        // so the file physically lives on the legacy media host. In dev with
        // Media:WebRoot blank it falls back to local wwwroot.
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "WebsiteData", $"Group{clubId}", "MENU");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. SELECTs that read link_value with link_type='document'
        // reconstruct the full URL via SQL
        //   CONCAT('/Documents/WebsiteData/Group', fk_club_id, '/MENU/', link_value).
        return fileName;
    }
}
