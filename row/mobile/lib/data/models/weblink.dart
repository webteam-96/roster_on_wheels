/// A single web link node from the mobile weblinks feed
/// (`GET /api/mobile/{clubs|districts}/{id}/weblinks`).
/// The feed is a flat list; hierarchy is expressed via [parentId] / [level] /
/// [childCount]. Container nodes (`Page` or with children) drill down; leaf
/// nodes open a URL / PDF / YouTube link.
class Weblink {
  final int id;
  final String title;
  final String? writeup;
  final String linkType; // None | Page | URL | PDF
  final String? linkUrl;
  final String? youtubeUrl;
  final String? buttonText;
  final String? logoPath;
  final String? bannerPath;
  final String? pdfPath;
  final int sortOrder;
  final bool isActive;
  final int level;
  final int? parentId;
  final int childCount;

  const Weblink({
    required this.id,
    required this.title,
    this.writeup,
    required this.linkType,
    this.linkUrl,
    this.youtubeUrl,
    this.buttonText,
    this.logoPath,
    this.bannerPath,
    this.pdfPath,
    this.sortOrder = 0,
    this.isActive = true,
    this.level = 1,
    this.parentId,
    this.childCount = 0,
  });

  /// True when tapping should drill into children rather than open a link.
  bool get isContainer => linkType == 'Page' || childCount > 0;

  factory Weblink.fromJson(Map<String, dynamic> j) => Weblink(
        id: (j['id'] as num?)?.toInt() ?? 0,
        title: (j['title'] ?? j['name'] ?? '').toString(),
        writeup: j['writeup']?.toString(),
        linkType: (j['linkType'] ?? 'None').toString(),
        linkUrl: j['linkUrl']?.toString(),
        youtubeUrl: j['youtubeUrl']?.toString(),
        buttonText: j['buttonText']?.toString(),
        logoPath: j['logoPath']?.toString(),
        bannerPath: j['bannerPath']?.toString(),
        pdfPath: j['pdfPath']?.toString(),
        sortOrder: (j['sortOrder'] as num?)?.toInt() ?? 0,
        isActive: j['isActive'] as bool? ?? true,
        level: (j['level'] as num?)?.toInt() ?? 1,
        parentId: (j['parentId'] as num?)?.toInt(),
        childCount: (j['childCount'] as num?)?.toInt() ?? 0,
      );
}
