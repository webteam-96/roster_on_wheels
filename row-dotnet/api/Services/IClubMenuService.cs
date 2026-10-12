using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubMenuService
{
    // Menu
    Task<List<ClubMenuDto>> GetMenusByClubAsync(int clubId);
    Task<ClubMenuDto?> GetMenuByIdAsync(int id);
    Task<int> CreateMenuAsync(int clubId, CreateClubMenuDto dto, int createdBy);
    Task UpdateMenuAsync(int id, UpdateClubMenuDto dto, int modifiedBy);
    Task DeleteMenuAsync(int id, int deletedBy);
    Task ReorderMenusAsync(int id1, int id2);
    /// <summary>Drag-and-drop full-list reorder. orderedIds[i] gets sort_order = i+1.</summary>
    Task ReorderMenusBulkAsync(int clubId, IEnumerable<int> orderedIds);

    // SubMenu
    Task<List<ClubSubMenuDto>> GetSubMenusByMenuAsync(int menuId);
    Task<ClubSubMenuDto?> GetSubMenuByIdAsync(int id);
    Task<int> CreateSubMenuAsync(int menuId, CreateClubSubMenuDto dto, int createdBy);
    Task UpdateSubMenuAsync(int id, UpdateClubSubMenuDto dto, int modifiedBy);
    Task DeleteSubMenuAsync(int id, int deletedBy);
    Task ReorderSubMenusAsync(int id1, int id2);
    /// <summary>Drag-and-drop full-list reorder of submenus inside a menu.</summary>
    Task ReorderSubMenusBulkAsync(int menuId, IEnumerable<int> orderedIds);

    // Document upload
    Task<string> UploadDocumentAsync(int clubId, IFormFile file);
}
