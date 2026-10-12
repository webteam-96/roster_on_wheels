namespace RotaryApi.DTOs;

// Website training appointments (Calendly-style booking + Zoom).

// One 30-minute slot as the booking screen sees it. A slot that cannot be taken is still
// RETURNED (user 2026-09-29) so the club admin sees it greyed out with the reason, instead of
// wondering where the time went.
public class AvailabilitySlotDto
{
    public string Time { get; set; } = "";            // "HH:mm" (IST)
    public bool IsOpen { get; set; }
    public string Status { get; set; } = "open";      // "open" | "booked" | "blocked" | "dayFull"
    public string? Reason { get; set; }               // shown on the disabled slot
}

public class AvailabilityDayDto
{
    public string Date { get; set; } = "";           // yyyy-MM-dd
    public string DayLabel { get; set; } = "";        // e.g. "Wed, 02 Jul"
    // OPEN start times only - kept exactly as it was so the mobile app and anything else reading
    // this response keeps working unchanged.
    public List<string> Slots { get; set; } = new();
    // Every slot of the day, open or not, in time order. New surfaces read this one.
    public List<AvailabilitySlotDto> AllSlots { get; set; } = new();
    public bool IsClosed { get; set; }                // nothing bookable at all that day
    public string? ClosedReason { get; set; }         // "Not available" / "Fully booked"
}

public class AvailabilityResponseDto
{
    public int SlotMinutes { get; set; } = 30;
    public List<AvailabilityDayDto> Days { get; set; } = new();
}

// ── Super Admin: the training team's availability ────────────────────────────────────────────
public class TrainingHourRangeDto
{
    public int Id { get; set; }
    public string Start { get; set; } = "";           // "HH:mm"
    public string End { get; set; } = "";             // "HH:mm"
}

public class TrainingWeekdayDto
{
    public int DayOfWeek { get; set; }                // 0=Sunday .. 6=Saturday
    public string DayName { get; set; } = "";
    public bool IsAvailable { get; set; }             // false = closed all day
    public List<TrainingHourRangeDto> Ranges { get; set; } = new();
}

public class TrainingDateOverrideDto
{
    public int Id { get; set; }
    public string Date { get; set; } = "";            // yyyy-MM-dd
    public string DateLabel { get; set; } = "";
    public bool IsUnavailableAllDay { get; set; }
    public List<TrainingHourRangeDto> Ranges { get; set; } = new();   // the hours they ARE free
    public string? Reason { get; set; }
    public int BookedCount { get; set; }              // appointments already sitting on that date
}

public class TrainingAvailabilityDto
{
    public int SlotMinutes { get; set; } = 30;
    public int MaxPerDay { get; set; } = 3;
    public List<TrainingWeekdayDto> Week { get; set; } = new();
    public List<TrainingDateOverrideDto> Overrides { get; set; } = new();
}

public class SaveTrainingWeekRequest
{
    public List<TrainingWeekdayDto> Week { get; set; } = new();
}

public class SaveTrainingOverrideRequest
{
    public string Date { get; set; } = "";            // yyyy-MM-dd (one date; kept for older callers)
    // Several dates blocked in one go - the screen lets the team pick a whole run of days off the
    // calendar and save them together (user 2026-09-29). Date and Dates are merged, duplicates dropped.
    public List<string> Dates { get; set; } = new();
    public bool IsUnavailableAllDay { get; set; }
    public List<TrainingHourRangeDto> Ranges { get; set; } = new();
    public string? Reason { get; set; }
}

public class BookAppointmentDto
{
    public int ClubId { get; set; }
    public string SlotStart { get; set; } = "";       // "yyyy-MM-ddTHH:mm" (IST wall-clock)
    public string? Notes { get; set; }
}

public class RescheduleAppointmentDto
{
    public long AppointmentId { get; set; }
    public string SlotStart { get; set; } = "";       // "yyyy-MM-ddTHH:mm"
}

public class TrainingAppointmentDto
{
    public long Id { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string SlotStart { get; set; } = "";       // ISO "yyyy-MM-ddTHH:mm:ss"
    public int DurationMinutes { get; set; }
    public string Status { get; set; } = "";
    public string? ZoomJoinUrl { get; set; }
    public string? ZoomStartUrl { get; set; }
    public string? BookedByName { get; set; }
    public string? Notes { get; set; }
    public DateTime? BookedDate { get; set; }
}

public class BookAppointmentResponseDto
{
    public bool IsSuccess { get; set; }
    public string? Message { get; set; }
    public TrainingAppointmentDto? Appointment { get; set; }
}
