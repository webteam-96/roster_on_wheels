using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IPastPresidentService
{
    Task<List<PastPresidentDto>> GetByClubAsync(int clubId);
    Task<PastPresidentDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreatePastPresidentDto dto, IFormFile? photo, int createdBy, IWebHostEnvironment env);
    Task UpdateAsync(int id, UpdatePastPresidentDto dto, IFormFile? photo, int modifiedBy, IWebHostEnvironment env);
    Task DeleteAsync(int id, int deletedBy);
    Task<List<ClubMemberSearchDto>> SearchClubMembersAsync(int clubId, string? search);
}
