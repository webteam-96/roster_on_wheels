namespace RotaryApi.Services;
using RotaryApi.DTOs;

public interface INewsletterService
{
    Task<(List<NewsletterListDto> Items, int TotalCount)> GetAllAsync(int clubId, int yearId, string status, string search, int page, int pageSize, int? districtId = null);
    Task<NewsletterDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateNewsletterDto dto, int createdBy, int? districtId = null);
    Task UpdateAsync(int id, UpdateNewsletterDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<string> UploadFileAsync(int clubId, IFormFile file);
    Task<List<object>> GetYearsAsync(int clubId, int? districtId = null);
}
