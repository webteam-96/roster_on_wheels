using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubRotaryOrgCredentialService
{
    Task<ClubRotaryOrgCredentialDto> GetAsync(int clubId, int memberId);
    Task UpsertAsync(int clubId, UpsertClubRotaryOrgCredentialDto dto, int memberId);
}
