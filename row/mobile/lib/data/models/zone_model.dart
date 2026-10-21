class ZoneModel {
  final int id;
  final String zoneName;
  final String? logoPath;
  final String? website;
  final String? phoneNumber;
  final String? email;
  final bool isActive;
  final String? activeFromDate;
  final String? activeToDate;
  final int? totalDistricts;
  final int? totalClubs;
  final int? totalMembers;

  const ZoneModel({
    required this.id,
    required this.zoneName,
    this.logoPath,
    this.website,
    this.phoneNumber,
    this.email,
    required this.isActive,
    this.activeFromDate,
    this.activeToDate,
    this.totalDistricts,
    this.totalClubs,
    this.totalMembers,
  });

  factory ZoneModel.fromJson(Map<String, dynamic> json) {
    return ZoneModel(
      id: json['id'] as int? ?? 0,
      zoneName: json['zoneName'] as String? ?? '',
      logoPath: json['logoPath'] as String?,
      website: json['website'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      email: json['email'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      activeFromDate: json['activeFromDate'] as String?,
      activeToDate: json['activeToDate'] as String?,
      totalDistricts: json['totalDistricts'] as int?,
      totalClubs: json['totalClubs'] as int?,
      totalMembers: json['totalMembers'] as int?,
    );
  }

  Map<String, dynamic> toJson() => {
    'zoneName': zoneName,
    'website': website,
    'phoneNumber': phoneNumber,
    'email': email,
    'isActive': isActive,
    'activeFromDate': activeFromDate,
    'activeToDate': activeToDate,
  };
}
