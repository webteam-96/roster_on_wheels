using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IFundingService
{
    Task<List<FundingDto>> GetAllAsync();
    Task<FundingDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateFundingDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateFundingDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
