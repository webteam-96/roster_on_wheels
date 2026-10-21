class DocumentModel {
  final int id;
  final String title;
  final String? description;
  final String? filePath;
  final String? fileType;
  final bool isActive;
  final String? createdAt;

  const DocumentModel({
    required this.id,
    required this.title,
    this.description,
    this.filePath,
    this.fileType,
    this.isActive = true,
    this.createdAt,
  });

  factory DocumentModel.fromJson(Map<String, dynamic> json) {
    return DocumentModel(
      id: json['id'] as int? ?? 0,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      filePath: json['filePath'] as String?,
      fileType: json['fileType'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      createdAt: json['createdAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'title': title,
    'description': description,
    'isActive': isActive,
  };
}
