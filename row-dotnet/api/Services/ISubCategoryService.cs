using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ISubCategoryService
{
    Task<List<SubCategoryDto>> GetByCategoryAsync(int categoryId);
    Task<SubCategoryDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateSubCategoryDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateSubCategoryDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
