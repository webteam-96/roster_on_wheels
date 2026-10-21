/// One announcement inside the login popup.
class LoginAnnouncementItem {
  final int id;
  final String content;

  /// The role keys this announcement matched for this member — "ALL", or the
  /// specific ones (e.g. ClubAdmin, RIDirector). Shown as "For: …" so the
  /// reader knows which of their hats it is addressed to.
  final List<String> roles;

  const LoginAnnouncementItem({
    required this.id,
    required this.content,
    this.roles = const [],
  });

  static int? _id(dynamic raw) {
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    if (raw is String) return int.tryParse(raw);
    return null;
  }

  /// Null when the row carries no usable id or no content — a half-formed entry
  /// must not become a blank page the reader has to arrow past.
  static LoginAnnouncementItem? tryFromJson(Map<String, dynamic> j) {
    final id = _id(j['id']);
    final content = j['content']?.toString() ?? '';
    if (id == null || content.isEmpty) return null;
    return LoginAnnouncementItem(
      id: id,
      content: content,
      roles: (j['roles'] as List?)
              ?.map((r) => r.toString())
              .where((r) => r.isNotEmpty)
              .toList() ??
          const [],
    );
  }

  /// Human label for a role key, matching web's `loginAnnouncementRoleLabel`.
  /// An unknown key falls back to itself, so a role added on the server later
  /// still reads sensibly instead of disappearing.
  static String roleLabel(String key) {
    if (key == 'ALL') return 'All roles';
    return const {
      'SuperAdmin': 'SuperAdmin',
      'RIDirector': 'RI Director',
      'ZonalCoordinator': 'Zonal Coordinator',
      'ClubAdmin': 'Club Admin',
      'DistrictAdmin': 'District Admin',
      'AG': 'Assistant Governor (AG)',
      'ClubModerator': 'Club Moderator',
      'Member': 'Member',
      'ClubPresident': 'Club President',
      'ClubSecretary': 'Club Secretary',
      'RMC': 'Rotary Membership Co-Ordinator (RMC)',
      'ARC': 'Assistant Rotary Co-Ordinator (ARC)',
      'RPIC': 'Regional Public Image Co-Ordinator (RPIC)',
      'ARPIC': 'Assistant Regional Public Image Co-Ordinator (ARPIC)',
      'RRFC': 'Regional Rotary Foundation Co-Ordinator (RRFC)',
      'ARRFC': 'Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)',
    }[key] ??
        key;
  }
}

/// The `active` login-announcement payload.
///
/// The server sends BOTH shapes on purpose: `items[]` for the ◀ ▶ popup, and
/// the legacy `show`/`id`/`content` (= the first item) so builds that predate
/// `items[]` keep working. [items] therefore falls back to the legacy pair, and
/// this model reads correctly against either an old or a new API.
class ActiveLoginAnnouncement {
  final bool show;
  final List<LoginAnnouncementItem> items;

  const ActiveLoginAnnouncement({required this.show, this.items = const []});

  /// First item's id — kept so existing single-announcement callers still read.
  int? get id => items.isEmpty ? null : items.first.id;
  String? get content => items.isEmpty ? null : items.first.content;

  /// Nothing worth showing: the server said no, or every row was unusable.
  bool get hasContent => show && items.isNotEmpty;

  factory ActiveLoginAnnouncement.fromJson(Map<String, dynamic> j) {
    final raw = j['items'];
    final parsed = <LoginAnnouncementItem>[];
    if (raw is List) {
      for (final e in raw) {
        if (e is Map) {
          final item =
              LoginAnnouncementItem.tryFromJson(e.cast<String, dynamic>());
          if (item != null) parsed.add(item);
        }
      }
    }
    // Older API (or an items[] we couldn't use): fall back to the legacy fields.
    if (parsed.isEmpty) {
      final legacy = LoginAnnouncementItem.tryFromJson(j);
      if (legacy != null) parsed.add(legacy);
    }
    return ActiveLoginAnnouncement(show: j['show'] == true, items: parsed);
  }
}
