class UpcomingEventModel {
  final int id;
  final String title;
  final String? description;
  final String? eventDate;
  final String? eventTime;
  final String? location;
  final String? photoPath;
  final bool isActive;
  final String? createdAt;

  const UpcomingEventModel({
    required this.id,
    required this.title,
    this.description,
    this.eventDate,
    this.eventTime,
    this.location,
    this.photoPath,
    this.isActive = true,
    this.createdAt,
  });

  factory UpcomingEventModel.fromJson(Map<String, dynamic> json) {
    return UpcomingEventModel(
      id: json['id'] as int? ?? 0,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      eventDate: json['eventDate'] as String?,
      eventTime: json['eventTime'] as String?,
      location: json['location'] as String?,
      photoPath: json['photoPath'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      createdAt: json['createdAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'title': title,
    'description': description,
    'eventDate': eventDate,
    'eventTime': eventTime,
    'location': location,
    'isActive': isActive,
  };
}
