class NewsletterModel {
  final int id;
  final String title;
  final String? description;
  final String? issueDate;
  final String? content;
  final bool isActive;
  final String? createdAt;

  const NewsletterModel({
    required this.id,
    required this.title,
    this.description,
    this.issueDate,
    this.content,
    this.isActive = true,
    this.createdAt,
  });

  factory NewsletterModel.fromJson(Map<String, dynamic> json) {
    return NewsletterModel(
      id: json['id'] as int? ?? 0,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      issueDate: json['issueDate'] as String?,
      content: json['content'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      createdAt: json['createdAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'title': title,
    'description': description,
    'issueDate': issueDate,
    'content': content,
    'isActive': isActive,
  };
}
