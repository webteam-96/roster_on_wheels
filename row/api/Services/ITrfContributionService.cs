using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ITrfContributionService
{
    // Fund Master
    Task<IEnumerable<TrfFundDto>> GetFundsAsync();
    Task<TrfFundDto> CreateFundAsync(CreateTrfFundDto dto, int userId);
    Task UpdateFundAsync(int fundId, UpdateTrfFundDto dto, int userId);
    Task DeleteFundAsync(int fundId, int userId);

    // Contributions
    Task<IEnumerable<TrfContributionDto>> GetContributionsAsync(int clubId, int yearId);
    Task<TrfContributionDto> CreateContributionAsync(int clubId, CreateTrfContributionDto dto, int userId);
    Task<TrfContributionDto> UpdateContributionAsync(int clubId, int trfId, UpdateTrfContributionDto dto, int userId);
    Task DeleteContributionAsync(int trfId, int userId);

    // For CMR preview
    Task<decimal> GetYearTotalAsync(int clubId, int yearId);
    Task<decimal> GetMonthTotalAsync(int clubId, int yearId, int month);
    Task<List<TrfContributionDto>> GetContributionsForMonthAsync(int clubId, int yearId, int month);
}
