using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ICategoryService
{
    Task<List<CategoryDto>> GetByAreaOfFocusAsync(int areaOfFocusId);
    Task<CategoryDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateCategoryDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateCategoryDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
