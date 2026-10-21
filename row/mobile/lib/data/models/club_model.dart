class ClubModel {
  final int id;
  final int? fkDistrictId;
  final String? districtName;
  final int? districtNumber;
  final String? clubRotaryId;
  final String clubName;
  final String? clubLogoPath;
  final String? clubWebsite;
  final String? meetingDay;
  final String? meetingFromTime;
  final String? meetingToTime;
  final String? meetingAddress;
  final String? country;
  final String? state;
  final String? city;
  final String? pincode;
  final String? clubCharterDate;
  final String? activeFromDate;
  final String? activeToDate;
  final String? timezone;
  final bool isAutomaticMeetingReminder;
  final bool isFamilyLogin;
  final bool isActive;
  final int? totalMembers;

  const ClubModel({
    required this.id,
    this.fkDistrictId,
    this.districtName,
    this.districtNumber,
    this.clubRotaryId,
    required this.clubName,
    this.clubLogoPath,
    this.clubWebsite,
    this.meetingDay,
    this.meetingFromTime,
    this.meetingToTime,
    this.meetingAddress,
    this.country,
    this.state,
    this.city,
    this.pincode,
    this.clubCharterDate,
    this.activeFromDate,
    this.activeToDate,
    this.timezone,
    this.isAutomaticMeetingReminder = false,
    this.isFamilyLogin = false,
    required this.isActive,
    this.totalMembers,
  });

  factory ClubModel.fromJson(Map<String, dynamic> json) {
    return ClubModel(
      id: (json['id'] is String) ? int.tryParse(json['id']) ?? 0 : (json['id'] as int? ?? 0),
      fkDistrictId: (json['fkDistrictId'] is String) ? int.tryParse(json['fkDistrictId']) : json['fkDistrictId'] as int?,
      districtName: json['districtName']?.toString(),
      districtNumber: (json['districtNumber'] is String) ? int.tryParse(json['districtNumber']) : json['districtNumber'] as int?,
      clubRotaryId: json['clubRotaryId']?.toString(),
      clubName: json['clubName']?.toString() ?? '',
      clubLogoPath: json['clubLogoPath']?.toString(),
      clubWebsite: json['clubWebsite']?.toString(),
      meetingDay: json['meetingDay']?.toString(),
      meetingFromTime: json['meetingFromTime']?.toString(),
      meetingToTime: json['meetingToTime']?.toString(),
      meetingAddress: json['meetingAddress']?.toString(),
      country: json['country']?.toString(),
      state: json['state']?.toString(),
      city: json['city']?.toString(),
      pincode: json['pincode']?.toString(),
      clubCharterDate: json['clubCharterDate']?.toString(),
      activeFromDate: json['activeFromDate']?.toString(),
      activeToDate: json['activeToDate']?.toString(),
      timezone: json['timezone']?.toString(),
      isAutomaticMeetingReminder: json['isAutomaticMeetingReminder'] as bool? ?? false,
      isFamilyLogin: json['isFamilyLogin'] as bool? ?? false,
      isActive: json['isActive'] as bool? ?? true,
      totalMembers: (json['totalMembers'] is String) ? int.tryParse(json['totalMembers']) : json['totalMembers'] as int?,
    );
  }

  Map<String, dynamic> toJson() => {
    'fkDistrictId': fkDistrictId,
    'clubRotaryId': clubRotaryId,
    'clubName': clubName,
    'clubWebsite': clubWebsite,
    'meetingDay': meetingDay,
    'meetingFromTime': meetingFromTime,
    'meetingToTime': meetingToTime,
    'meetingAddress': meetingAddress,
    'country': country,
    'state': state,
    'city': city,
    'pincode': pincode,
    'clubCharterDate': clubCharterDate,
    'activeFromDate': activeFromDate,
    'activeToDate': activeToDate,
    'timezone': timezone,
    'isAutomaticMeetingReminder': isAutomaticMeetingReminder,
    'isFamilyLogin': isFamilyLogin,
    'isActive': isActive,
  };
}
