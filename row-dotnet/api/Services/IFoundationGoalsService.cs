using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IFoundationGoalsService
{
    // All methods accept an optional `requestedClubId` so multi-club admins can
    // scope the request to a specific club. When null, falls back to legacy
    // LIMIT 1 club resolution (Club Admin → Club Moderator) for backward compat.
    Task<FoundationGoalListResponse?> GetListAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<FoundationGoalDto?> SaveAsync(int memberId, FoundationGoalSaveRequest request, int? requestedClubId = null);
    Task<bool> DeleteAsync(int memberId, int yearId, int? requestedClubId = null);
}
