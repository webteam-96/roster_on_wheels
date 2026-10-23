namespace RotaryApi.DTOs;

public class GreetingSettingsDto
{
    // Pause rule: custom message set but not saved for the current Rotary year → worker skips sends.
    public bool IsGreetingPaused { get; set; }
    public string? GreetingReviewedYearLabel { get; set; }
    public string? CurrentYearLabel { get; set; }
    public string? BirthdayGreeting { get; set; }
    public bool IsEnableBirthdayNotification { get; set; }
    public string? AnniversaryGreeting { get; set; }
    public bool IsEnableAnniversaryNotification { get; set; }
    public bool IsEnableBirthdayEmail { get; set; }
    public string? BirthdayEmailFrom { get; set; }
    public string? BirthdayEmailSubject { get; set; }
    public string? BirthdayEmailMessage { get; set; }
    public bool IsEnableAnniversaryEmail { get; set; }
    public string? AnniversaryEmailFrom { get; set; }
    public string? AnniversaryEmailSubject { get; set; }
    public string? AnniversaryEmailMessage { get; set; }
}

public class UpdateGreetingSettingsDto
{
    public string? BirthdayGreeting { get; set; }
    public bool IsEnableBirthdayNotification { get; set; }
    public string? AnniversaryGreeting { get; set; }
    public bool IsEnableAnniversaryNotification { get; set; }
    public bool IsEnableBirthdayEmail { get; set; }
    public string? BirthdayEmailFrom { get; set; }
    public string? BirthdayEmailSubject { get; set; }
    public string? BirthdayEmailMessage { get; set; }
    public bool IsEnableAnniversaryEmail { get; set; }
    public string? AnniversaryEmailFrom { get; set; }
    public string? AnniversaryEmailSubject { get; set; }
    public string? AnniversaryEmailMessage { get; set; }
}

public class DistrictGreetingSettingsDto
{
    public bool IsGreetingPaused { get; set; }
    public string? GreetingReviewedYearLabel { get; set; }
    public string? CurrentYearLabel { get; set; }
    public string? BirthdayGreeting { get; set; }
    public bool IsEnableBirthdayNotification { get; set; }
    public string? AnniversaryGreeting { get; set; }
    public bool IsEnableAnniversaryNotification { get; set; }
    public bool IsGreetingSendEmail { get; set; }
    public bool IsGreetingSendPush { get; set; }
    public bool IsEnableBirthdayEmail { get; set; }
    public string? BirthdayEmailFrom { get; set; }
    public string? BirthdayEmailSubject { get; set; }
    public string? BirthdayEmailMessage { get; set; }
    public bool IsEnableAnniversaryEmail { get; set; }
    public string? AnniversaryEmailFrom { get; set; }
    public string? AnniversaryEmailSubject { get; set; }
    public string? AnniversaryEmailMessage { get; set; }
}

public class UpdateDistrictGreetingSettingsDto
{
    public string? BirthdayGreeting { get; set; }
    public bool IsEnableBirthdayNotification { get; set; }
    public string? AnniversaryGreeting { get; set; }
    public bool IsEnableAnniversaryNotification { get; set; }
    public bool IsGreetingSendEmail { get; set; }
    public bool IsGreetingSendPush { get; set; }
    public bool IsEnableBirthdayEmail { get; set; }
    public string? BirthdayEmailFrom { get; set; }
    public string? BirthdayEmailSubject { get; set; }
    public string? BirthdayEmailMessage { get; set; }
    public bool IsEnableAnniversaryEmail { get; set; }
    public string? AnniversaryEmailFrom { get; set; }
    public string? AnniversaryEmailSubject { get; set; }
    public string? AnniversaryEmailMessage { get; set; }
}
