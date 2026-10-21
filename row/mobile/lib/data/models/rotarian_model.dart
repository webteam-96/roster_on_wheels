class RotarianItem {
  final int memberId;
  final String memberName;
  final String? profilePhoto;
  final String? rotaryId;
  final String? email;
  final String? mobile;
  final String? gender;
  final String clubName;
  final String? clubRotaryId;
  final String districtNumber;
  final String? city;
  final String? state;

  const RotarianItem({
    required this.memberId,
    required this.memberName,
    this.profilePhoto,
    this.rotaryId,
    this.email,
    this.mobile,
    this.gender,
    required this.clubName,
    this.clubRotaryId,
    required this.districtNumber,
    this.city,
    this.state,
  });

  factory RotarianItem.fromJson(Map<String, dynamic> json) {
    return RotarianItem(
      memberId: _toInt(json['memberId']),
      memberName: json['memberName']?.toString() ?? '',
      profilePhoto: json['profilePhoto']?.toString(),
      rotaryId: json['rotaryId']?.toString(),
      email: json['email']?.toString(),
      mobile: json['mobile']?.toString(),
      gender: json['gender']?.toString(),
      clubName: json['clubName']?.toString() ?? '',
      clubRotaryId: json['clubRotaryId']?.toString(),
      districtNumber: json['districtNumber']?.toString() ?? '',
      city: json['city']?.toString(),
      state: json['state']?.toString(),
    );
  }
}

class RotarianPage {
  final List<RotarianItem> items;
  final int totalCount;
  final int page;
  final int pageSize;

  const RotarianPage({
    required this.items,
    required this.totalCount,
    required this.page,
    required this.pageSize,
  });

  factory RotarianPage.fromJson(Map<String, dynamic> json) {
    return RotarianPage(
      items: ((json['items'] as List?) ?? const [])
          .map((e) => RotarianItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      totalCount: _toInt(json['totalCount']),
      page: _toInt(json['page']),
      pageSize: _toInt(json['pageSize']),
    );
  }
}

class RotarianDetail {
  final RotarianProfile member;
  final List<RotarianAddress> addresses;
  final List<RotarianClub> clubs;
  final List<RotarianDesignation> designations;

  const RotarianDetail({
    required this.member,
    required this.addresses,
    required this.clubs,
    required this.designations,
  });

  factory RotarianDetail.fromJson(Map<String, dynamic> json) {
    return RotarianDetail(
      member: RotarianProfile.fromJson(
        Map<String, dynamic>.from(json['member'] as Map? ?? const {}),
      ),
      addresses: ((json['addresses'] as List?) ?? const [])
          .map((e) => RotarianAddress.fromJson(e as Map<String, dynamic>))
          .toList(),
      clubs: ((json['clubs'] as List?) ?? const [])
          .map((e) => RotarianClub.fromJson(e as Map<String, dynamic>))
          .toList(),
      designations: ((json['designations'] as List?) ?? const [])
          .map((e) => RotarianDesignation.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class RotarianProfile {
  final int memberId;
  final String memberName;
  final String? profilePhoto;
  final String? familyPhoto;
  final String? rotaryId;
  final String? email;
  final String? primaryMobile;
  final String? secondaryMobile;
  final DateTime? birthDate;
  final DateTime? anniversaryDate;
  final String? bloodGroup;
  final String? gender;
  final String? primaryLanguage;
  final bool isHonoraryMember;
  final bool isYouth;
  final bool isPersonalDetailsVisible;
  final bool isFamilyDetailsVisible;
  final String? memberIntroduction;
  final String? facebook;
  final String? instagram;
  final String? linkedIn;
  final String? twitter;
  final String? youtube;
  final String? website;
  final String? donorRecognition;
  final String? primaryCountry;
  final String? primaryPhoneCode;
  final String? secondaryCountry;
  final String? secondaryPhoneCode;

  const RotarianProfile({
    required this.memberId,
    required this.memberName,
    this.profilePhoto,
    this.familyPhoto,
    this.rotaryId,
    this.email,
    this.primaryMobile,
    this.secondaryMobile,
    this.birthDate,
    this.anniversaryDate,
    this.bloodGroup,
    this.gender,
    this.primaryLanguage,
    this.isHonoraryMember = false,
    this.isYouth = false,
    this.isPersonalDetailsVisible = true,
    this.isFamilyDetailsVisible = true,
    this.memberIntroduction,
    this.facebook,
    this.instagram,
    this.linkedIn,
    this.twitter,
    this.youtube,
    this.website,
    this.donorRecognition,
    this.primaryCountry,
    this.primaryPhoneCode,
    this.secondaryCountry,
    this.secondaryPhoneCode,
  });

  factory RotarianProfile.fromJson(Map<String, dynamic> j) {
    return RotarianProfile(
      memberId: _toInt(j['memberId']),
      memberName: j['memberName']?.toString() ?? '',
      profilePhoto: j['profilePhoto']?.toString(),
      familyPhoto: j['familyPhoto']?.toString(),
      rotaryId: j['rotaryId']?.toString(),
      email: j['email']?.toString(),
      primaryMobile: j['primaryMobile']?.toString(),
      secondaryMobile: j['secondaryMobile']?.toString(),
      birthDate: _parseDate(j['birthDate']),
      anniversaryDate: _parseDate(j['anniversaryDate']),
      bloodGroup: j['bloodGroup']?.toString(),
      gender: j['gender']?.toString(),
      primaryLanguage: j['primaryLanguage']?.toString(),
      isHonoraryMember: _toBool(j['isHonoraryMember']),
      isYouth: _toBool(j['isYouth']),
      isPersonalDetailsVisible: _toBool(j['isPersonalDetailsVisible'], defaultValue: true),
      isFamilyDetailsVisible: _toBool(j['isFamilyDetailsVisible'], defaultValue: true),
      memberIntroduction: j['memberIntroduction']?.toString(),
      facebook: j['facebook']?.toString(),
      instagram: j['instagram']?.toString(),
      linkedIn: j['linkedIn']?.toString(),
      twitter: j['twitter']?.toString(),
      youtube: j['youtube']?.toString(),
      website: j['website']?.toString(),
      donorRecognition: j['donorRecognition']?.toString(),
      primaryCountry: j['primaryCountry']?.toString(),
      primaryPhoneCode: j['primaryPhoneCode']?.toString(),
      secondaryCountry: j['secondaryCountry']?.toString(),
      secondaryPhoneCode: j['secondaryPhoneCode']?.toString(),
    );
  }
}

class RotarianAddress {
  final String? addressType;
  final String? phoneNumber;
  final String? address;
  final String? city;
  final String? state;
  final String? pinCode;
  final String? country;
  final String? businessName;
  final String? businessEmail;
  final String? designation;
  final String? classification;
  final String? keywords;

  const RotarianAddress({
    this.addressType,
    this.phoneNumber,
    this.address,
    this.city,
    this.state,
    this.pinCode,
    this.country,
    this.businessName,
    this.businessEmail,
    this.designation,
    this.classification,
    this.keywords,
  });

  factory RotarianAddress.fromJson(Map<String, dynamic> j) {
    return RotarianAddress(
      addressType: j['addressType']?.toString(),
      phoneNumber: j['phoneNumber']?.toString(),
      address: j['address']?.toString(),
      city: j['city']?.toString(),
      state: j['state']?.toString(),
      pinCode: j['pinCode']?.toString(),
      country: j['country']?.toString(),
      businessName: j['businessName']?.toString(),
      businessEmail: j['businessEmail']?.toString(),
      designation: j['designation']?.toString(),
      classification: j['classification']?.toString(),
      keywords: j['keywords']?.toString(),
    );
  }
}

class RotarianClub {
  final int clubId;
  final String clubName;
  final String? clubRotaryId;
  final String? clubLogo;
  final String? city;
  final String? state;
  final String districtNumber;
  final String? zoneName;
  final DateTime? joinedDate;
  // Per-club role/classification. Backend (2026-06-22) moved these from the
  // address object onto each club row (they live on club_members, per-club).
  // `profession` is the club-finder endpoint's name for `classification`.
  final String? designation;
  final String? classification;

  const RotarianClub({
    required this.clubId,
    required this.clubName,
    this.clubRotaryId,
    this.clubLogo,
    this.city,
    this.state,
    required this.districtNumber,
    this.zoneName,
    this.joinedDate,
    this.designation,
    this.classification,
  });

  factory RotarianClub.fromJson(Map<String, dynamic> j) {
    return RotarianClub(
      clubId: _toInt(j['clubId']),
      clubName: j['clubName']?.toString() ?? '',
      clubRotaryId: j['clubRotaryId']?.toString(),
      clubLogo: j['clubLogo']?.toString(),
      city: j['city']?.toString(),
      state: j['state']?.toString(),
      districtNumber: j['districtNumber']?.toString() ?? '',
      zoneName: j['zoneName']?.toString(),
      joinedDate: _parseDate(j['joinedDate']),
      designation: j['designation']?.toString(),
      // find-rotarian sends `classification`; club-finder sends `profession`.
      classification:
          (j['classification'] ?? j['profession'])?.toString(),
    );
  }
}

class RotarianDesignation {
  final String designationName;
  final String clubName;
  final int? sortOrder;

  const RotarianDesignation({
    required this.designationName,
    required this.clubName,
    this.sortOrder,
  });

  factory RotarianDesignation.fromJson(Map<String, dynamic> j) {
    return RotarianDesignation(
      designationName: j['designationName']?.toString() ?? '',
      clubName: j['clubName']?.toString() ?? '',
      sortOrder: j['sortOrder'] is int ? j['sortOrder'] as int : null,
    );
  }
}

int _toInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

bool _toBool(dynamic v, {bool defaultValue = false}) {
  if (v == null) return defaultValue;
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase();
    return s == 'true' || s == '1';
  }
  return defaultValue;
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
