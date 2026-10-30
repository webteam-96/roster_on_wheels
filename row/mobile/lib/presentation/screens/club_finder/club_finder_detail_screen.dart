import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/maps_utils.dart';
import '../../../core/utils/member_count_label.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/club_finder_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/maps_action_button.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

class ClubFinderDetailScreen extends StatefulWidget {
  final int clubId;

  /// This club's name + Rotary ID (from the results row). Passed to the Member
  /// tab so opening a member pins the detail hero to THIS club (a member can be
  /// in several clubs, so otherwise the hero would show the API's first club).
  final String? clubName;
  final String? clubRotaryId;

  const ClubFinderDetailScreen({
    super.key,
    required this.clubId,
    this.clubName,
    this.clubRotaryId,
  });

  @override
  State<ClubFinderDetailScreen> createState() => _ClubFinderDetailScreenState();
}

class _ClubFinderDetailScreenState extends State<ClubFinderDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 4, vsync: this);
    _tabCtrl.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Find a Club'),
      body: SafeArea(
        child: Column(
          children: [
            _tabBar(),
            Expanded(
              child: TabBarView(
                controller: _tabCtrl,
                children: [
                  _InfoTab(clubId: widget.clubId),
                  _MemberTab(
                    clubId: widget.clubId,
                    clubName: widget.clubName,
                    clubRotaryId: widget.clubRotaryId,
                  ),
                  _EventsTab(clubId: widget.clubId),
                  _ActivityTab(clubId: widget.clubId),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tabBar() {
    const titles = ['Info', 'Member', 'Events', 'Projects'];
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.white,
        border: const Border(bottom: const BorderSide(color: AppColors.border)),
      ),
      child: TabBar(
        controller: _tabCtrl,
        isScrollable: false,
        labelPadding: EdgeInsets.zero,
        labelStyle: AppFonts.body(
          fontSize: 14,
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelStyle: AppFonts.body(
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
        tabs: titles.map((t) => Tab(text: t, height: 44)).toList(),
      ),
    );
  }
}

// ============================================================================
// INFO TAB
// ============================================================================

class _InfoTab extends StatefulWidget {
  final int clubId;
  const _InfoTab({required this.clubId});

  @override
  State<_InfoTab> createState() => _InfoTabState();
}

class _InfoTabState extends State<_InfoTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  ClubFinderDetail? _detail;
  bool _loading = true;
  String? _error;

  // Roster counts for this club. The detail endpoint carries none, so we read
  // them off the members endpoint (page 1, size 1) — null until they land.
  // `_memberCount` is the REGULAR (non-honorary) count; `_honoraryCount` the
  // honorary subset.
  int? _memberCount;
  int? _honoraryCount;

  // Officer contact (call/SMS/email) — the club-finder detail endpoint
  // only returns the officers' name + photo, so we enrich it from the club's
  // members list (which carries email + mobile) by matching on name.
  String? _presEmail, _presMobile;
  String? _secEmail, _secMobile;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess && resp.data != null) {
        final detail = ClubFinderDetail.fromJson(resp.data!);
        setState(() {
          _detail = detail;
          _loading = false;
        });
        _loadMemberCount(); // fire-and-forget (non-blocking)
        _enrichOfficerContacts(detail); // fire-and-forget (non-blocking)
      } else {
        setState(() {
          _error = resp.error ?? 'Club not found';
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  /// Fetches just the roster total for the header pill. Uses pageSize 1 so we
  /// only pull `totalCount`, not the whole member list.
  Future<void> _loadMemberCount() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/members',
        queryParams: {'page': 1, 'pageSize': 1},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data ?? const {};
      // `memberCount` is net of honorary (backend). Fall back to `totalCount`
      // for older builds that didn't split the roster.
      final net = (data['memberCount'] as int?) ?? (data['totalCount'] as int?);
      final hon = data['honoraryCount'] as int?;
      if (net != null || hon != null) {
        setState(() {
          if (net != null) _memberCount = net;
          _honoraryCount = hon;
        });
      }
    } catch (_) {
      // Non-critical: leave the pills hidden if the counts can't be loaded.
    }
  }

  /// Looks up the email/mobile for the president & secretary by matching their
  /// name against the club members list (the detail endpoint omits contact).
  Future<void> _enrichOfficerContacts(ClubFinderDetail d) async {
    Future<Map<String, String?>?> lookup(String? name) async {
      final n = (name ?? '').trim();
      if (n.isEmpty) return null;
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/mobile/club-finder/${widget.clubId}/members',
          queryParams: {'page': 1, 'pageSize': 20, 'search': n},
          fromJson: (j) => j as Map<String, dynamic>,
        );
        final items = (resp.data?['items'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .toList();
        if (items.isEmpty) return null;
        // Prefer an exact name match; fall back to the sole result.
        final match = items.firstWhere(
          (m) =>
              (m['memberName']?.toString().trim().toLowerCase() ?? '') ==
              n.toLowerCase(),
          orElse: () => items.length == 1 ? items.first : const {},
        );
        if (match.isEmpty) return null;
        return {
          'email': match['email']?.toString(),
          'mobile': match['mobile']?.toString(),
        };
      } catch (_) {
        return null;
      }
    }

    final pres = await lookup(d.president?.name);
    final sec = await lookup(d.secretary?.name);
    if (!mounted) return;
    setState(() {
      _presEmail = pres?['email'];
      _presMobile = pres?['mobile'];
      _secEmail = sec?['email'];
      _secMobile = sec?['mobile'];
    });
  }

  String _digits(String input) => input.replaceAll(RegExp(r'[^0-9+]'), '');

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    final d = _detail;
    if (d == null) {
      return const EmptyStateWidget(
        title: 'Club not found',
        icon: Icons.error_outline_rounded,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primary,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _headerCard(d),
          if (d.president != null || d.secretary != null) ...[
            const SizedBox(height: 14),
            _officersCard(d),
          ],
          const SizedBox(height: 14),
          _infoRowsCard(d),
          if (d.clubWebsite?.url != null || d.districtWebsite?.url != null) ...[
            const SizedBox(height: 14),
            _websitesCard(d),
          ],
        ],
      ),
    );
  }

  Widget _headerCard(ClubFinderDetail d) {
    final logoUrl = _photoUrl(d.clubLogoPath);
    return _card(
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              width: 88,
              height: 88,
              color: AppColors.primaryLight,
              child: logoUrl == null
                  ? const Icon(Icons.account_balance_rounded, size: 40, color: AppColors.primary)
                  : CachedNetworkImage(
                      imageUrl: logoUrl,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(color: AppColors.primaryLight),
                      errorWidget: (_, __, ___) =>
                          const Icon(Icons.account_balance_rounded, size: 40, color: AppColors.primary),
                    ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            d.clubName ?? 'Club',
            style: AppFonts.display(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Builder(builder: (context) {
            final pills = <Widget>[
              _idPill('Club ID', d.clubRotaryId ?? '–'),
              _idPill('District ID', d.districtNumber ?? '–'),
              if (_memberCount != null) _idPill('Members', '$_memberCount'),
              if ((_honoraryCount ?? 0) > 0)
                _idPill('Honorary', '$_honoraryCount'),
            ];
            // Up to 3 pills fit a single row; a 4th (Honorary) would squeeze
            // every pill so labels/values wrap — so switch to a 2-per-row grid.
            if (pills.length <= 3) {
              return Row(
                children: [
                  for (var i = 0; i < pills.length; i++) ...[
                    if (i > 0) const SizedBox(width: 10),
                    Expanded(child: pills[i]),
                  ],
                ],
              );
            }
            return LayoutBuilder(builder: (context, c) {
              const gap = 10.0;
              final w = (c.maxWidth - gap) / 2;
              return Wrap(
                spacing: gap,
                runSpacing: gap,
                children: [
                  for (final p in pills) SizedBox(width: w, child: p),
                ],
              );
            });
          }),
        ],
      ),
    );
  }

  Widget _idPill(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.primaryPrime.withValues(alpha: 0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: AppFonts.body(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.primaryPrime,
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoRowsCard(ClubFinderDetail d) {
    final rows = <Widget>[];
    final address = _fullAddress(d);
    if (address.isNotEmpty) {
      rows.add(_labeledText('Address', address,
          onTap: () => _openMaps(address)));
    }
    final meeting = _meetingLine(d);
    if (meeting != null) {
      rows.add(_labeledText('Meeting Day and Time', meeting));
    }
    final charter = d.club['ClubCharterDate']?.toString();
    final charterDate = _parseDate(charter);
    if (charterDate != null) {
      rows.add(_labeledText('Charter Date', _fmtDate(charterDate)));
    }
    // Club Website row intentionally omitted here — the District Portal card
    // below already surfaces the relevant link, and ClubWebsite often comes
    // back as the literal "Not Known".
    final timezone = d.club['Timezone']?.toString();
    if (timezone != null && timezone.isNotEmpty) {
      rows.add(_labeledText('Timezone', timezone));
    }

    if (rows.isEmpty) return const SizedBox.shrink();
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: _interleave(rows),
      ),
    );
  }

  Widget _officersCard(ClubFinderDetail d) {
    final items = <Widget>[];
    if (d.president != null) {
      items.add(_officerRow('President', d.president!,
          email: _presEmail, mobile: _presMobile));
    }
    if (d.secretary != null) {
      items.add(_officerRow('Secretary', d.secretary!,
          email: _secEmail, mobile: _secMobile));
    }
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: _interleave(items),
      ),
    );
  }

  Widget _officerRow(String role, ClubOfficer officer,
      {String? email, String? mobile}) {
    final url = _photoUrl(officer.profilePhoto);
    final phone = (mobile ?? '').trim();
    final mail = (email ?? '').trim();
    final hasContact = phone.isNotEmpty || mail.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            ClipOval(
              child: Container(
                width: 46,
                height: 46,
                color: AppColors.primaryLight,
                child: url == null
                    ? const Icon(Icons.person_rounded, color: AppColors.primary)
                    : CachedNetworkImage(
                        imageUrl: url,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => Container(color: AppColors.primaryLight),
                        errorWidget: (_, __, ___) =>
                            const Icon(Icons.person_rounded, color: AppColors.primary),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    officer.name,
                    style: AppFonts.body(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    role,
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (hasContact) ...[
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ContactAction(
                  icon: Icons.call_rounded,
                  label: 'Call',
                  enabled: phone.isNotEmpty,
                  onTap: () => _openUrl('tel:${_digits(phone)}'),
                ),
              ),
              Expanded(
                child: _ContactAction(
                  icon: Icons.chat_bubble_outline_rounded,
                  label: 'SMS',
                  enabled: phone.isNotEmpty,
                  onTap: () => _openUrl('sms:${_digits(phone)}'),
                ),
              ),
              Expanded(
                child: _ContactAction(
                  icon: Icons.mail_outline_rounded,
                  label: 'Email',
                  enabled: mail.isNotEmpty,
                  onTap: () => _openUrl('mailto:$mail'),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _websitesCard(ClubFinderDetail d) {
    final rows = <Widget>[];
    if (d.clubWebsite?.url != null) {
      rows.add(_linkText('Club Portal', d.clubWebsite!.url!,
          onTap: () => _openUrl(d.clubWebsite!.url!), icon: Icons.public_rounded));
    }
    if (d.districtWebsite?.url != null) {
      rows.add(_linkText('District Portal', d.districtWebsite!.url!,
          onTap: () => _openUrl(d.districtWebsite!.url!), icon: Icons.language_rounded));
    }
    if (rows.isEmpty) return const SizedBox.shrink();
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: _interleave(rows),
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),

      ),
      child: child,
    );
  }

  Widget _labeledText(String label, String value, {VoidCallback? onTap}) {
    final showMapButton = onTap != null;
    final valueText = Text(
      value,
      style: AppFonts.body(
        fontSize: 15,
        color: AppColors.textPrimary,
        fontWeight: FontWeight.w600,
        height: 1.4,
      ),
    );
    final labelText = Text(
      label,
      style: AppFonts.body(
        fontSize: 13,
        color: AppColors.textSecondary,
        fontWeight: FontWeight.w600,
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Address rows put the map button up by the label so the value keeps
        // the full card width below (less wrapping).
        if (showMapButton)
          Row(
            children: [
              Expanded(child: labelText),
              const SizedBox(width: 12),
              MapsActionButton(onTap: onTap),
            ],
          )
        else
          labelText,
        const SizedBox(height: 6),
        valueText,
      ],
    );
  }

  Widget _linkText(String label, String value, {required VoidCallback onTap, IconData? icon}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: AppColors.primaryPrime),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  value,
                  style: AppFonts.body(
                    fontSize: 15,
                    color: AppColors.primaryPrime,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(Icons.open_in_new_rounded, size: 15, color: AppColors.primaryPrime),
            ],
          ),
        ],
      ),
    );
  }

  List<Widget> _interleave(List<Widget> items) {
    if (items.isEmpty) return const [];
    final out = <Widget>[];
    for (var i = 0; i < items.length; i++) {
      out.add(items[i]);
      if (i != items.length - 1) {
        out.add(const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Divider(height: 1),
        ));
      }
    }
    return out;
  }

  String _fullAddress(ClubFinderDetail d) {
    final parts = <String>[
      (d.meetingAddress ?? '').trim(),
      (d.city ?? '').trim(),
      (d.state ?? '').trim(),
      (d.pincode ?? '').trim(),
      (d.country ?? '').trim(),
    ].where((s) => s.isNotEmpty).toList();
    return parts.join(', ');
  }

  String? _meetingLine(ClubFinderDetail d) {
    final day = (d.meetingDay ?? '').trim();
    final time = _timeRange(d.meetingFromTime, d.meetingToTime);
    if (day.isEmpty && time == null) return null;
    if (day.isEmpty) return time;
    if (time == null) return day;
    return '$day  |  $time';
  }

  String? _timeRange(String? from, String? to) {
    String? fmt(String? raw) {
      if (raw == null || raw.isEmpty) return null;
      final parts = raw.split(':');
      if (parts.length < 2) return raw;
      final h = int.tryParse(parts[0]) ?? 0;
      final m = int.tryParse(parts[1]) ?? 0;
      final period = h >= 12 ? 'PM' : 'AM';
      final h12 = h % 12 == 0 ? 12 : h % 12;
      return '${h12.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')} $period';
    }
    final f = fmt(from);
    final t = fmt(to);
    if (f == null && t == null) return null;
    if (f != null && t != null) return '$f – $t';
    return f ?? t;
  }

  Future<void> _openUrl(String raw) async {
    var url = raw.trim();
    if (!url.startsWith('http') &&
        !url.startsWith('tel:') &&
        !url.startsWith('sms:') &&
        !url.startsWith('mailto:')) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // Open the club address in Google Maps. The address is normalized first so
  // smushed/abbreviated entries still resolve — see [googleMapsSearchUrl].
  Future<void> _openMaps(String address) async {
    final url = googleMapsSearchUrl(address);
    if (url == null) return;
    await _openUrl(url);
  }
}

class _ContactAction extends StatelessWidget {
  final IconData? icon;
  final String? iconAsset;
  final String label;
  final bool enabled;
  final VoidCallback? onTap;
  const _ContactAction({
    this.icon,
    this.iconAsset,
    required this.label,
    this.enabled = true,
    this.onTap,
  }) : assert(icon != null || iconAsset != null);

  @override
  Widget build(BuildContext context) {
    const color = AppColors.primaryPrime;
    return Opacity(
      opacity: enabled ? 1 : 0.35,
      child: InkResponse(
        onTap: enabled ? onTap : null,
        radius: 32,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color.withValues(alpha: 0.10),
              ),
              alignment: Alignment.center,
              child: iconAsset != null
                  ? Image.asset(iconAsset!, width: 20, height: 20, fit: BoxFit.contain)
                  : Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// MEMBER TAB
// ============================================================================

class _MemberTab extends StatefulWidget {
  final int clubId;
  final String? clubName;
  final String? clubRotaryId;
  const _MemberTab({required this.clubId, this.clubName, this.clubRotaryId});

  @override
  State<_MemberTab> createState() => _MemberTabState();
}

class _MemberTabState extends State<_MemberTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final List<Map<String, dynamic>> _items = [];
  int _page = 1;
  int _totalCount = 0;
  // Whole-club roster split (backend computes these ignoring the search filter):
  // regular (non-honorary) members + honorary subset.
  int _memberCount = 0;
  int _honoraryCount = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _fetch();
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollCtrl.hasClients) return;
    if (_scrollCtrl.position.pixels > _scrollCtrl.position.maxScrollExtent - 300 &&
        !_loadingMore &&
        _items.length < _totalCount) {
      _loadMore();
    }
  }

  Future<void> _fetch({bool reset = true}) async {
    setState(() {
      _loading = true;
      _error = null;
      if (reset) {
        _items.clear();
        _page = 1;
        _totalCount = 0;
      }
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/members',
        queryParams: _qp(1),
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data ?? {};
      final items = (data['items'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        _items
          ..clear()
          ..addAll(items);
        _totalCount = (data['totalCount'] as int?) ?? items.length;
        // `memberCount` is net of honorary; both are whole-club (ignore search).
        _memberCount = (data['memberCount'] as int?) ?? _totalCount;
        _honoraryCount = (data['honoraryCount'] as int?) ?? 0;
        _page = 1;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/members',
        queryParams: _qp(next),
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final items = ((resp.data?['items'] as List?) ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        _items.addAll(items);
        _page = next;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  Map<String, dynamic> _qp(int page) {
    final qp = <String, dynamic>{'page': page, 'pageSize': 20};
    final s = _searchCtrl.text.trim();
    if (s.isNotEmpty) qp['search'] = s;
    return qp;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Column(
      children: [
        _searchBar(hint: 'Search', onSubmit: () => _fetch()),
        _countHeader(),
        Expanded(child: _body()),
      ],
    );
  }

  // Member count for the searched club. Uses the server's total (reflects the
  // full club roster / filtered result, not just the loaded page). Hidden until
  // a successful load has members to show.
  Widget _countHeader() {
    if (_loading || _error != null || _items.isEmpty) {
      return const SizedBox.shrink();
    }
    // When searching, show the filtered result count; otherwise the whole-club
    // "X members · Y honorary" summary (memberCount is already net of honorary).
    final searching = _searchCtrl.text.trim().isNotEmpty;
    final label = searching
        ? (_totalCount == 1 ? '1 Member' : '$_totalCount Members')
        : memberCountLabel(
            total: _memberCount, alreadyNet: true, honorary: _honoraryCount);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          label,
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
          ),
        ),
      ),
    );
  }

  Widget _searchBar({required String hint, required VoidCallback onSubmit}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
      child: TextField(
        controller: _searchCtrl,
        onSubmitted: (_) => onSubmit(),
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: const Icon(Icons.search_rounded, size: 20),
          isDense: true,
          filled: true,
          fillColor: AppColors.muted.withValues(alpha: 0.6),
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading && _items.isEmpty) return const LoadingWidget();
    if (_error != null && _items.isEmpty) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    if (_items.isEmpty) return const _NotFoundState();
    return ListView.separated(
      controller: _scrollCtrl,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      itemCount: _items.length + (_loadingMore ? 1 : 0),
      separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
      itemBuilder: (_, i) {
        if (i >= _items.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: const RowSkeletonList(),
          );
        }
        return _memberRow(_items[i]);
      },
    );
  }

  Widget _memberRow(Map<String, dynamic> m) {
    final name = m['memberName']?.toString() ?? '';
    final photo = _photoUrl(m['profilePhoto']?.toString());
    final memberId = m['memberId'] as int?;
    // `isHonorary` comes through as 1/0 or true/false depending on the payload.
    final hv = m['isHonorary'];
    final isHonorary = hv == true ||
        hv == 1 ||
        hv?.toString() == '1' ||
        hv?.toString().toLowerCase() == 'true';
    return InkWell(
      onTap: memberId == null
          ? null
          : () => context.push(RouteNames.findRotarianDetail(
                memberId,
                clubName: widget.clubName,
                clubRotaryId: widget.clubRotaryId,
              )),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            ClipOval(
              child: Container(
                width: 44,
                height: 44,
                color: AppColors.primaryLight,
                child: photo == null
                    ? const Icon(Icons.person_outline_rounded, color: AppColors.primary)
                    : CachedNetworkImage(
                        imageUrl: photo,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => Container(color: AppColors.primaryLight),
                        errorWidget: (_, __, ___) =>
                            const Icon(Icons.person_outline_rounded, color: AppColors.primary),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    name,
                    style: AppFonts.body(
                      fontSize: 15,
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (isHonorary) ...[
                    const SizedBox(height: 4),
                    _honoraryTag(),
                  ],
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.primaryPrime),
          ],
        ),
      ),
    );
  }

  /// Small amber pill marking an honorary member, shown below the name.
  Widget _honoraryTag() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        'Honorary',
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: AppColors.warning,
        ),
      ),
    );
  }
}

// ============================================================================
// EVENTS TAB
// ============================================================================

class _EventsTab extends StatefulWidget {
  final int clubId;
  const _EventsTab({required this.clubId});

  @override
  State<_EventsTab> createState() => _EventsTabState();
}

class _EventsTabState extends State<_EventsTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final List<Map<String, dynamic>> _items = [];
  int _page = 1;
  int _totalCount = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _fetch();
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollCtrl.hasClients) return;
    if (_scrollCtrl.position.pixels > _scrollCtrl.position.maxScrollExtent - 300 &&
        !_loadingMore &&
        _items.length < _totalCount) {
      _loadMore();
    }
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
      _items.clear();
      _page = 1;
      _totalCount = 0;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/events',
        queryParams: {'page': 1, 'pageSize': 20},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data ?? {};
      final items = (data['items'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        _items.addAll(items);
        _totalCount = (data['totalCount'] as int?) ?? items.length;
        _page = 1;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/events',
        queryParams: {'page': next, 'pageSize': 20},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final items = ((resp.data?['items'] as List?) ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        _items.addAll(items);
        _page = next;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final filtered = _filter(_items, _searchCtrl.text.trim());
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
          child: TextField(
            controller: _searchCtrl,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Search',
              prefixIcon: const Icon(Icons.search_rounded, size: 20),
              isDense: true,
              filled: true,
              fillColor: AppColors.muted.withValues(alpha: 0.6),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
        Expanded(
          child: _loading && _items.isEmpty
              ? const LoadingWidget()
              : _error != null && _items.isEmpty
                  ? ErrorStateWidget(message: _error!, onRetry: _fetch)
                  : filtered.isEmpty
                      ? const _NotFoundState()
                      : ListView.separated(
                          controller: _scrollCtrl,
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                          itemCount: filtered.length + (_loadingMore ? 1 : 0),
                          separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
                          itemBuilder: (_, i) {
                            if (i >= filtered.length) {
                              return const Padding(
                                padding: EdgeInsets.all(16),
                                child: const RowSkeletonList(),
                              );
                            }
                            return _eventRow(filtered[i]);
                          },
                        ),
        ),
      ],
    );
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> list, String q) {
    if (q.isEmpty) return list;
    final lq = q.toLowerCase();
    return list.where((e) {
      final t = (e['title']?.toString() ?? '').toLowerCase();
      final d = (e['description']?.toString() ?? '').toLowerCase();
      final v = (e['venue']?.toString() ?? '').toLowerCase();
      return t.contains(lq) || d.contains(lq) || v.contains(lq);
    }).toList();
  }

  Widget _eventRow(Map<String, dynamic> e) {
    final title = e['title']?.toString() ?? '';
    final desc = e['description']?.toString() ?? '';
    final venue = e['venue']?.toString() ?? '';
    final dt = _parseDate(e['eventDate']?.toString());
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: AppFonts.body(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          if (desc.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              desc,
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.35,
              ),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (venue.isNotEmpty) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.place_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    venue,
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
          if (dt != null) ...[
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                _fmtDate(dt),
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.primaryPrime,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ============================================================================
// ACTIVITY (Projects) TAB
// ============================================================================

class _ActivityTab extends StatefulWidget {
  final int clubId;
  const _ActivityTab({required this.clubId});

  @override
  State<_ActivityTab> createState() => _ActivityTabState();
}

class _ActivityTabState extends State<_ActivityTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _years = [];
  int? _yearId;
  int _page = 1;
  int _totalCount = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _init();
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollCtrl.hasClients) return;
    if (_scrollCtrl.position.pixels > _scrollCtrl.position.maxScrollExtent - 300 &&
        !_loadingMore &&
        _items.length < _totalCount) {
      _loadMore();
    }
  }

  Future<void> _init() async {
    // Prefer the club-scoped /project-years (narrower — only years that
    // actually have projects for this club). Fall back to the global
    // /api/rotary-years if the club-scoped endpoint errors (a known
    // backend bug still returns 500 when y.YearName doesn't exist).
    List<Map<String, dynamic>> list = const [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/project-years',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      list = (resp.data ?? [])
          .whereType<Map<String, dynamic>>()
          .map((y) => <String, dynamic>{
                'yearId': y['yearId'] ?? y['id'],
                'yearName': y['yearLabel'] ?? y['yearName'] ?? y['label'],
                'isCurrent': y['isCurrent'] ?? false,
              })
          .where((y) => y['yearId'] is int && y['yearId'] as int > 0)
          .toList();
    } catch (_) {
      // Fall back to the global rotary years list on server error.
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        if (!mounted) return;
        list = (resp.data ?? [])
            .whereType<Map<String, dynamic>>()
            .map((y) => <String, dynamic>{
                  'yearId': y['id'] ?? y['yearId'],
                  'yearName': y['yearLabel'] ?? y['yearName'] ?? y['label'],
                  'isCurrent': y['isCurrent'] ?? false,
                })
            .where((y) => y['yearId'] is int && y['yearId'] as int > 0)
            .toList();
      } catch (_) {
        list = const [];
      }
    }
    if (!mounted) return;
    final current = list.firstWhere(
      (y) => y['isCurrent'] == true,
      orElse: () => list.isNotEmpty ? list.first : <String, dynamic>{},
    );
    setState(() {
      _years = list;
      _yearId = current['yearId'] as int?;
    });
    await _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
      _items.clear();
      _page = 1;
      _totalCount = 0;
    });
    try {
      final qp = <String, dynamic>{'page': 1, 'pageSize': 20};
      if (_yearId != null) qp['yearId'] = _yearId;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/projects',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data ?? {};
      final items = (data['items'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        _items.addAll(items);
        _totalCount = (data['totalCount'] as int?) ?? items.length;
        _page = 1;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final qp = <String, dynamic>{'page': next, 'pageSize': 20};
      if (_yearId != null) qp['yearId'] = _yearId;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${widget.clubId}/projects',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final items = ((resp.data?['items'] as List?) ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        _items.addAll(items);
        _page = next;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final filtered = _filter(_items, _searchCtrl.text.trim());
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: 'Search',
                    prefixIcon: const Icon(Icons.search_rounded, size: 20),
                    isDense: true,
                    filled: true,
                    fillColor: AppColors.muted.withValues(alpha: 0.6),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              if (_years.isNotEmpty) ...[
                const SizedBox(width: 10),
                _yearDropdown(),
              ],
            ],
          ),
        ),
        Expanded(
          child: _loading && _items.isEmpty
              ? const LoadingWidget()
              : _error != null && _items.isEmpty
                  ? _ProjectsUnavailableState(error: _error!, onRetry: _fetch)
                  : filtered.isEmpty
                      ? const _NotFoundState()
                      : ListView.separated(
                          controller: _scrollCtrl,
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                          itemCount: filtered.length + (_loadingMore ? 1 : 0),
                          separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
                          itemBuilder: (_, i) {
                            if (i >= filtered.length) {
                              return const Padding(
                                padding: EdgeInsets.all(16),
                                child: const RowSkeletonList(),
                              );
                            }
                            return _projectRow(filtered[i]);
                          },
                        ),
        ),
      ],
    );
  }

  Widget _yearDropdown() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.primaryPrime),
        borderRadius: BorderRadius.circular(10),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          value: _yearId,
          icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppColors.primaryPrime),
          style: AppFonts.body(
            fontSize: 13,
            color: AppColors.primaryPrime,
            fontWeight: FontWeight.w700,
          ),
          items: _years.map((y) {
            return DropdownMenuItem<int>(
              value: y['yearId'] as int?,
              child: Text(y['yearName']?.toString() ?? ''),
            );
          }).toList(),
          onChanged: (v) {
            setState(() => _yearId = v);
            _fetch();
          },
        ),
      ),
    );
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> list, String q) {
    if (q.isEmpty) return list;
    final lq = q.toLowerCase();
    return list.where((p) {
      final t = (p['title']?.toString() ?? '').toLowerCase();
      final d = (p['description']?.toString() ?? '').toLowerCase();
      return t.contains(lq) || d.contains(lq);
    }).toList();
  }

  Widget _projectRow(Map<String, dynamic> p) {
    final title = p['title']?.toString() ?? '';
    final desc = p['description']?.toString() ?? '';
    final dt = _parseDate(p['projectDate']?.toString());
    final projectId = (p['projectId'] is int)
        ? p['projectId'] as int
        : int.tryParse(p['projectId']?.toString() ?? '');
    final yearId = (p['yearId'] is int)
        ? p['yearId'] as int
        : int.tryParse(p['yearId']?.toString() ?? '') ?? _yearId;
    final coverUrl = _photoUrl(p['coverPhoto']?.toString());
    return InkWell(
      onTap: projectId == null
          ? null
          : () => context.push(
                RouteNames.clubFinderProjectDetail(projectId, yearId: yearId),
                extra: p,
              ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (coverUrl != null) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: CachedNetworkImage(
                  imageUrl: coverUrl,
                  width: 64,
                  height: 64,
                  fit: BoxFit.cover,
                  placeholder: (_, __) => Container(width: 64, height: 64, color: AppColors.muted),
                  errorWidget: (_, __, ___) => Container(
                    width: 64,
                    height: 64,
                    color: AppColors.muted,
                    child: const Icon(Icons.image_outlined, size: 22, color: AppColors.textSecondary),
                  ),
                ),
              ),
              const SizedBox(width: 12),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppFonts.body(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (desc.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      desc,
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                        height: 1.4,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (dt != null) ...[
                    const SizedBox(height: 6),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Text(
                        DateFormat('dd-MMM-yyyy').format(dt),
                        style: AppFonts.body(
                          fontSize: 13,
                          color: AppColors.primaryPrime,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right_rounded, size: 20, color: AppColors.textSecondary),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

class _NotFoundState extends StatelessWidget {
  const _NotFoundState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        'Record Not Found',
        style: AppFonts.body(
          fontSize: 16,
          color: AppColors.textSecondary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Softer error state for the Projects tab. Shows a friendly message for
/// server-side 500s (known backend issue with `y.YearName` in
/// `/projects` + `/project-years`) while still letting the user retry.
class _ProjectsUnavailableState extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ProjectsUnavailableState({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final isServer = error.contains('500');
    final title = isServer
        ? 'Projects temporarily unavailable'
        : 'Unable to load projects';
    final subtitle = isServer
        ? 'The server reported an error loading projects for this club. '
          'Please try again in a moment.'
        : error;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 40, color: AppColors.textMuted),
            const SizedBox(height: 10),
            Text(
              title,
              style: AppFonts.body(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Try again'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primaryPrime,
                side: const BorderSide(color: AppColors.primaryPrime),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

DateTime? _parseDate(String? v) {
  if (v == null || v.isEmpty) return null;
  final d = DateTime.tryParse(v);
  // Backend zero dates (`0001-01-01`) mean "no value" — surface as null.
  return (d == null || d.year <= 1) ? null : d;
}

String _fmtDate(DateTime d) => DateFormat('dd MMM yyyy').format(d);

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}
