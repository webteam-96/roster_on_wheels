class RoleScopeModel {
  final String roleName;
  final String scope; // "global" | "zone" | "district" | "club"
  final int? zoneId;
  final String? zoneName;
  final int? districtId;
  final String? districtNumber;
  final int? clubId;
  final String? clubName;

  const RoleScopeModel({
    required this.roleName,
    required this.scope,
    this.zoneId,
    this.zoneName,
    this.districtId,
    this.districtNumber,
    this.clubId,
    this.clubName,
  });

  factory RoleScopeModel.fromJson(Map<String, dynamic> j) => RoleScopeModel(
        roleName: j['roleName']?.toString() ?? '',
        scope: j['scope']?.toString() ?? 'global',
        zoneId: j['zoneId'] as int?,
        zoneName: j['zoneName']?.toString(),
        districtId: j['districtId'] as int?,
        districtNumber: j['districtNumber']?.toString(),
        clubId: j['clubId'] as int?,
        clubName: j['clubName']?.toString(),
      );
}

class DistrictScopeModel {
  final int id;
  final String number;
  final int? zoneId;

  const DistrictScopeModel({required this.id, required this.number, this.zoneId});

  factory DistrictScopeModel.fromJson(Map<String, dynamic> j) => DistrictScopeModel(
        id: j['id'] as int? ?? 0,
        number: j['number']?.toString() ?? '',
        zoneId: j['zoneId'] as int?,
      );
}

class ClubScopeModel {
  final int id;
  final String name;
  final int? districtId;

  const ClubScopeModel({required this.id, required this.name, this.districtId});

  factory ClubScopeModel.fromJson(Map<String, dynamic> j) => ClubScopeModel(
        id: j['id'] as int? ?? 0,
        name: j['name']?.toString() ?? '',
        districtId: j['districtId'] as int?,
      );
}

class ZoneScopeModel {
  final int id;
  final String name;

  const ZoneScopeModel({required this.id, required this.name});

  factory ZoneScopeModel.fromJson(Map<String, dynamic> j) => ZoneScopeModel(
        id: j['id'] as int? ?? 0,
        name: j['name']?.toString() ?? '',
      );
}

class MobileOtpRequestResult {
  final String message;
  final bool sentEmail;
  final int otpExpiresInSeconds;

  const MobileOtpRequestResult({
    required this.message,
    required this.sentEmail,
    required this.otpExpiresInSeconds,
  });

  factory MobileOtpRequestResult.fromJson(Map<String, dynamic> j) =>
      MobileOtpRequestResult(
        message: j['message']?.toString() ?? '',
        sentEmail: j['sentEmail'] as bool? ?? false,
        otpExpiresInSeconds: j['otpExpiresInSeconds'] as int? ?? 300,
      );
}

class MobileVerifyOtpResult {
  final String token;
  final DateTime expiresAt;
  final int memberId;
  final String memberName;
  final String? email;
  final String? mobile;
  final String memberType;
  final int? familyMemberId;
  final List<String> roleNames;
  final List<RoleScopeModel> roles;
  final List<DistrictScopeModel> accessibleDistricts;
  final List<ClubScopeModel> accessibleClubs;
  final List<ZoneScopeModel> accessibleZones;

  const MobileVerifyOtpResult({
    required this.token,
    required this.expiresAt,
    required this.memberId,
    required this.memberName,
    this.email,
    this.mobile,
    required this.memberType,
    this.familyMemberId,
    required this.roleNames,
    required this.roles,
    required this.accessibleDistricts,
    required this.accessibleClubs,
    required this.accessibleZones,
  });

  factory MobileVerifyOtpResult.fromJson(Map<String, dynamic> j) =>
      MobileVerifyOtpResult(
        token: j['token']?.toString() ?? '',
        expiresAt: DateTime.tryParse(j['expiresAt']?.toString() ?? '') ??
            DateTime.now().add(const Duration(hours: 8)),
        memberId: j['memberId'] as int? ?? 0,
        memberName: j['memberName']?.toString() ?? '',
        email: j['email']?.toString(),
        mobile: j['mobile']?.toString(),
        memberType: j['memberType']?.toString() ?? 'member',
        familyMemberId: j['familyMemberId'] as int?,
        roleNames: (j['roleNames'] as List<dynamic>? ?? [])
            .map((e) => e.toString())
            .toList(),
        roles: (j['roles'] as List<dynamic>? ?? [])
            .map((e) => RoleScopeModel.fromJson(e as Map<String, dynamic>))
            .toList(),
        accessibleDistricts: (j['accessibleDistricts'] as List<dynamic>? ?? [])
            .map((e) => DistrictScopeModel.fromJson(e as Map<String, dynamic>))
            .toList(),
        accessibleClubs: (j['accessibleClubs'] as List<dynamic>? ?? [])
            .map((e) => ClubScopeModel.fromJson(e as Map<String, dynamic>))
            .toList(),
        accessibleZones: (j['accessibleZones'] as List<dynamic>? ?? [])
            .map((e) => ZoneScopeModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class CountryModel {
  final int id;
  final String name;
  final String phoneCode;
  final String? code;

  const CountryModel({
    required this.id,
    required this.name,
    required this.phoneCode,
    this.code,
  });

  factory CountryModel.fromJson(Map<String, dynamic> j) => CountryModel(
        id: (j['pk_country_id'] ?? j['id'] ?? 0) as int,
        name: (j['CountryName'] ?? j['countryName'] ?? j['name'] ?? '').toString(),
        phoneCode:
            (j['PhoneCode'] ?? j['phoneCode'] ?? j['dialCode'] ?? '').toString(),
        code: (j['CountryCode'] ?? j['countryCode'] ?? j['code'])?.toString(),
      );

  @override
  String toString() => '$name ($phoneCode)';
}
