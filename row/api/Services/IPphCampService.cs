namespace RotaryApi.Services;

using RotaryApi.DTOs;

public interface IPphCampService
{
    // Camps
    Task<IEnumerable<PphCampListDto>> GetCampsAsync(int clubId);
    Task<PphCampListDto> CreateCampAsync(int clubId, CreatePphCampDto dto, IFormFile? logo, int userId, IWebHostEnvironment env);
    Task<PphCampListDto> UpdateCampAsync(int clubId, int campId, UpdatePphCampDto dto, IFormFile? logo, int userId, IWebHostEnvironment env);
    Task DeleteCampAsync(int campId, int userId);
    Task ToggleCampActiveAsync(int campId, int userId);

    // 3-level: Attendee (person) + medical readings
    Task<IEnumerable<PphAttendeeDto>> GetAttendeesAsync(int campId);
    Task<PphAttendeeDetailDto?> GetAttendeeDetailAsync(int campId, int attendeeId);
    // Add a reading: reuse attendee by (camp, mobile) or create one; always inserts a NEW reading.
    Task<PphAttendeeDetailDto> AddReadingAsync(int campId, CreatePphReadingDto dto, int userId);
    Task<PphAttendeeDto> UpdateAttendeeAsync(int campId, int attendeeId, UpdatePphAttendeeDto dto, int userId);
    Task<PphMedicalReadingDto> UpdateReadingAsync(int campId, int readingId, UpdatePphReadingDto dto, int userId);
    Task DeleteReadingAsync(int campId, int readingId, int userId);
    Task DeleteAttendeeAsync(int campId, int attendeeId, int userId);

    // History by mobile: every attendee entry for a mobile across ALL clubs/camps/years,
    // grouped club-wise (never deduped). Read-only.
    Task<PphMobileHistoryDto> GetAttendeeHistoryByMobileAsync(string mobile);

    // Scoped attendee report rows (never deduped), ordered club-wise. scope = "club"
    // (scopeId = clubId), "district" (scopeId = districtId), or "all" (scopeId ignored).
    Task<IEnumerable<PphAttendeeReportRowDto>> GetAttendeeReportAsync(string scope, int? scopeId);
}
