using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Website training appointment booking (Calendly-style, Zoom-backed). 30-min slots, weekday-only,
// max 3/day globally, unique meeting per booking; reschedule keeps the same Zoom meeting.
public interface ITrainingAppointmentService
{
    Task<bool> HasActiveWebsiteAsync(int clubId);
    Task<AvailabilityResponseDto> GetAvailabilityAsync();
    Task<BookAppointmentResponseDto> BookAsync(BookAppointmentDto dto, int userId);
    Task<BookAppointmentResponseDto> RescheduleAsync(RescheduleAppointmentDto dto, int userId);
    Task<List<TrainingAppointmentDto>> GetForClubAsync(int clubId);
    Task<List<TrainingAppointmentDto>> GetAllAsync();
    Task<int?> GetAppointmentClubIdAsync(long appointmentId);

    // ── Super Admin: the training team's availability (user 2026-09-29) ──
    Task<TrainingAvailabilityDto> GetAvailabilitySettingsAsync();
    Task SaveWeeklyHoursAsync(SaveTrainingWeekRequest request, int userId);
    Task<int> SaveDateOverrideAsync(SaveTrainingOverrideRequest request, int userId);
    Task DeleteDateOverrideAsync(int id, int userId);
}
