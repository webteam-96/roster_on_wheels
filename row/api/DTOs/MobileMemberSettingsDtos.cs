namespace RotaryApi.DTOs;

// Mobile Settings screen — per-member privacy + notification flags.
// Stored as GLOBAL flags on member_master_profile (one set per member, not
// per-club). The MyClub vs AllClubs distinction is the AUDIENCE, not the
// scope of the setting: a viewer who shares any club with the member is
// treated as "in my club" for visibility purposes.

public class MobileMemberSettingsDto
{
    // Privacy — layered under the existing IsPersonalDetailsVisible master switch.
    public bool ShowPhoneInMyClub { get; set; } = true;
    public bool ShowPhoneInAllClubs { get; set; } = true;
    public bool ShowEmailInMyClub { get; set; } = true;
    public bool ShowEmailInAllClubs { get; set; } = true;

    // Notification preferences — one toggle per module. When OFF, the
    // dispatcher should skip this member for that module's pushes (Phase 2
    // wiring, not yet enforced in the push services).
    public bool NotifyUpcomingEvents { get; set; } = true;
    public bool NotifyAnnouncements { get; set; } = true;
    public bool NotifyNewsletters { get; set; } = true;
    public bool NotifyDocuments { get; set; } = true;
}

// 4 visibility flags — PUT body for /api/mobile/member-settings/privacy
public class UpdateMobileMemberPrivacyDto
{
    public bool ShowPhoneInMyClub { get; set; }
    public bool ShowPhoneInAllClubs { get; set; }
    public bool ShowEmailInMyClub { get; set; }
    public bool ShowEmailInAllClubs { get; set; }
}

// 4 notification flags — PUT body for /api/mobile/member-settings/notifications
public class UpdateMobileMemberNotificationsDto
{
    public bool NotifyUpcomingEvents { get; set; }
    public bool NotifyAnnouncements { get; set; }
    public bool NotifyNewsletters { get; set; }
    public bool NotifyDocuments { get; set; }
}
