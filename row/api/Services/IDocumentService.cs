namespace RotaryApi.Services;
using RotaryApi.DTOs;

public interface IDocumentService
{
    Task<(List<DocumentListDto> Items, int TotalCount)> GetAllAsync(int clubId, string status, string search, int page, int pageSize, int? districtId = null);
    Task<DocumentDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateDocumentDto dto, int createdBy, int? districtId = null);
    Task UpdateAsync(int id, UpdateDocumentDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<(string path, string originalName)> UploadFileAsync(int clubId, IFormFile file);
}
