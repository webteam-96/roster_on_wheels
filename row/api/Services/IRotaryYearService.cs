using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IRotaryYearService
{
    Task<List<RotaryYearDto>> GetAllYearsAsync();
    Task<RotaryYearDto?> GetCurrentYearAsync();
}
