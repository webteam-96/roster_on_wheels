using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IDesignationService
{
    Task<List<DesignationDto>> GetAllAsync();
    Task<int> CreateAsync(CreateDesignationDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateDesignationDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task SwapOrderAsync(int id1, int id2);
    Task ReorderAllAsync(int[] orderedIds);
}
