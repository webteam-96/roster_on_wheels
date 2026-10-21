bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class RotaryYearModel {
  final int id;
  final String yearName;
  final String? startDate;
  final String? endDate;
  final bool isCurrent;

  const RotaryYearModel({
    required this.id,
    required this.yearName,
    this.startDate,
    this.endDate,
    this.isCurrent = false,
  });

  factory RotaryYearModel.fromJson(Map<String, dynamic> json) {
    return RotaryYearModel(
      id: json['id'] as int? ?? 0,
      yearName: json['yearName'] as String? ?? '',
      startDate: json['startDate'] as String?,
      endDate: json['endDate'] as String?,
      isCurrent: _asBool(json['isCurrent']),
    );
  }

  Map<String, dynamic> toJson() => {
    'yearName': yearName,
    'startDate': startDate,
    'endDate': endDate,
    'isCurrent': isCurrent,
  };
}
