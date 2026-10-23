using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IPotentialMemberService
{
    Task<PagedResult<PotentialMemberDto>> GetByClubAsync(int clubId, int page, int pageSize, string? search, string? stage = null);
    Task<PotentialMemberDto?> GetByIdAsync(int clubId, int id);
    Task<int> CreateAsync(int clubId, CreatePotentialMemberDto dto, int createdBy);
    Task<bool> UpdateAsync(int clubId, int id, UpdatePotentialMemberDto dto, int modifiedBy);
    Task<bool> DeleteAsync(int clubId, int id, int deletedBy);
    /// <summary>Creates the member through the normal member add path (duplicate checks included) and marks the
    /// prospect inducted. Returns the new member id; throws KeyNotFoundException / InvalidOperationException.</summary>
    Task<int> ConvertAsync(int clubId, int id, int convertedBy);
    /// <summary>A prospect from the public join form or an invite RSVP. Returns false when the club already has a
    /// prospect with this email (nothing is added).</summary>
    Task<bool> CreateFromPublicAsync(int clubId, string name, string? email, string? phone, string? notes, string source, string stage, int? referrerMemberId);
}
