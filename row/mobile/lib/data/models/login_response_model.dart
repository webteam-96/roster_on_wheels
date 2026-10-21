class LoginResponseModel {
  final String token;
  final String memberName;
  final int memberId;
  final List<String> roles;
  final bool isTemporaryPassword;
  final String? lastLoginTime;
  final int sessionExpiryMinutes;

  const LoginResponseModel({
    required this.token,
    required this.memberName,
    required this.memberId,
    required this.roles,
    required this.isTemporaryPassword,
    this.lastLoginTime,
    required this.sessionExpiryMinutes,
  });

  factory LoginResponseModel.fromJson(Map<String, dynamic> json) {
    return LoginResponseModel(
      token: json['token'] as String? ?? '',
      memberName: json['memberName'] as String? ?? '',
      memberId: json['memberId'] as int? ?? 0,
      roles: (json['roles'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      isTemporaryPassword: json['isTemporaryPassword'] as bool? ?? false,
      lastLoginTime: json['lastLoginTime'] as String?,
      sessionExpiryMinutes: json['sessionExpiryMinutes'] as int? ?? 480,
    );
  }
}
