class AttendeeModel {
  final int memberId;
  final String memberName;
  final bool isPresent;

  const AttendeeModel({
    required this.memberId,
    required this.memberName,
    required this.isPresent,
  });

  factory AttendeeModel.fromJson(Map<String, dynamic> json) {
    return AttendeeModel(
      memberId: json['memberId'] as int? ?? 0,
      memberName: json['memberName'] as String? ?? '',
      isPresent: json['isPresent'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
    'memberId': memberId,
    'isPresent': isPresent,
  };
}

class AttendanceModel {
  final int id;
  final String meetingDate;
  final String? notes;
  final int totalMembers;
  final int presentCount;
  final double? attendancePercentage;
  final List<AttendeeModel> attendees;
  final String? createdAt;

  const AttendanceModel({
    required this.id,
    required this.meetingDate,
    this.notes,
    this.totalMembers = 0,
    this.presentCount = 0,
    this.attendancePercentage,
    this.attendees = const [],
    this.createdAt,
  });

  factory AttendanceModel.fromJson(Map<String, dynamic> json) {
    return AttendanceModel(
      id: json['id'] as int? ?? 0,
      meetingDate: json['meetingDate'] as String? ?? '',
      notes: json['notes'] as String?,
      totalMembers: json['totalMembers'] as int? ?? 0,
      presentCount: json['presentCount'] as int? ?? 0,
      attendancePercentage: (json['attendancePercentage'] as num?)?.toDouble(),
      attendees: (json['attendees'] as List<dynamic>?)
              ?.map((e) => AttendeeModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      createdAt: json['createdAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'meetingDate': meetingDate,
    'notes': notes,
    'attendees': attendees.map((a) => a.toJson()).toList(),
  };
}
