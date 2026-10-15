using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IProjectService
{
    Task<PagedResult<ProjectListDto>> GetByClubAsync(int clubId, int moduleId, int yearId, int page, int pageSize, string? search, string? projectType = null);
    // Year-wise: an id alone is ambiguous across year tables — caller supplies yearId, but if
    // that year's table doesn't hold the project (stale/missing year param from a cross-flow
    // link), we fall back to locating it by (id + clubId), which IS unique.
    Task<ProjectDetailDto?> GetByIdAsync(int id, int yearId, int clubId);
    Task<int> CreateAsync(int clubId, CreateProjectDto dto, int createdBy);
    Task UpdateAsync(int id, int yearId, UpdateProjectDto dto, int modifiedBy);
    // Cross-year move: relocates project + photos from fromYearId's tables to the year
    // implied by dto.ProjectDate. Verifies the copy before deleting the source. Returns
    // (newYearId, newProjectId) so the caller can redirect to the project's new location.
    Task<(int NewYearId, int NewProjectId, string NewYearLabel)> MoveProjectAsync(int id, int fromYearId, UpdateProjectDto dto, int modifiedBy);
    Task DeleteAsync(int id, int yearId, int deletedBy);
    Task<List<OngoingProjectDto>> GetOngoingAsync(int clubId, int moduleId, string? search, int? yearId = null);
    Task<int> AddPhotoAsync(int projectId, int yearId, string imagePath, string? description, bool isPrimary, int sortOrder);
    Task DeletePhotoAsync(int photoId, int yearId);
    Task SetPrimaryPhotoAsync(int projectId, int photoId, int yearId);
    Task<string> UploadImageAsync(IFormFile file, int clubId, int? projectId = null, int? yearId = null);
    Task<string> UploadDocumentAsync(IFormFile file, int clubId);
    Task<PagedResult<ProjectPublicDto>> GetPublicAsync(int clubId, int moduleId, int yearId, int page, int pageSize);
    Task<List<ProjectYearDto>> GetYearsAsync(int clubId, int moduleId);
}
