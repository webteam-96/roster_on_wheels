namespace RotaryApi.Services;

public interface IOcvGovService
{
    // Categories
    Task<IEnumerable<DTOs.OcvCategoryDto>> GetCategoriesAsync();

    // Document Types (Settings - SuperAdmin)
    Task<IEnumerable<DTOs.OcvDocumentTypeDto>> GetDocumentTypesAsync(int categoryId);
    Task<DTOs.OcvDocumentTypeDto> CreateDocumentTypeAsync(DTOs.CreateOcvDocumentTypeDto dto);
    Task UpdateDocumentTypeAsync(int typeId, DTOs.UpdateOcvDocumentTypeDto dto);
    Task DeleteDocumentTypeAsync(int typeId);

    // Documents (Club Admin)
    Task<IEnumerable<DTOs.OcvDocumentListItemDto>> GetDocumentsAsync(int clubId, int yearId, int categoryId);
    Task<DTOs.OcvDocumentListItemDto> UploadDocumentAsync(int clubId, DTOs.UploadOcvDocumentDto dto, IFormFile file, int uploadedBy, IWebHostEnvironment env);
    Task<DTOs.OcvDocumentListItemDto> UpdateDocumentAsync(int clubId, int documentId, DTOs.UpdateOcvDocumentDto dto, IFormFile? file, int modifiedBy, IWebHostEnvironment env);
    Task DeleteDocumentAsync(int documentId, int deletedBy);
    /// <summary>Returns (FilePath, OriginalFileName) for a document, or null if not found / wrong club / soft-deleted.</summary>
    Task<(string FilePath, string OriginalFileName)?> GetDocumentFileAsync(int clubId, int documentId);

    // OCV Report
    Task<IEnumerable<DTOs.OcvReportItemDto>> GetOcvReportAsync(int clubId, int yearId, string? status);

    /// <summary>Everything the Word report needs: uploaded documents, live-module snapshots and newsletters.</summary>
    Task<OcvWordReportData> GetOcvWordReportDataAsync(int clubId, int yearId);
}
