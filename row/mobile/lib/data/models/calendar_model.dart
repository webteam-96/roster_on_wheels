class CalendarClub {
  final int clubId;
  final String clubName;
  final String? clubLogo;
  final String districtNumber;

  const CalendarClub({
    required this.clubId,
    required this.clubName,
    this.clubLogo,
    required this.districtNumber,
  });

  factory CalendarClub.fromJson(Map<String, dynamic> j) => CalendarClub(
        clubId: _toInt(j['clubId']),
        clubName: j['clubName']?.toString() ?? '',
        clubLogo: j['clubLogo']?.toString(),
        districtNumber: j['districtNumber']?.toString() ?? '',
      );
}

class CalendarDistrict {
  final int districtId;
  final String districtNumber;
  final String? zoneName;

  const CalendarDistrict({
    required this.districtId,
    required this.districtNumber,
    this.zoneName,
  });

  factory CalendarDistrict.fromJson(Map<String, dynamic> j) => CalendarDistrict(
        districtId: _toInt(j['districtId']),
        districtNumber: j['districtNumber']?.toString() ?? '',
        zoneName: j['zoneName']?.toString(),
      );
}

class ClubCalendarData {
  final int month;
  final int year;
  final String monthLabel;
  final List<CalendarPerson> birthdays;
  final List<CalendarPerson> anniversaries;
  // Spouse/child birthdays & anniversaries (family members of the club's
  // Rotarians). Merged into the Birthdays / Anniversaries day-view tabs.
  final List<CalendarFamilyEvent> familyBirthdays;
  final List<CalendarFamilyEvent> familyAnniversaries;
  final List<CalendarEvent> upcomingEvents;

  const ClubCalendarData({
    required this.month,
    required this.year,
    required this.monthLabel,
    required this.birthdays,
    required this.anniversaries,
    required this.familyBirthdays,
    required this.familyAnniversaries,
    required this.upcomingEvents,
  });

  factory ClubCalendarData.fromJson(Map<String, dynamic> j) => ClubCalendarData(
        month: _toInt(j['month']),
        year: _toInt(j['year']),
        monthLabel: j['monthLabel']?.toString() ?? '',
        birthdays: ((j['birthdays'] as List?) ?? const [])
            .map((e) => CalendarPerson.fromJson(
                  e as Map<String, dynamic>,
                  dateKey: 'birthDate',
                ))
            .toList(),
        anniversaries: ((j['anniversaries'] as List?) ?? const [])
            .map((e) => CalendarPerson.fromJson(
                  e as Map<String, dynamic>,
                  dateKey: 'anniversaryDate',
                ))
            .toList(),
        familyBirthdays: ((j['familyBirthdays'] as List?) ?? const [])
            .map((e) => CalendarFamilyEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
        familyAnniversaries: ((j['familyAnniversaries'] as List?) ?? const [])
            .map((e) => CalendarFamilyEvent.fromJson(
                  e as Map<String, dynamic>,
                  dateKey: 'anniversaryDate',
                ))
            .toList(),
        upcomingEvents: ((j['upcomingEvents'] as List?) ?? const [])
            .map((e) => CalendarEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class DistrictCalendarData {
  final int month;
  final int year;
  final String monthLabel;
  // Birthdays / anniversaries are district-wide (all members across the
  // district's clubs). Populated once the `district-calendar/{id}` endpoint
  // returns them; until then these stay empty and the tabs render gracefully.
  final List<CalendarPerson> birthdays;
  final List<CalendarPerson> anniversaries;
  // Spouse/child birthdays & anniversaries across the district. Merged into the
  // Birthdays / Anniversaries day-view tabs.
  final List<CalendarFamilyEvent> familyBirthdays;
  final List<CalendarFamilyEvent> familyAnniversaries;
  final List<CalendarEvent> upcomingEvents;
  final List<CalendarAnnouncement> announcements;

  const DistrictCalendarData({
    required this.month,
    required this.year,
    required this.monthLabel,
    required this.birthdays,
    required this.anniversaries,
    required this.familyBirthdays,
    required this.familyAnniversaries,
    required this.upcomingEvents,
    required this.announcements,
  });

  factory DistrictCalendarData.fromJson(Map<String, dynamic> j) => DistrictCalendarData(
        month: _toInt(j['month']),
        year: _toInt(j['year']),
        monthLabel: j['monthLabel']?.toString() ?? '',
        birthdays: ((j['birthdays'] as List?) ?? const [])
            .map((e) => CalendarPerson.fromJson(
                  e as Map<String, dynamic>,
                  dateKey: 'birthDate',
                ))
            .toList(),
        anniversaries: ((j['anniversaries'] as List?) ?? const [])
            .map((e) => CalendarPerson.fromJson(
                  e as Map<String, dynamic>,
                  dateKey: 'anniversaryDate',
                ))
            .toList(),
        familyBirthdays: ((j['familyBirthdays'] as List?) ?? const [])
            .map((e) => CalendarFamilyEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
        familyAnniversaries: ((j['familyAnniversaries'] as List?) ?? const [])
            .map((e) => CalendarFamilyEvent.fromJson(
                  e as Map<String, dynamic>,
                  dateKey: 'anniversaryDate',
                ))
            .toList(),
        upcomingEvents: ((j['upcomingEvents'] as List?) ?? const [])
            .map((e) => CalendarEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
        announcements: ((j['announcements'] as List?) ?? const [])
            .map((e) => CalendarAnnouncement.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class CalendarPerson {
  final int memberId;
  final String memberName;
  final String? profilePhoto;
  final DateTime? date;
  final int day;
  // Club the member belongs to — only present on the district calendar (which
  // spans many clubs). Null on the club calendar. A member active in multiple
  // clubs of a district appears once per club, each with its own clubName.
  final String? clubName;
  // Contact + context fields added to the calendar payload (2026-06-11 backend).
  // NOTE: contact actions still come from the privacy-gated find-rotarian fetch
  // (CalendarContactDetails) — the calendar payload carries no visibility flag —
  // so email/primaryMobile/secondaryMobile here are parsed for completeness but
  // are not used to render the call/email buttons. classificationProfession and
  // spouseName (anniversaries only) are safe display-only context.
  final String? email;
  final String? primaryMobile;
  final String? secondaryMobile;
  // Per-club role (Rotarian / President / DG…) — added to the calendar payload
  // 2026-06-26 backend. Display-only context for the birthday/anniversary tile;
  // preferred over classificationProfession when both are present.
  final String? designation;
  final String? classificationProfession;
  final String? spouseName;
  // Spouse's own contact (anniversaries). Lets a member's wedding-anniversary
  // tile offer a "call the spouse" card alongside the member. Currently absent
  // from the payload — parsed-if-present so the spouse card lights up the moment
  // the backend adds it (until then the card shows disabled). Key names are a
  // best guess to confirm with backend.
  final String? spouseMobile;
  final String? spouseEmail;
  final String? spousePhoneCode;

  const CalendarPerson({
    required this.memberId,
    required this.memberName,
    this.profilePhoto,
    this.date,
    required this.day,
    this.clubName,
    this.email,
    this.primaryMobile,
    this.secondaryMobile,
    this.designation,
    this.classificationProfession,
    this.spouseName,
    this.spouseMobile,
    this.spouseEmail,
    this.spousePhoneCode,
  });

  factory CalendarPerson.fromJson(Map<String, dynamic> j, {required String dateKey}) {
    return CalendarPerson(
      memberId: _toInt(j['memberId']),
      memberName: j['memberName']?.toString() ?? '',
      profilePhoto: j['profilePhoto']?.toString(),
      date: _parseDayMonth(j[dateKey]),
      day: _toInt(j['day']),
      clubName: j['clubName']?.toString(),
      email: j['email']?.toString(),
      primaryMobile: j['primaryMobile']?.toString(),
      secondaryMobile: j['secondaryMobile']?.toString(),
      designation: j['designation']?.toString(),
      classificationProfession: j['classificationProfession']?.toString(),
      spouseName: j['spouseName']?.toString(),
      spouseMobile: j['spouseMobile']?.toString() ??
          j['spousePhoneNumber']?.toString() ??
          j['spouseContact']?.toString(),
      spouseEmail:
          j['spouseEmail']?.toString() ?? j['spouseEmailId']?.toString(),
      spousePhoneCode: j['spousePhoneCode']?.toString() ??
          j['spouseCountryPhoneCode']?.toString(),
    );
  }
}

/// A spouse/child birthday or anniversary in the calendar (`familyBirthdays[]`
/// / `familyAnniversaries[]`). One entry per family member; `memberName` is the
/// Rotarian the family member belongs to, `clubName` that Rotarian's club.
///
/// The family member's own contact (`email`/`mobile`/`phoneCode`) may be sent
/// by the backend so the family contact card can dial THEM directly; when the
/// payload omits them (currently the case), the family card falls back to being
/// shown without a dialable action and only the Rotarian's number is reachable.
class CalendarFamilyEvent {
  final int familyId;
  final int memberId;
  final String memberName;
  // The Rotarian's per-club designation (e.g. "PDG 2017 - 18"). Added to the
  // family calendar payload 2026-06-26; shown on the COG calendar as
  // "Spouse of Siva(PDG 2017 - 18)". Null/empty when not set.
  final String? designation;
  final String familyMemberName;
  final String relation;
  final DateTime? date;
  final int day;
  final String? profilePhoto;
  final int clubId;
  final String? clubName;
  // Family member's own contact (may be null until the backend populates it).
  final String? email;
  final String? mobile;
  final String? countryCode;
  final String? phoneCode;

  const CalendarFamilyEvent({
    required this.familyId,
    required this.memberId,
    required this.memberName,
    this.designation,
    required this.familyMemberName,
    required this.relation,
    this.date,
    required this.day,
    this.profilePhoto,
    required this.clubId,
    this.clubName,
    this.email,
    this.mobile,
    this.countryCode,
    this.phoneCode,
  });

  factory CalendarFamilyEvent.fromJson(Map<String, dynamic> j,
      {String dateKey = 'birthDate'}) {
    return CalendarFamilyEvent(
      familyId: _toInt(j['familyId']),
      memberId: _toInt(j['memberId']),
      memberName: j['memberName']?.toString() ?? '',
      designation: j['designation']?.toString(),
      familyMemberName: j['familyMemberName']?.toString() ?? '',
      relation: j['relation']?.toString() ?? '',
      date: _parseDayMonth(j[dateKey]),
      day: _toInt(j['day']),
      profilePhoto: j['profilePhoto']?.toString(),
      clubId: _toInt(j['clubId']),
      clubName: j['clubName']?.toString(),
      email: j['email']?.toString(),
      mobile: j['mobile']?.toString(),
      countryCode: j['countryCode']?.toString(),
      phoneCode: j['phoneCode']?.toString(),
    );
  }
}

class CalendarEvent {
  final int id;
  final String title;
  final String? description;
  final String? imagePath;
  final DateTime? eventDate;
  final String? eventVenue;
  final String? registrationLink;
  final DateTime? publishDate;
  final DateTime? expiryDate;

  const CalendarEvent({
    required this.id,
    required this.title,
    this.description,
    this.imagePath,
    this.eventDate,
    this.eventVenue,
    this.registrationLink,
    this.publishDate,
    this.expiryDate,
  });

  factory CalendarEvent.fromJson(Map<String, dynamic> j) => CalendarEvent(
        id: _toInt(j['id']),
        title: j['title']?.toString() ?? '',
        description: j['description']?.toString(),
        imagePath: j['imagePath']?.toString(),
        eventDate: _parseDate(j['eventDate']),
        eventVenue: j['eventVenue']?.toString(),
        registrationLink: j['registrationLink']?.toString(),
        publishDate: _parseDate(j['publishDate']),
        expiryDate: _parseDate(j['expiryDate']),
      );
}

class CalendarAnnouncement {
  final int id;
  final String title;
  final String? description;
  final String? imagePath;
  final DateTime? publishDate;
  final DateTime? expiryDate;

  const CalendarAnnouncement({
    required this.id,
    required this.title,
    this.description,
    this.imagePath,
    this.publishDate,
    this.expiryDate,
  });

  factory CalendarAnnouncement.fromJson(Map<String, dynamic> j) => CalendarAnnouncement(
        id: _toInt(j['id']),
        title: j['title']?.toString() ?? '',
        description: j['description']?.toString(),
        imagePath: j['imagePath']?.toString(),
        publishDate: _parseDate(j['publishDate']),
        expiryDate: _parseDate(j['expiryDate']),
      );
}

int _toInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

DateTime? _parseDate(dynamic v) {
  if (v == null) return null;
  // Backend zero dates (`0001-01-01`, from ConvertZeroDateTime) mean "no value".
  if (v is DateTime) return v.year <= 1 ? null : v;
  final s = v.toString();
  if (s.isEmpty) return null;
  final d = DateTime.tryParse(s);
  return (d == null || d.year <= 1) ? null : d;
}

/// Parses the calendar's birthday/anniversary field. The mobile-calendar API
/// sends these as a bare `"dd-mm"` string (day + month only — the birth year is
/// a privacy-stripped 1900 placeholder system-wide), which is NOT ISO-8601, so
/// it falls back to a fixed placeholder year. Older builds may still send a full
/// ISO date, so we defer to [_parseDate] for anything that isn't `dd-mm`.
DateTime? _parseDayMonth(dynamic v) {
  if (v == null) return null;
  final s = v.toString().trim();
  if (s.isEmpty) return null;
  final m = RegExp(r'^(\d{1,2})-(\d{1,2})$').firstMatch(s);
  if (m != null) {
    final day = int.parse(m.group(1)!);
    final month = int.parse(m.group(2)!);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return DateTime(1900, month, day);
  }
  return _parseDate(v);
}
