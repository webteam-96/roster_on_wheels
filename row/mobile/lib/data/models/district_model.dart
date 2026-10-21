import 'dart:developer' as dev;

class DistrictModel {
  final int id;
  final int? fkZoneId;
  final String? zoneName;
  final String districtNumber;
  final String districtName;
  final String? districtLogoPath;
  final String? website;
  final String? phoneNumber;
  final String? email;
  final String? city;
  final String? state;
  final String? country;
  final bool isActive;
  final String? activeFromDate;
  final String? activeToDate;
  final int? totalClubs;
  final int? totalMembers;

  const DistrictModel({
    required this.id,
    this.fkZoneId,
    this.zoneName,
    required this.districtNumber,
    required this.districtName,
    this.districtLogoPath,
    this.website,
    this.phoneNumber,
    this.email,
    this.city,
    this.state,
    this.country,
    required this.isActive,
    this.activeFromDate,
    this.activeToDate,
    this.totalClubs,
    this.totalMembers,
  });

  factory DistrictModel.fromJson(Map<String, dynamic> json) {
    try {
      final districtNumber = json['districtNumber']?.toString() ?? '';
      return DistrictModel(
        id: json['id'] as int? ?? 0,
        fkZoneId: json['fkZoneId'] as int?,
        zoneName: json['zoneName'] as String?,
        districtNumber: districtNumber,
        districtName: json['districtName'] as String? ?? districtNumber,
        districtLogoPath: json['districtLogoPath'] as String?,
        website: json['website'] as String?,
        phoneNumber: json['phoneNumber'] as String?,
        email: json['email'] as String?,
        city: json['city'] as String?,
        state: json['state'] as String?,
        country: json['country'] as String?,
        isActive: json['isActive'] as bool? ?? true,
        activeFromDate: json['activeFromDate'] as String?,
        activeToDate: json['activeToDate'] as String?,
        totalClubs: json['totalClubs'] as int?,
        totalMembers: json['totalMembers'] as int?,
      );
    } catch (e, st) {
      dev.log('DistrictModel.fromJson error: $e\n$st\nJSON: $json', name: 'Model');
      rethrow;
    }
  }

  Map<String, dynamic> toJson() => {
    'fkZoneId': fkZoneId,
    'districtNumber': districtNumber,
    'districtName': districtName,
    'website': website,
    'phoneNumber': phoneNumber,
    'email': email,
    'city': city,
    'state': state,
    'country': country,
    'isActive': isActive,
    'activeFromDate': activeFromDate,
    'activeToDate': activeToDate,
  };
}
