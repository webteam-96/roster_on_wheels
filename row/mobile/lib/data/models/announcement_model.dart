class AnnouncementModel {
  final int id;
  final String title;
  final String? description;
  final String? publishDate;
  final String? expiryDate;
  final bool isFeatured;
  final bool isActive;
  final String? createdAt;

  const AnnouncementModel({
    required this.id,
    required this.title,
    this.description,
    this.publishDate,
    this.expiryDate,
    this.isFeatured = false,
    this.isActive = true,
    this.createdAt,
  });

  factory AnnouncementModel.fromJson(Map<String, dynamic> json) {
    return AnnouncementModel(
      id: json['id'] as int? ?? 0,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      publishDate: json['publishDate'] as String?,
      expiryDate: json['expiryDate'] as String?,
      isFeatured: json['isFeatured'] as bool? ?? false,
      isActive: json['isActive'] as bool? ?? true,
      createdAt: json['createdAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'title': title,
    'description': description,
    'publishDate': publishDate,
    'expiryDate': expiryDate,
    'isFeatured': isFeatured,
    'isActive': isActive,
  };
}
