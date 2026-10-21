class ClubFinderItem {
  final int clubId;
  final String clubName;
  final String clubRotaryId;
  final String? clubLogo;
  final String? city;
  final String? state;
  final String? country;
  final String? meetingDay;
  final String? meetingAddress;
  final double? latitude;
  final double? longitude;
  final String districtNumber;
  final String? zoneName;
  final double? distanceKm;

  /// Whether this club is auto-synced from Rotary.org (the nightly
  /// RotaryOrgSyncWorker manages it) vs. manually managed here. NULLABLE on
  /// purpose: the club-finder list endpoint does not yet SELECT
  /// `IsSyncedFromRotaryOrg`, so the key is absent → null. The UI stars only
  /// clubs reported as NON-synced (explicit `false`); a null keeps the card
  /// unstarred so we don't mark every club until the backend returns the flag.
  final bool? isSyncedFromRotaryOrg;

  const ClubFinderItem({
    required this.clubId,
    required this.clubName,
    required this.clubRotaryId,
    this.clubLogo,
    this.city,
    this.state,
    this.country,
    this.meetingDay,
    this.meetingAddress,
    this.latitude,
    this.longitude,
    required this.districtNumber,
    this.zoneName,
    this.distanceKm,
    this.isSyncedFromRotaryOrg,
  });

  /// True only when the club is explicitly reported as NOT synced from
  /// Rotary.org. Null (field absent) → false, so the star stays hidden.
  bool get isNonSync => isSyncedFromRotaryOrg == false;

  factory ClubFinderItem.fromJson(Map<String, dynamic> json) {
    return ClubFinderItem(
      clubId: _toInt(json['clubId']),
      clubName: json['clubName']?.toString() ?? '',
      clubRotaryId: json['clubRotaryId']?.toString() ?? '',
      clubLogo: json['clubLogo']?.toString(),
      city: json['city']?.toString(),
      state: json['state']?.toString(),
      country: json['country']?.toString(),
      meetingDay: json['meetingDay']?.toString(),
      meetingAddress: json['meetingAddress']?.toString(),
      latitude: _toDouble(json['latitude']),
      longitude: _toDouble(json['longitude']),
      districtNumber: json['districtNumber']?.toString() ?? '',
      zoneName: json['zoneName']?.toString(),
      distanceKm: _toDouble(json['distanceKm']),
      isSyncedFromRotaryOrg: _toBoolOrNull(json['isSyncedFromRotaryOrg']),
    );
  }
}

class ClubFinderPage {
  final List<ClubFinderItem> items;
  final int totalCount;
  final int page;
  final int pageSize;

  const ClubFinderPage({
    required this.items,
    required this.totalCount,
    required this.page,
    required this.pageSize,
  });

  factory ClubFinderPage.fromJson(Map<String, dynamic> json) {
    return ClubFinderPage(
      items: ((json['items'] as List?) ?? const [])
          .map((e) => ClubFinderItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      totalCount: _toInt(json['totalCount']),
      page: _toInt(json['page']),
      pageSize: _toInt(json['pageSize']),
    );
  }

  bool get hasMore => items.length + (page - 1) * pageSize < totalCount;
}

class ClubWebsiteInfo {
  final String? subdomain;
  final String? clientDomain;
  final String status;

  const ClubWebsiteInfo({this.subdomain, this.clientDomain, required this.status});

  factory ClubWebsiteInfo.fromJson(Map<String, dynamic> j) {
    return ClubWebsiteInfo(
      subdomain: j['subdomain']?.toString(),
      clientDomain: j['clientDomain']?.toString(),
      status: j['status']?.toString() ?? '',
    );
  }

  /// Resolved URL to open. The backend (2026-06-22) writes the FINAL sanitised
  /// URL — full `https://…` or `""` when there's no live/expired site — into
  /// `clientDomain`, so we read it directly. `subdomain` is now only a legacy
  /// fallback the server keeps for old builds; we no longer compose from it
  /// (it would lack the parent domain). Empty → no website (return null).
  String? get url {
    final cd = (clientDomain ?? '').trim();
    if (cd.isEmpty) return null;
    return cd.startsWith('http') ? cd : 'https://$cd';
  }
}

class ClubFinderDetail {
  final Map<String, dynamic> club;
  final ClubOfficer? president;
  final ClubOfficer? secretary;
  final ClubWebsiteInfo? clubWebsite;
  final ClubWebsiteInfo? districtWebsite;

  const ClubFinderDetail({
    required this.club,
    this.president,
    this.secretary,
    this.clubWebsite,
    this.districtWebsite,
  });

  factory ClubFinderDetail.fromJson(Map<String, dynamic> json) {
    return ClubFinderDetail(
      club: Map<String, dynamic>.from(json['club'] as Map? ?? const {}),
      president: json['president'] == null
          ? null
          : ClubOfficer.fromJson(json['president'] as Map<String, dynamic>),
      secretary: json['secretary'] == null
          ? null
          : ClubOfficer.fromJson(json['secretary'] as Map<String, dynamic>),
      clubWebsite: json['clubWebsite'] == null
          ? null
          : ClubWebsiteInfo.fromJson(json['clubWebsite'] as Map<String, dynamic>),
      districtWebsite: json['districtWebsite'] == null
          ? null
          : ClubWebsiteInfo.fromJson(json['districtWebsite'] as Map<String, dynamic>),
    );
  }

  // Raw `club_master` columns come back PascalCase (c.*); JOIN aliases (`districtNumber`,
  // `districtId`, `zoneName`) stay lowercase-camel as aliased in SQL.
  String? _s(String key) => club[key]?.toString();
  String? _pick(List<String> keys) {
    for (final k in keys) {
      final v = club[k];
      if (v != null && v.toString().isNotEmpty) return v.toString();
    }
    return null;
  }

  String? get clubName => _pick(['ClubName', 'clubName']);
  String? get clubRotaryId => _pick(['ClubRotaryId', 'clubRotaryId']);
  String? get clubLogoPath => _pick(['ClubLogoPath', 'clubLogoPath']);
  String? get city => _pick(['City', 'city']);
  String? get state => _pick(['State', 'state']);
  String? get country => _pick(['Country', 'country']);
  String? get pincode => _pick(['Pincode', 'pincode']);
  String? get meetingDay => _pick(['MeetingDay', 'meetingDay']);
  String? get meetingAddress => _pick(['MeetingAddress', 'meetingAddress']);
  String? get meetingFromTime => _pick(['MeetingFromTime', 'meetingFromTime']);
  String? get meetingToTime => _pick(['MeetingToTime', 'meetingToTime']);
  String? get districtNumber => _s('districtNumber');
  String? get zoneName => _s('zoneName');
}

class ClubOfficer {
  final String name;
  final String? profilePhoto;

  const ClubOfficer({required this.name, this.profilePhoto});

  factory ClubOfficer.fromJson(Map<String, dynamic> json) {
    return ClubOfficer(
      name: json['name']?.toString() ?? '',
      profilePhoto: json['profilePhoto']?.toString(),
    );
  }
}

int _toInt(dynamic v) {
  if (v is int) return v;
  if (v is String) return int.tryParse(v) ?? 0;
  if (v is num) return v.toInt();
  return 0;
}

double? _toDouble(dynamic v) {
  if (v == null) return null;
  if (v is double) return v;
  if (v is int) return v.toDouble();
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

/// Tri-state bool: returns null when the field is absent so callers can tell
/// "not synced" (false) apart from "unknown / field not returned yet" (null).
/// Accepts JSON bools plus the 1/0 and "true"/"false" the API may emit.
bool? _toBoolOrNull(dynamic v) {
  if (v == null) return null;
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.trim().toLowerCase();
    if (s == 'true' || s == '1') return true;
    if (s == 'false' || s == '0') return false;
  }
  return null;
}
