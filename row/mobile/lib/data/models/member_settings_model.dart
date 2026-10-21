/// Member self-service privacy + notification settings.
///
/// Mirrors the backend `MobileMemberSettingsDto` (GET `/api/mobile/member-settings`).
/// All 8 flags are GLOBAL per member (not per-club): the "My Club" vs "All Clubs"
/// distinction is the AUDIENCE, not the storage scope. Privacy flags layer UNDER
/// the existing `isPersonalDetailsVisible` master switch.
///
/// NOTE: as of the 2026-06-26 backend, these endpoints only PERSIST the toggles —
/// read-side gating (directory visibility, push suppression) is a later "Phase 2"
/// backend change, so flipping these doesn't yet change what other members see.
class MemberSettings {
  // Privacy — who can see my phone / email.
  final bool showPhoneInMyClub;
  final bool showPhoneInAllClubs;
  final bool showEmailInMyClub;
  final bool showEmailInAllClubs;

  // Notifications — per-module push preferences.
  final bool notifyUpcomingEvents;
  final bool notifyAnnouncements;
  final bool notifyNewsletters;
  final bool notifyDocuments;

  const MemberSettings({
    this.showPhoneInMyClub = true,
    this.showPhoneInAllClubs = true,
    this.showEmailInMyClub = true,
    this.showEmailInAllClubs = true,
    this.notifyUpcomingEvents = true,
    this.notifyAnnouncements = true,
    this.notifyNewsletters = true,
    this.notifyDocuments = true,
  });

  // Tolerant bool parse — backend serializes bool props, but the SQL casts to
  // UNSIGNED so accept 0/1 and "true"/"1" too. Missing → default true.
  static bool _b(dynamic v) {
    if (v == null) return true;
    if (v is bool) return v;
    if (v is num) return v != 0;
    final s = v.toString().trim().toLowerCase();
    return s == 'true' || s == '1' || s == 'yes';
  }

  factory MemberSettings.fromJson(Map<String, dynamic> j) {
    return MemberSettings(
      showPhoneInMyClub: _b(j['showPhoneInMyClub']),
      showPhoneInAllClubs: _b(j['showPhoneInAllClubs']),
      showEmailInMyClub: _b(j['showEmailInMyClub']),
      showEmailInAllClubs: _b(j['showEmailInAllClubs']),
      notifyUpcomingEvents: _b(j['notifyUpcomingEvents']),
      notifyAnnouncements: _b(j['notifyAnnouncements']),
      notifyNewsletters: _b(j['notifyNewsletters']),
      notifyDocuments: _b(j['notifyDocuments']),
    );
  }

  MemberSettings copyWith({
    bool? showPhoneInMyClub,
    bool? showPhoneInAllClubs,
    bool? showEmailInMyClub,
    bool? showEmailInAllClubs,
    bool? notifyUpcomingEvents,
    bool? notifyAnnouncements,
    bool? notifyNewsletters,
    bool? notifyDocuments,
  }) {
    return MemberSettings(
      showPhoneInMyClub: showPhoneInMyClub ?? this.showPhoneInMyClub,
      showPhoneInAllClubs: showPhoneInAllClubs ?? this.showPhoneInAllClubs,
      showEmailInMyClub: showEmailInMyClub ?? this.showEmailInMyClub,
      showEmailInAllClubs: showEmailInAllClubs ?? this.showEmailInAllClubs,
      notifyUpcomingEvents: notifyUpcomingEvents ?? this.notifyUpcomingEvents,
      notifyAnnouncements: notifyAnnouncements ?? this.notifyAnnouncements,
      notifyNewsletters: notifyNewsletters ?? this.notifyNewsletters,
      notifyDocuments: notifyDocuments ?? this.notifyDocuments,
    );
  }

  /// Body for PUT `/api/mobile/member-settings/privacy`.
  Map<String, dynamic> toPrivacyJson() => {
        'showPhoneInMyClub': showPhoneInMyClub,
        'showPhoneInAllClubs': showPhoneInAllClubs,
        'showEmailInMyClub': showEmailInMyClub,
        'showEmailInAllClubs': showEmailInAllClubs,
      };

  /// Body for PUT `/api/mobile/member-settings/notifications`.
  Map<String, dynamic> toNotificationsJson() => {
        'notifyUpcomingEvents': notifyUpcomingEvents,
        'notifyAnnouncements': notifyAnnouncements,
        'notifyNewsletters': notifyNewsletters,
        'notifyDocuments': notifyDocuments,
      };
}
