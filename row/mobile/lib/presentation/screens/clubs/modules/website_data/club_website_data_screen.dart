import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter_html/flutter_html.dart';
import 'package:flutter_quill/flutter_quill.dart' as quill;
import 'package:flutter_quill_delta_from_html/flutter_quill_delta_from_html.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:vsc_quill_delta_to_html/vsc_quill_delta_to_html.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Max banners that may be Active on the live site at once (web parity: lowered
/// 10 -> 6). Uploads are unlimited; this only caps how many can be shown. Ads
/// keep their own separate cap of 10.
const _maxActiveBanners = 6;

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear(
      {required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class ClubWebsiteDataScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const ClubWebsiteDataScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<ClubWebsiteDataScreen> createState() => _ClubWebsiteDataScreenState();
}

class _ClubWebsiteDataScreenState extends State<ClubWebsiteDataScreen> {
  final _api = ApiClient();

  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  bool _yearsLoading = true;

  // Mirrors web getClubHasWebsite(clubId): when false, modules are gated
  // behind an amber "website not created yet" banner and disabled.
  bool _hasWebsite = true;
  bool _checkingHasWebsite = true;

  static const _tabs = [
    Tab(text: 'Theme'),
    Tab(text: 'Banners'),
    Tab(text: 'Ads'),
    Tab(text: 'Menu'),
    Tab(text: 'Social Links'),
    Tab(text: 'About'),
    Tab(text: 'Contact'),
  ];

  @override
  void initState() {
    super.initState();
    _loadYears();
    _loadHasWebsite();
  }

  Future<void> _loadHasWebsite() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/has-website',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final has = _asBool(resp.data?['hasWebsite']);
      if (mounted) {
        setState(() {
          _hasWebsite = has;
          _checkingHasWebsite = false;
        });
      }
    } catch (_) {
      // On error, fail open (let the user proceed); the banner is a
      // soft guard, not a security boundary — the backend still enforces.
      if (mounted) {
        setState(() {
          _hasWebsite = true;
          _checkingHasWebsite = false;
        });
      }
    }
  }

  Future<void> _loadYears() async {
    List<_RotaryYear> years = [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      years = (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      years = [];
    }
    final current = years.firstWhere(
      (y) => y.isCurrent,
      orElse: () => years.isNotEmpty
          ? years.first
          : const _RotaryYear(id: 0, yearLabel: ''),
    );
    if (mounted) {
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _yearsLoading = false;
      });
    }
  }

  Widget _buildYearSelector() {
    if (_years.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Align(
        alignment: Alignment.centerLeft,
        child: SizedBox(
          width: 200,
          child: DropdownButtonFormField<int>(
            value: _selectedYearId,
            isExpanded: true,
            isDense: true,
            decoration: InputDecoration(
              labelText: 'Year',
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border:
                  OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
            items: _years
                .map((y) => DropdownMenuItem(
                      value: y.id,
                      child: Text(
                        '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ))
                .toList(),
            onChanged: (v) {
              if (v == null) return;
              setState(() => _selectedYearId = v);
            },
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final yearId = _selectedYearId ?? 0;
    // When the club has no website, force viewOnly on every tab as defence in
    // depth — pairs with the IgnorePointer wrapper around TabBarView below.
    final vo = widget.viewOnly || !_hasWebsite;
    final tabViews = TabBarView(
      children: [
        _ThemeTab(
            key: ValueKey('theme-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
        _BannersTab(
            key: ValueKey('banners-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
        _AdsTab(
            key: ValueKey('ads-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
        _MenuTab(
            key: ValueKey('menu-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
        _SocialLinksTab(
            key: ValueKey('social-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
        _AboutTab(
            key: ValueKey('about-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
        _ContactTab(
            key: ValueKey('contact-$yearId'),
            clubId: widget.clubId,
            yearId: yearId,
            viewOnly: vo),
      ],
    );

    final gatedTabViews = !_hasWebsite && !_checkingHasWebsite
        ? IgnorePointer(child: Opacity(opacity: 0.5, child: tabViews))
        : tabViews;

    final banner = !_hasWebsite && !_checkingHasWebsite
        ? const _NoWebsiteBanner()
        : const SizedBox.shrink();

    if (widget.embedded) {
      return DefaultTabController(
        length: 7,
        child: Column(children: [
          banner,
          _buildYearSelector(),
          const TabBar(
            isScrollable: true,
            labelColor: AppColors.primary,
            unselectedLabelColor: Colors.grey,
            indicatorColor: AppColors.primary,
            tabs: _tabs,
          ),
          Expanded(child: gatedTabViews),
        ]),
      );
    }
    return DefaultTabController(
      length: 7,
      child: Scaffold(
        appBar: const CustomAppBar(
          title: 'Website Data',
          bottom: const TabBar(
            isScrollable: true,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            indicatorColor: AppColors.goldPrime,
            tabs: _tabs,
          ),
        ),
        body: Column(
          children: [
            banner,
            _buildYearSelector(),
            Expanded(child: gatedTabViews),
          ],
        ),
      ),
    );
  }
}

// Amber banner shown when /api/clubs/{clubId}/has-website returns false.
// Mirrors rotary-frontend/src/app/clubs/[id]/website-data/page.tsx (non-
// super-admin branch — Flutter has no super-admin role).
class _NoWebsiteBanner extends StatelessWidget {
  const _NoWebsiteBanner();

  @override
  Widget build(BuildContext context) {
    const amberBorder = AppColors.goldLight; // amber-300
    const amberBg = AppColors.background; // amber-50
    const amberText = AppColors.warningInk; // amber-900

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: amberBg,
        border: Border.all(color: amberBorder),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Icon(Icons.error_outline, size: 20, color: amberText),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Club website not created yet',
                  style: AppFonts.body(
                    color: amberText,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'These modules are inactive until a club website is created for your club.',
                  style: AppFonts.body(
                    color: amberText,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'For assistance, please contact support'
                  '${Brand.current.supportPhones.isEmpty ? '' : ': ${Brand.current.supportPhones.join(' / ')}'}'
                  '${Brand.current.supportHours.isEmpty ? '' : ' (${Brand.current.supportHours})'}'
                  '${Brand.current.supportEmail.isEmpty ? '' : ' or email ${Brand.current.supportEmail}'}.',
                  style: AppFonts.body(
                    color: amberText,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// THEME TAB
// Spec: GET /api/themes for list, GET/PUT .../website-data/theme with yearId/themeId
// ---------------------------------------------------------------------------

class _ThemeTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _ThemeTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_ThemeTab> createState() => _ThemeTabState();
}

class _ThemeTabState extends State<_ThemeTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  bool _loading = true;
  bool _saving = false;

  List<Map<String, dynamic>> _themes = [];
  int? _selectedThemeId;
  String? _themeImagePath;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      // Fetch all available themes
      final themesResp = await _api.get('/api/themes', fromJson: (j) => j);
      final themesData = themesResp.data;
      List<Map<String, dynamic>> rawThemes = [];
      if (themesData is List) {
        rawThemes = themesData.cast<Map<String, dynamic>>();
      } else if (themesData is Map<String, dynamic>) {
        rawThemes = ((themesData['items'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
      }
      // Dedupe by id and drop entries with missing ids — the DropdownButton
      // asserts exactly one item per value, so two rows sharing an id or
      // missing an id would crash the frame.
      final seen = <int>{};
      _themes = [
        for (final t in rawThemes)
          if (t['id'] is int && seen.add(t['id'] as int)) t
      ];

      // Fetch saved club theme for this year
      if (widget.yearId > 0) {
        final savedResp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/theme?yearId=${widget.yearId}',
          fromJson: (j) => j,
        );
        if (savedResp.data != null) {
          final data = savedResp.data as Map<String, dynamic>;
          _selectedThemeId = data['themeId'] as int?;
        }
      }

      // If the saved theme id isn't in the current themes list (deleted or
      // filtered out), clear it so the dropdown doesn't assert.
      if (_selectedThemeId != null &&
          !_themes.any((t) => t['id'] == _selectedThemeId)) {
        _selectedThemeId = null;
      }
      _updatePreviewImage();
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _updatePreviewImage() {
    if (_selectedThemeId != null) {
      final theme = _themes.cast<Map<String, dynamic>?>().firstWhere(
            (t) => t?['id'] == _selectedThemeId,
            orElse: () => null,
          );
      _themeImagePath = theme?['themeImagePath']?.toString();
    } else {
      _themeImagePath = null;
    }
  }

  Future<void> _save() async {
    if (_selectedThemeId == null) {
      SnackbarUtils.showError(context, 'Please select a theme');
      return;
    }
    if (widget.yearId <= 0) {
      SnackbarUtils.showError(context, 'Please select a year');
      return;
    }
    setState(() => _saving = true);
    try {
      await _api.put('/api/clubs/${widget.clubId}/website-data/theme', body: {
        'yearId': widget.yearId,
        'themeId': _selectedThemeId,
      });
      if (mounted) SnackbarUtils.showSuccess(context, 'Theme saved');
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save theme');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionHeader('Website Theme', Icons.palette),
          const SizedBox(height: 16),
          // Theme selector
          DropdownButtonFormField<int>(
            value: _selectedThemeId,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Theme *',
              border:
                  OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
            items: _themes.map((t) {
              return DropdownMenuItem<int>(
                value: t['id'] as int?,
                child: Text(
                  t['name']?.toString() ??
                      t['themeName']?.toString() ??
                      'Theme ${t['id']}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              );
            }).toList(),
            onChanged: (v) {
              setState(() {
                _selectedThemeId = v;
                _updatePreviewImage();
              });
            },
            validator: (v) => v == null ? 'Please select a theme' : null,
          ),
          const SizedBox(height: 16),
          // Theme preview
          if (_themeImagePath != null && _themeImagePath!.isNotEmpty)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(
                _absUrl(_themeImagePath),
                width: double.infinity,
                height: 200,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => Container(
                  width: double.infinity,
                  height: 200,
                  color: Colors.grey[200],
                  alignment: Alignment.center,
                  child: const Text('No preview image available'),
                ),
              ),
            )
          else
            Container(
              width: double.infinity,
              height: 120,
              decoration: BoxDecoration(
                color: Colors.grey[100],
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: Text(
                _selectedThemeId != null
                    ? 'No preview image available'
                    : 'Select a theme to see preview',
                style: AppTextStyles.caption.copyWith(color: Colors.grey),
              ),
            ),
          const SizedBox(height: 24),
          if (!widget.viewOnly)
            CustomButton(
                label: 'Save Theme',
                onPressed: _saving ? null : _save,
                isLoading: _saving),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// BANNERS TAB
// Spec fields: bannerImagePath, description, sortOrder, isActive, yearId
// ---------------------------------------------------------------------------

class _BannersTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _BannersTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_BannersTab> createState() => _BannersTabState();
}

class _BannersTabState extends State<_BannersTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  List<Map<String, dynamic>> _banners = [];
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  int get _activeCount => _banners.where((b) => _asBool(b['isActive'])).length;

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/banners?yearId=${widget.yearId}',
          fromJson: (j) => j);
      final data = resp.data;
      List<dynamic> items;
      if (data is List) {
        items = data;
      } else if (data is Map<String, dynamic>) {
        items = (data['items'] as List<dynamic>?) ?? [];
      } else {
        items = [];
      }
      setState(() => _banners = items.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete Banner', message: 'Delete this banner?');
    if (ok != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/website-data/banners/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Banner deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  Future<void> _reorder(int id1, int id2) async {
    try {
      await _api.put('/api/clubs/${widget.clubId}/website-data/banners/reorder',
          body: {'id1': id1, 'id2': id2});
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Reorder failed');
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> banner) async {
    try {
      final newActive = !_asBool(banner['isActive']);
      final body = <String, dynamic>{
        'bannerImagePath': banner['bannerImagePath'] ?? '',
        'description': banner['description'] ?? '',
        'sortOrder': banner['sortOrder'] ?? 1,
        'isActive': newActive,
      };
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/banners/${banner['id']}',
          body: body);
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to update');
    }
  }

  void _openForm({Map<String, dynamic>? banner}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _BannerFormSheet(
        clubId: widget.clubId,
        yearId: widget.yearId,
        item: banner,
        defaultSortOrder: _banners.length + 1,
        onSaved: _load,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    return Scaffold(
      floatingActionButton: widget.viewOnly
          ? null
          : FloatingActionButton.small(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          // Active count badge
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: Alignment.centerRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _activeCount >= _maxActiveBanners
                      ? Colors.red[50]
                      : Colors.green[50],
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '$_activeCount/$_maxActiveBanners Active',
                  style: AppTextStyles.caption.copyWith(
                    color: _activeCount >= _maxActiveBanners
                        ? Colors.red[700]
                        : Colors.green[700],
                    fontWeight: FontWeight.w600,
                    fontSize: 11,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: _banners.isEmpty
                ? const EmptyStateWidget(title: 'No banners added')
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _banners.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final b = _banners[i];
                      final imgPath = b['bannerImagePath']?.toString();
                      final active = _asBool(b['isActive']);
                      return Card(
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                        child: ListTile(
                          leading: (imgPath != null && imgPath.isNotEmpty)
                              ? ClipRRect(
                                  borderRadius: BorderRadius.circular(6),
                                  child: Image.network(_absUrl(imgPath),
                                      width: 80,
                                      height: 45,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) =>
                                          _imgPlaceholder(80, 45)),
                                )
                              : _imgPlaceholder(80, 45),
                          title: Text(
                            b['description']?.toString().isNotEmpty == true
                                ? b['description'].toString()
                                : 'No description',
                            style: AppTextStyles.caption
                                .copyWith(fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Row(
                            children: [
                              Text('Order: ${b['sortOrder'] ?? '-'}',
                                  style: AppTextStyles.caption),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: active
                                      ? Colors.green[50]
                                      : Colors.grey[200],
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(active ? 'Active' : 'Inactive',
                                    style: AppTextStyles.caption
                                        .copyWith(fontSize: 10)),
                              ),
                            ],
                          ),
                          trailing: PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'edit') _openForm(banner: b);
                              if (v == 'delete') _delete(b['id'] as int);
                              if (v == 'toggle') _toggleActive(b);
                              if (v == 'up' && i > 0) {
                                _reorder(b['id'] as int,
                                    _banners[i - 1]['id'] as int);
                              }
                              if (v == 'down' && i < _banners.length - 1) {
                                _reorder(b['id'] as int,
                                    _banners[i + 1]['id'] as int);
                              }
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(
                                  value: 'edit', child: Text('Edit')),
                              if (i > 0)
                                const PopupMenuItem(
                                    value: 'up', child: Text('Move Up')),
                              if (i < _banners.length - 1)
                                const PopupMenuItem(
                                    value: 'down', child: Text('Move Down')),
                              PopupMenuItem(
                                value: 'toggle',
                                child: Text(active ? 'Deactivate' : 'Activate'),
                              ),
                              const PopupMenuItem(
                                value: 'delete',
                                child: Text('Delete',
                                    style: TextStyle(color: Colors.red)),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ADS TAB
// Spec fields: advertisementImagePath, documentPath, description, sortOrder, isActive, yearId
// ---------------------------------------------------------------------------

class _AdsTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _AdsTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_AdsTab> createState() => _AdsTabState();
}

class _AdsTabState extends State<_AdsTab> with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  List<Map<String, dynamic>> _ads = [];
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  int get _activeCount => _ads.where((a) => _asBool(a['isActive'])).length;

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/advertisements?yearId=${widget.yearId}',
          fromJson: (j) => j);
      final data = resp.data;
      List<dynamic> items;
      if (data is List) {
        items = data;
      } else if (data is Map<String, dynamic>) {
        items = (data['items'] as List<dynamic>?) ?? [];
      } else {
        items = [];
      }
      setState(() => _ads = items.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete Ad', message: 'Delete this advertisement?');
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/clubs/${widget.clubId}/website-data/advertisements/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Ad deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  Future<void> _reorder(int id1, int id2) async {
    try {
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/advertisements/reorder',
          body: {'id1': id1, 'id2': id2});
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Reorder failed');
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> ad) async {
    try {
      final newActive = !_asBool(ad['isActive']);
      final body = <String, dynamic>{
        'advertisementImagePath': ad['advertisementImagePath'] ?? '',
        'documentPath': ad['documentPath'],
        'description': ad['description'] ?? '',
        'sortOrder': ad['sortOrder'] ?? 1,
        'isActive': newActive,
      };
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/advertisements/${ad['id']}',
          body: body);
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to update');
    }
  }

  void _openForm({Map<String, dynamic>? ad}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AdFormSheet(
        clubId: widget.clubId,
        yearId: widget.yearId,
        item: ad,
        defaultSortOrder: _ads.length + 1,
        onSaved: _load,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    return Scaffold(
      floatingActionButton: widget.viewOnly
          ? null
          : FloatingActionButton.small(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: Alignment.centerRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _activeCount >= 10 ? Colors.red[50] : Colors.green[50],
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '$_activeCount/10 Active',
                  style: AppTextStyles.caption.copyWith(
                    color: _activeCount >= 10
                        ? Colors.red[700]
                        : Colors.green[700],
                    fontWeight: FontWeight.w600,
                    fontSize: 11,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: _ads.isEmpty
                ? const EmptyStateWidget(title: 'No ads configured')
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _ads.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final a = _ads[i];
                      final imgPath = a['advertisementImagePath']?.toString();
                      final docPath = a['documentPath']?.toString();
                      final active = _asBool(a['isActive']);
                      return Card(
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                        child: ListTile(
                          leading: (imgPath != null && imgPath.isNotEmpty)
                              ? ClipRRect(
                                  borderRadius: BorderRadius.circular(6),
                                  child: Image.network(_absUrl(imgPath),
                                      width: 80,
                                      height: 45,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) =>
                                          _imgPlaceholder(80, 45)),
                                )
                              : _imgPlaceholder(80, 45),
                          title: Text(
                            a['description']?.toString().isNotEmpty == true
                                ? a['description'].toString()
                                : 'No description',
                            style: AppTextStyles.caption
                                .copyWith(fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Row(
                            children: [
                              Text('Order: ${a['sortOrder'] ?? '-'}',
                                  style: AppTextStyles.caption),
                              const SizedBox(width: 8),
                              if (docPath != null && docPath.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(right: 6),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 4, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: Colors.blue[50],
                                      borderRadius: BorderRadius.circular(3),
                                    ),
                                    child: Text('Doc',
                                        style: AppTextStyles.caption.copyWith(
                                            fontSize: 10,
                                            color: Colors.blue[700])),
                                  ),
                                ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: active
                                      ? Colors.green[50]
                                      : Colors.grey[200],
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(active ? 'Active' : 'Inactive',
                                    style: AppTextStyles.caption
                                        .copyWith(fontSize: 10)),
                              ),
                            ],
                          ),
                          trailing: PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'edit') _openForm(ad: a);
                              if (v == 'delete') _delete(a['id'] as int);
                              if (v == 'toggle') _toggleActive(a);
                              if (v == 'up' && i > 0) {
                                _reorder(
                                    a['id'] as int, _ads[i - 1]['id'] as int);
                              }
                              if (v == 'down' && i < _ads.length - 1) {
                                _reorder(
                                    a['id'] as int, _ads[i + 1]['id'] as int);
                              }
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(
                                  value: 'edit', child: Text('Edit')),
                              if (i > 0)
                                const PopupMenuItem(
                                    value: 'up', child: Text('Move Up')),
                              if (i < _ads.length - 1)
                                const PopupMenuItem(
                                    value: 'down', child: Text('Move Down')),
                              PopupMenuItem(
                                value: 'toggle',
                                child: Text(active ? 'Deactivate' : 'Activate'),
                              ),
                              const PopupMenuItem(
                                value: 'delete',
                                child: Text('Delete',
                                    style: TextStyle(color: Colors.red)),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// MENU TAB
// Spec: menuName, linkType (page/external/document), linkValue, sortOrder, isActive
// Sub-menus: subMenuName, same fields
// ---------------------------------------------------------------------------

class _MenuTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _MenuTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_MenuTab> createState() => _MenuTabState();
}

class _MenuTabState extends State<_MenuTab> with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  List<Map<String, dynamic>> _menus = [];
  // Expanded menu ids -> sub-menu lists
  final Map<int, List<Map<String, dynamic>>> _subMenus = {};
  final Set<int> _expandedIds = {};
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/menu_list',
          fromJson: (j) => j);
      final data = resp.data;
      List<dynamic> items;
      if (data is List) {
        items = data;
      } else if (data is Map<String, dynamic>) {
        items = (data['items'] as List<dynamic>?) ?? [];
      } else {
        items = [];
      }
      setState(() {
        _menus = items.cast<Map<String, dynamic>>();
        _subMenus.clear();
        _expandedIds.clear();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadSubMenus(int menuId) async {
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/menu_list/$menuId/submenus',
          fromJson: (j) => j);
      final data = resp.data;
      List<dynamic> items;
      if (data is List) {
        items = data;
      } else if (data is Map<String, dynamic>) {
        items = (data['items'] as List<dynamic>?) ?? [];
      } else {
        items = [];
      }
      setState(() => _subMenus[menuId] = items.cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load sub-menus');
    }
  }

  void _toggleExpand(int menuId) {
    setState(() {
      if (_expandedIds.contains(menuId)) {
        _expandedIds.remove(menuId);
      } else {
        _expandedIds.add(menuId);
        if (!_subMenus.containsKey(menuId)) {
          _loadSubMenus(menuId);
        }
      }
    });
  }

  Future<void> _deleteMenu(int id) async {
    final menu = _menus.firstWhere((m) => m['id'] == id, orElse: () => {});
    final subCount = menu['subMenuCount'] ?? 0;
    final msg = subCount > 0
        ? 'This will also delete $subCount sub-menu(s). Continue?'
        : 'Delete this menu item?';
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete Menu', message: msg);
    if (ok != true) return;
    try {
      await _api
          .delete('/api/clubs/${widget.clubId}/website-data/menu_list/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  Future<void> _deleteSubMenu(int menuId, int subId) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete Sub-Menu', message: 'Delete this sub-menu item?');
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/clubs/${widget.clubId}/website-data/menu_list/$menuId/submenus/$subId');
      if (mounted) SnackbarUtils.showSuccess(context, 'Deleted');
      _loadSubMenus(menuId);
      _load(); // refresh counts
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  Future<void> _reorderMenus(int id1, int id2) async {
    try {
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/menu_list/reorder',
          body: {'id1': id1, 'id2': id2});
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Reorder failed');
    }
  }

  Future<void> _reorderSubMenus(int menuId, int id1, int id2) async {
    try {
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/menu_list/$menuId/submenus/reorder',
          body: {'id1': id1, 'id2': id2});
      _loadSubMenus(menuId);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Reorder failed');
    }
  }

  void _openMenuForm({Map<String, dynamic>? item}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _MenuItemFormSheet(
        clubId: widget.clubId,
        item: item,
        isSubMenu: false,
        menuId: null,
        defaultSortOrder: _menus.length + 1,
        onSaved: _load,
      ),
    );
  }

  void _openSubMenuForm(int menuId, {Map<String, dynamic>? item}) {
    final subs = _subMenus[menuId] ?? [];
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _MenuItemFormSheet(
        clubId: widget.clubId,
        item: item,
        isSubMenu: true,
        menuId: menuId,
        defaultSortOrder: subs.length + 1,
        onSaved: () {
          _loadSubMenus(menuId);
          _load(); // refresh counts
        },
      ),
    );
  }

  Color _linkTypeBadgeColor(String? type) {
    switch (type) {
      case 'external':
        return Colors.grey[200]!;
      case 'document':
        return Colors.grey[100]!;
      default:
        return Colors.blue[50]!; // page
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    return Scaffold(
      floatingActionButton: (widget.viewOnly || _menus.length >= 9)
          ? null
          : FloatingActionButton.small(
              onPressed: () => _openMenuForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: Alignment.centerRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _menus.length >= 9 ? Colors.red[50] : Colors.blue[50],
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '${_menus.length}/9 Menus',
                  style: AppTextStyles.caption.copyWith(
                    color:
                        _menus.length >= 9 ? Colors.red[700] : Colors.blue[700],
                    fontWeight: FontWeight.w600,
                    fontSize: 11,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: _menus.isEmpty
                ? const EmptyStateWidget(title: 'No menu items')
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _menus.length,
                    itemBuilder: (_, i) {
                      final m = _menus[i];
                      final menuId = m['id'] as int;
                      final expanded = _expandedIds.contains(menuId);
                      final subCount = m['subMenuCount'] ?? 0;
                      final active = _asBool(m['isActive']);
                      final subs = _subMenus[menuId] ?? [];

                      return Column(
                        children: [
                          Card(
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10)),
                            child: ListTile(
                              leading: InkWell(
                                onTap: () => _toggleExpand(menuId),
                                child: Icon(
                                  expanded
                                      ? Icons.expand_less
                                      : Icons.expand_more,
                                  color: AppColors.primary,
                                ),
                              ),
                              title: Text(
                                m['menuName']?.toString() ?? '',
                                style: AppTextStyles.caption
                                    .copyWith(fontWeight: FontWeight.w600),
                              ),
                              subtitle: Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: _linkTypeBadgeColor(
                                          m['linkType']?.toString()),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(
                                        m['linkType']?.toString() ?? 'page',
                                        style: AppTextStyles.caption
                                            .copyWith(fontSize: 10)),
                                  ),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: active
                                          ? Colors.green[50]
                                          : Colors.grey[200],
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(active ? 'Active' : 'Inactive',
                                        style: AppTextStyles.caption
                                            .copyWith(fontSize: 10)),
                                  ),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      border:
                                          Border.all(color: Colors.grey[300]!),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text('$subCount',
                                        style: AppTextStyles.caption
                                            .copyWith(fontSize: 10)),
                                  ),
                                ],
                              ),
                              trailing: PopupMenuButton<String>(
                                onSelected: (v) {
                                  if (v == 'edit') _openMenuForm(item: m);
                                  if (v == 'addSub') _openSubMenuForm(menuId);
                                  if (v == 'delete') _deleteMenu(menuId);
                                  if (v == 'toggle') {
                                    final body = <String, dynamic>{
                                      'menuName': m['menuName'],
                                      'linkType': m['linkType'],
                                      'linkValue': m['linkValue'],
                                      'sortOrder': m['sortOrder'],
                                      'isActive': !active,
                                    };
                                    _api
                                        .put(
                                            '/api/clubs/${widget.clubId}/website-data/menu_list/$menuId',
                                            body: body)
                                        .then((_) => _load());
                                  }
                                  if (v == 'up' && i > 0) {
                                    _reorderMenus(
                                        menuId, _menus[i - 1]['id'] as int);
                                  }
                                  if (v == 'down' && i < _menus.length - 1) {
                                    _reorderMenus(
                                        menuId, _menus[i + 1]['id'] as int);
                                  }
                                },
                                itemBuilder: (_) => [
                                  const PopupMenuItem(
                                      value: 'edit', child: Text('Edit')),
                                  const PopupMenuItem(
                                      value: 'addSub',
                                      child: Text('Add Sub-Menu')),
                                  if (i > 0)
                                    const PopupMenuItem(
                                        value: 'up', child: Text('Move Up')),
                                  if (i < _menus.length - 1)
                                    const PopupMenuItem(
                                        value: 'down',
                                        child: Text('Move Down')),
                                  PopupMenuItem(
                                    value: 'toggle',
                                    child: Text(
                                        active ? 'Deactivate' : 'Activate'),
                                  ),
                                  const PopupMenuItem(
                                    value: 'delete',
                                    child: Text('Delete',
                                        style: TextStyle(color: Colors.red)),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          // Sub-menus
                          if (expanded)
                            ...subs.asMap().entries.map((entry) {
                              final si = entry.key;
                              final s = entry.value;
                              final subActive = _asBool(s['isActive']);
                              return Padding(
                                padding: const EdgeInsets.only(left: 24),
                                child: Card(
                                  elevation: 1,
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(8)),
                                  child: ListTile(
                                    leading: Text('\u2514',
                                        style: TextStyle(
                                            fontSize: 18,
                                            color: Colors.grey[400])),
                                    title: Text(
                                      s['subMenuName']?.toString() ?? '',
                                      style: AppTextStyles.caption.copyWith(
                                          fontWeight: FontWeight.w600),
                                    ),
                                    subtitle: Row(
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: _linkTypeBadgeColor(
                                                s['linkType']?.toString()),
                                            borderRadius:
                                                BorderRadius.circular(4),
                                          ),
                                          child: Text(
                                              s['linkType']?.toString() ??
                                                  'page',
                                              style: AppTextStyles.caption
                                                  .copyWith(fontSize: 10)),
                                        ),
                                        const SizedBox(width: 6),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: subActive
                                                ? Colors.green[50]
                                                : Colors.grey[200],
                                            borderRadius:
                                                BorderRadius.circular(4),
                                          ),
                                          child: Text(
                                              subActive ? 'Active' : 'Inactive',
                                              style: AppTextStyles.caption
                                                  .copyWith(fontSize: 10)),
                                        ),
                                      ],
                                    ),
                                    trailing: PopupMenuButton<String>(
                                      onSelected: (v) {
                                        if (v == 'edit') {
                                          _openSubMenuForm(menuId, item: s);
                                        }
                                        if (v == 'delete') {
                                          _deleteSubMenu(
                                              menuId, s['id'] as int);
                                        }
                                        if (v == 'up' && si > 0) {
                                          _reorderSubMenus(
                                              menuId,
                                              s['id'] as int,
                                              subs[si - 1]['id'] as int);
                                        }
                                        if (v == 'down' &&
                                            si < subs.length - 1) {
                                          _reorderSubMenus(
                                              menuId,
                                              s['id'] as int,
                                              subs[si + 1]['id'] as int);
                                        }
                                      },
                                      itemBuilder: (_) => [
                                        const PopupMenuItem(
                                            value: 'edit', child: Text('Edit')),
                                        if (si > 0)
                                          const PopupMenuItem(
                                              value: 'up',
                                              child: Text('Move Up')),
                                        if (si < subs.length - 1)
                                          const PopupMenuItem(
                                              value: 'down',
                                              child: Text('Move Down')),
                                        const PopupMenuItem(
                                          value: 'delete',
                                          child: Text('Delete',
                                              style:
                                                  TextStyle(color: Colors.red)),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            }),
                        ],
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SOCIAL LINKS TAB
// Spec fields: platform, linkUrl, sortOrder, isActive, yearId
// ---------------------------------------------------------------------------

class _SocialLinksTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _SocialLinksTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_SocialLinksTab> createState() => _SocialLinksTabState();
}

class _SocialLinksTabState extends State<_SocialLinksTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  List<Map<String, dynamic>> _links = [];
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/social_media_links?yearId=${widget.yearId}',
          fromJson: (j) => j);
      final data = resp.data;
      List<dynamic> items;
      if (data is List) {
        items = data;
      } else if (data is Map<String, dynamic>) {
        items = (data['items'] as List<dynamic>?) ?? const [];
      } else {
        items = const [];
      }
      setState(() => _links = items.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete Link', message: 'Delete this social link?');
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/clubs/${widget.clubId}/website-data/social_media_links/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> item) async {
    try {
      final body = {
        'platform': item['platform'],
        'linkUrl': item['linkUrl'],
        'sortOrder': item['sortOrder'] ?? 0,
        'isActive': !_asBool(item['isActive'] ?? true),
      };
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/social_media_links/${item['id']}',
          body: body);
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to update');
    }
  }

  void _openForm({Map<String, dynamic>? item}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _SocialLinkFormSheet(
        clubId: widget.clubId,
        yearId: widget.yearId,
        item: item,
        defaultSortOrder: _links.length + 1,
        onSaved: _load,
      ),
    );
  }

  IconData _iconFor(String platform) {
    switch (platform.toLowerCase()) {
      case 'facebook':
        return Icons.facebook;
      case 'twitter':
        return Icons.flutter_dash;
      case 'instagram':
        return Icons.camera_alt;
      case 'linkedin':
        return Icons.work;
      case 'youtube':
        return Icons.play_circle;
      case 'telegram':
        return Icons.send;
      case 'pinterest':
        return Icons.push_pin;
      case 'threads':
        return Icons.alternate_email;
      case 'website':
        return Icons.language;
      default:
        return Icons.link;
    }
  }

  String _platformLabel(String platform) {
    switch (platform.toLowerCase()) {
      case 'facebook':
        return 'Facebook';
      case 'instagram':
        return 'Instagram';
      case 'twitter':
        return 'Twitter / X';
      case 'linkedin':
        return 'LinkedIn';
      case 'youtube':
        return 'YouTube';
      case 'telegram':
        return 'Telegram';
      case 'pinterest':
        return 'Pinterest';
      case 'threads':
        return 'Threads';
      case 'website':
        return 'Website';
      default:
        return platform;
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    final canManage = !widget.viewOnly && context.watch<AuthProvider>().isAdmin;
    return Scaffold(
      floatingActionButton: canManage
          ? FloatingActionButton.small(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            )
          : null,
      body: _links.isEmpty
          ? const EmptyStateWidget(title: 'No social links added')
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _links.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final m = _links[i];
                final platform = m['platform']?.toString() ?? '';
                final linkUrl = m['linkUrl']?.toString() ?? '';
                final active = _asBool(m['isActive'] ?? true);
                return Card(
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor:
                          AppColors.primary.withOpacity(active ? 0.12 : 0.05),
                      child: Icon(_iconFor(platform),
                          color: active ? AppColors.primary : Colors.grey),
                    ),
                    title: Text(
                      _platformLabel(platform),
                      style: AppTextStyles.caption
                          .copyWith(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(linkUrl,
                        style: AppTextStyles.caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    trailing: canManage
                        ? PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'edit') _openForm(item: m);
                              if (v == 'delete') _delete(m['id'] as int);
                              if (v == 'toggle') _toggleActive(m);
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(
                                  value: 'edit', child: Text('Edit')),
                              PopupMenuItem(
                                  value: 'toggle',
                                  child:
                                      Text(active ? 'Deactivate' : 'Activate')),
                              const PopupMenuItem(
                                  value: 'delete',
                                  child: Text('Delete',
                                      style: TextStyle(color: Colors.red))),
                            ],
                          )
                        : null,
                  ),
                );
              },
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// ABOUT TAB
// Spec: singleton per club, fields: content (rich text HTML), isActive
// ---------------------------------------------------------------------------

class _AboutTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _AboutTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_AboutTab> createState() => _AboutTabState();
}

class _AboutTabState extends State<_AboutTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  Map<String, dynamic>? _about;
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/about?yearId=${widget.yearId}',
          fromJson: (j) => j);
      final data = resp.data;
      if (data is List && data.isNotEmpty) {
        _about = data.first as Map<String, dynamic>;
      } else if (data is Map<String, dynamic>) {
        final items = (data['items'] as List<dynamic>?) ?? [];
        _about = items.isNotEmpty ? items.first as Map<String, dynamic> : null;
      } else {
        _about = null;
      }
    } catch (_) {
      _about = null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete About', message: 'Delete this About section?');
    if (ok != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/website-data/about/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  Future<void> _toggleActive() async {
    if (_about == null) return;
    try {
      final newActive = !_asBool(_about!['isActive']);
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/about/${_about!['id']}',
          body: {
            'content': _about!['content'] ?? '',
            'isActive': newActive,
          });
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  void _openForm({Map<String, dynamic>? item}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AboutFormPage(
          clubId: widget.clubId,
          yearId: widget.yearId,
          item: item,
          onSaved: _load,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();
    final canManage = !widget.viewOnly && context.watch<AuthProvider>().isAdmin;

    if (_about == null) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const EmptyStateWidget(title: 'No About content added'),
          if (canManage)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: CustomButton(
                label: 'Add About',
                onPressed: () => _openForm(),
              ),
            ),
        ],
      );
    }

    final active = _asBool(_about!['isActive']);
    final content = _about!['content']?.toString() ?? '';
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text('About Us', style: AppTextStyles.h3),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: active ? Colors.green[50] : Colors.grey[200],
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(active ? 'Active' : 'Inactive',
                        style: AppTextStyles.caption.copyWith(
                          fontWeight: FontWeight.w600,
                          fontSize: 11,
                          color: active ? Colors.green[700] : Colors.grey[700],
                        )),
                  ),
                ],
              ),
              const Divider(),
              const SizedBox(height: 8),
              Html(data: _normalizeHtml(content)),
              const SizedBox(height: 16),
              if (canManage)
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _openForm(item: _about),
                        child: const Text('Edit'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _toggleActive,
                        child: Text(active ? 'Deactivate' : 'Activate'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.red,
                        ),
                        onPressed: () => _delete(_about!['id'] as int),
                        child: const Text('Delete'),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// CONTACT TAB
// Spec: singleton per year, fields: email, phone, isActive, yearId
// Card-based CRUD, not a direct form
// ---------------------------------------------------------------------------

class _ContactTab extends StatefulWidget {
  final int clubId;
  final int yearId;
  final bool viewOnly;
  const _ContactTab(
      {super.key,
      required this.clubId,
      this.yearId = 0,
      this.viewOnly = false});
  @override
  State<_ContactTab> createState() => _ContactTabState();
}

class _ContactTabState extends State<_ContactTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();
  Map<String, dynamic>? _contact;
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
          '/api/clubs/${widget.clubId}/website-data/contact_details?yearId=${widget.yearId}',
          fromJson: (j) => j);
      final data = resp.data;
      if (data is List && data.isNotEmpty) {
        _contact = data.first as Map<String, dynamic>;
      } else if (data is Map<String, dynamic>) {
        // Could be a single object or have items array
        if (data.containsKey('items')) {
          final items = (data['items'] as List<dynamic>?) ?? [];
          _contact =
              items.isNotEmpty ? items.first as Map<String, dynamic> : null;
        } else if (data.containsKey('id')) {
          _contact = data;
        } else {
          _contact = null;
        }
      } else {
        _contact = null;
      }
    } catch (_) {
      _contact = null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Delete Contact', message: 'Delete this contact detail?');
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/clubs/${widget.clubId}/website-data/contact_details/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  Future<void> _toggleActive() async {
    if (_contact == null) return;
    try {
      final newActive = !_asBool(_contact!['isActive']);
      await _api.put(
          '/api/clubs/${widget.clubId}/website-data/contact_details/${_contact!['id']}',
          body: {
            'email': _contact!['email'] ?? '',
            'phone': _contact!['phone'] ?? '',
            'isActive': newActive,
          });
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed');
    }
  }

  void _openForm({Map<String, dynamic>? item}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ContactFormSheet(
        clubId: widget.clubId,
        yearId: widget.yearId,
        item: item,
        onSaved: _load,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const LoadingWidget();

    if (_contact == null) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const EmptyStateWidget(title: 'No contact details for this year'),
          if (!widget.viewOnly)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: CustomButton(
                label: 'Add Contact',
                onPressed: () => _openForm(),
              ),
            ),
        ],
      );
    }

    final active = _asBool(_contact!['isActive']);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text('Contact Details', style: AppTextStyles.h3),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: active ? Colors.green[50] : Colors.grey[200],
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(active ? 'Active' : 'Inactive',
                        style: AppTextStyles.caption.copyWith(
                          fontWeight: FontWeight.w600,
                          fontSize: 11,
                          color: active ? Colors.green[700] : Colors.grey[700],
                        )),
                  ),
                ],
              ),
              const Divider(),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.email_outlined,
                      size: 18, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_contact!['email']?.toString() ?? '-',
                        style: AppTextStyles.caption),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.phone_outlined,
                      size: 18, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_contact!['phone']?.toString() ?? '-',
                        style: AppTextStyles.caption),
                  ),
                ],
              ),
              if (!widget.viewOnly) ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _openForm(item: _contact),
                        child: const Text('Edit'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _toggleActive,
                        child: Text(active ? 'Deactivate' : 'Activate'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.red),
                        onPressed: () => _delete(_contact!['id'] as int),
                        child: const Text('Delete'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SHARED HELPERS
// ---------------------------------------------------------------------------

String _absUrl(String? path) => ApiConstants.mediaUrl(path);

String _stripHtml(String html) {
  return html.replaceAll(RegExp(r'<[^>]*>'), '').trim();
}

String _normalizeHtml(String html) {
  const base = ApiConstants.baseUrl;
  final srcReg = RegExp(r'''(src|href)=(["'])(/[^"']+)\2''');
  return html.replaceAllMapped(srcReg, (m) {
    final attr = m.group(1);
    final quote = m.group(2);
    final path = m.group(3);
    return '$attr=$quote$base$path$quote';
  });
}

Widget _imgPlaceholder(double w, double h) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
        color: Colors.grey[200],
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Icon(Icons.image, color: Colors.grey),
    );

Widget _sectionHeader(String title, IconData icon) => Row(
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppColors.primary.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: AppColors.primary, size: 20),
        ),
        const SizedBox(width: 10),
        Text(title, style: AppTextStyles.h3),
      ],
    );

class _UploadFieldRow extends StatelessWidget {
  final String label;
  final String? fileName;
  final String? imagePath;
  final bool uploading;
  final bool isImage;
  final VoidCallback onPick;
  final VoidCallback onClear;
  const _UploadFieldRow({
    required this.label,
    required this.fileName,
    required this.imagePath,
    required this.uploading,
    required this.isImage,
    required this.onPick,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final hasFile = (fileName != null && fileName!.isNotEmpty) ||
        (imagePath != null && imagePath!.isNotEmpty);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.caption),
        const SizedBox(height: 6),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            icon: uploading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(isImage ? Icons.image : Icons.upload_file, size: 18),
            label: Text(uploading
                ? 'Uploading...'
                : (hasFile
                    ? 'Replace'
                    : (isImage ? 'Pick Image' : 'Pick File'))),
            onPressed: uploading ? null : onPick,
          ),
        ),
        if (hasFile) ...[
          const SizedBox(height: 8),
          if (isImage && imagePath != null && imagePath!.isNotEmpty)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(
                _absUrl(imagePath),
                height: 80,
                width: 120,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  height: 80,
                  width: 120,
                  color: Colors.grey[200],
                  child: const Icon(Icons.image_not_supported),
                ),
              ),
            ),
          if (fileName != null && fileName!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                children: [
                  Icon(
                    isImage
                        ? Icons.image_outlined
                        : Icons.insert_drive_file_outlined,
                    size: 16,
                    color: Colors.grey[700],
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      fileName!,
                      style: AppTextStyles.caption,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16),
                    tooltip: 'Clear',
                    onPressed: onClear,
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// BANNER FORM SHEET
// Spec: bannerImagePath, description, sortOrder, isActive, yearId (add only)
// ---------------------------------------------------------------------------

class _BannerFormSheet extends StatefulWidget {
  final int clubId;
  final int yearId;
  final Map<String, dynamic>? item;
  final int defaultSortOrder;
  final VoidCallback onSaved;
  const _BannerFormSheet({
    required this.clubId,
    required this.yearId,
    required this.onSaved,
    required this.defaultSortOrder,
    this.item,
  });

  @override
  State<_BannerFormSheet> createState() => _BannerFormSheetState();
}

class _BannerFormSheetState extends State<_BannerFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _descCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  String _isActive = '1';
  String? _imagePath;
  String? _imageFileName;
  bool _uploading = false;
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _descCtrl.text = widget.item!['description']?.toString() ?? '';
      _sortCtrl.text = (widget.item!['sortOrder'] ?? '').toString();
      _isActive = _asBool(widget.item!['isActive']) ? '1' : '0';
      _imagePath = widget.item!['bannerImagePath']?.toString();
    } else {
      _sortCtrl.text = widget.defaultSortOrder.toString();
    }
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    try {
      final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      setState(() => _uploading = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/banners/upload',
        filePath: picked.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      final newName = (resp.data?['fileName'] as String?) ?? picked.name;
      setState(() {
        _uploading = false;
        if (newPath.isNotEmpty) {
          _imagePath = newPath;
          _imageFileName = newName;
        }
      });
    } catch (e) {
      setState(() => _uploading = false);
      if (mounted) SnackbarUtils.showError(context, 'Upload failed');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_imagePath == null || _imagePath!.isEmpty) {
      SnackbarUtils.showError(context, 'Please upload a banner image');
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'bannerImagePath': _imagePath,
        'description': _descCtrl.text.trim(),
        'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 1,
        'isActive': _isActive == '1',
      };
      if (_isEdit) {
        await _api.put(
            '/api/clubs/${widget.clubId}/website-data/banners/${widget.item!['id']}',
            body: body);
      } else {
        body['yearId'] = widget.yearId;
        await _api.post('/api/clubs/${widget.clubId}/website-data/banners',
            body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Saved');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      minChildSize: 0.4,
      builder: (_, ctrl) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 12, bottom: 4),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Text(_isEdit ? 'Edit Banner' : 'Add Banner',
                  style: AppTextStyles.h3),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: ctrl,
                padding: EdgeInsets.fromLTRB(
                    20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
                child: Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _UploadFieldRow(
                        label: 'Banner Image *',
                        fileName: _imageFileName ?? _imagePath?.split('/').last,
                        imagePath: _imagePath,
                        uploading: _uploading,
                        onPick: _pickImage,
                        onClear: () => setState(() {
                          _imagePath = null;
                          _imageFileName = null;
                        }),
                        isImage: true,
                      ),
                      const SizedBox(height: 16),
                      CustomTextField(
                        controller: _descCtrl,
                        label: 'Description',
                        maxLines: 2,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        controller: _sortCtrl,
                        label: 'Sort Order',
                        keyboardType: TextInputType.number,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _isActive,
                        decoration: InputDecoration(
                          labelText: 'Status',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: const [
                          DropdownMenuItem(value: '1', child: Text('Active')),
                          DropdownMenuItem(value: '0', child: Text('Inactive')),
                        ],
                        onChanged: (v) => setState(() => _isActive = v ?? '1'),
                      ),
                      const SizedBox(height: 24),
                      CustomButton(
                        label: _isEdit ? 'Update' : 'Save',
                        onPressed: _saving ? null : _save,
                        isLoading: _saving,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// AD FORM SHEET
// Spec: advertisementImagePath, documentPath, description, sortOrder, isActive, yearId
// ---------------------------------------------------------------------------

class _AdFormSheet extends StatefulWidget {
  final int clubId;
  final int yearId;
  final Map<String, dynamic>? item;
  final int defaultSortOrder;
  final VoidCallback onSaved;
  const _AdFormSheet({
    required this.clubId,
    required this.yearId,
    required this.onSaved,
    required this.defaultSortOrder,
    this.item,
  });

  @override
  State<_AdFormSheet> createState() => _AdFormSheetState();
}

class _AdFormSheetState extends State<_AdFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _descCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  String _isActive = '1';
  String? _imagePath;
  String? _imageFileName;
  String? _docPath;
  String? _docFileName;
  bool _uploadingImage = false;
  bool _uploadingDoc = false;
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _descCtrl.text = widget.item!['description']?.toString() ?? '';
      _sortCtrl.text = (widget.item!['sortOrder'] ?? '').toString();
      _isActive = _asBool(widget.item!['isActive']) ? '1' : '0';
      _imagePath = widget.item!['advertisementImagePath']?.toString();
      _docPath = widget.item!['documentPath']?.toString();
      _docFileName = widget.item!['documentFileName']?.toString();
    } else {
      _sortCtrl.text = widget.defaultSortOrder.toString();
    }
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    try {
      final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      setState(() => _uploadingImage = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/advertisements/upload-image',
        filePath: picked.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      final newName = (resp.data?['fileName'] as String?) ?? picked.name;
      setState(() {
        _uploadingImage = false;
        if (newPath.isNotEmpty) {
          _imagePath = newPath;
          _imageFileName = newName;
        }
      });
    } catch (_) {
      setState(() => _uploadingImage = false);
      if (mounted) SnackbarUtils.showError(context, 'Image upload failed');
    }
  }

  Future<void> _pickDocument() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: [
          'pdf',
          'doc',
          'docx',
          'xls',
          'xlsx',
          'ppt',
          'pptx',
          'jpg',
          'jpeg',
          'png'
        ],
      );
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() => _uploadingDoc = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/advertisements/upload-document',
        filePath: f.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      final newName = (resp.data?['fileName'] as String?) ?? f.name;
      setState(() {
        _uploadingDoc = false;
        if (newPath.isNotEmpty) {
          _docPath = newPath;
          _docFileName = newName;
        }
      });
    } catch (_) {
      setState(() => _uploadingDoc = false);
      if (mounted) SnackbarUtils.showError(context, 'Document upload failed');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_imagePath == null || _imagePath!.isEmpty) {
      SnackbarUtils.showError(context, 'Please upload an advertisement image');
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'advertisementImagePath': _imagePath,
        'description': _descCtrl.text.trim(),
        'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 1,
        'isActive': _isActive == '1',
        if (_docPath != null && _docPath!.isNotEmpty) 'documentPath': _docPath,
      };
      if (_isEdit) {
        await _api.put(
            '/api/clubs/${widget.clubId}/website-data/advertisements/${widget.item!['id']}',
            body: body);
      } else {
        body['yearId'] = widget.yearId;
        await _api.post(
            '/api/clubs/${widget.clubId}/website-data/advertisements',
            body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Saved');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      minChildSize: 0.4,
      builder: (_, ctrl) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 12, bottom: 4),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child:
                  Text(_isEdit ? 'Edit Ad' : 'Add Ad', style: AppTextStyles.h3),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: ctrl,
                padding: EdgeInsets.fromLTRB(
                    20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
                child: Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _UploadFieldRow(
                        label: 'Advertisement Image *',
                        fileName: _imageFileName ?? _imagePath?.split('/').last,
                        imagePath: _imagePath,
                        uploading: _uploadingImage,
                        onPick: _pickImage,
                        onClear: () => setState(() {
                          _imagePath = null;
                          _imageFileName = null;
                        }),
                        isImage: true,
                      ),
                      const SizedBox(height: 16),
                      _UploadFieldRow(
                        label: 'Document (optional)',
                        fileName: _docFileName ?? _docPath?.split('/').last,
                        imagePath: null,
                        uploading: _uploadingDoc,
                        onPick: _pickDocument,
                        onClear: () => setState(() {
                          _docPath = null;
                          _docFileName = null;
                        }),
                        isImage: false,
                      ),
                      const SizedBox(height: 16),
                      CustomTextField(
                        controller: _descCtrl,
                        label: 'Description',
                        maxLines: 2,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        controller: _sortCtrl,
                        label: 'Sort Order',
                        keyboardType: TextInputType.number,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _isActive,
                        decoration: InputDecoration(
                          labelText: 'Status',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: const [
                          DropdownMenuItem(value: '1', child: Text('Active')),
                          DropdownMenuItem(value: '0', child: Text('Inactive')),
                        ],
                        onChanged: (v) => setState(() => _isActive = v ?? '1'),
                      ),
                      const SizedBox(height: 24),
                      CustomButton(
                        label: _isEdit ? 'Update' : 'Save',
                        onPressed: _saving ? null : _save,
                        isLoading: _saving,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// MENU ITEM / SUB-MENU FORM SHEET
// Spec: menuName/subMenuName, linkType (page/external/document), linkValue, sortOrder, isActive
// ---------------------------------------------------------------------------

class _MenuItemFormSheet extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? item;
  final bool isSubMenu;
  final int? menuId;
  final int defaultSortOrder;
  final VoidCallback onSaved;

  const _MenuItemFormSheet({
    required this.clubId,
    required this.onSaved,
    required this.isSubMenu,
    required this.menuId,
    required this.defaultSortOrder,
    this.item,
  });

  @override
  State<_MenuItemFormSheet> createState() => _MenuItemFormSheetState();
}

class _MenuItemFormSheetState extends State<_MenuItemFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _linkValueCtrl = TextEditingController();
  final _sortOrderCtrl = TextEditingController();
  String _linkType = 'page';
  String _isActive = '1';
  String? _docPath;
  String? _docFileName;
  bool _uploading = false;
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      final nameKey = widget.isSubMenu ? 'subMenuName' : 'menuName';
      _nameCtrl.text = widget.item![nameKey]?.toString() ?? '';
      _linkType = widget.item!['linkType']?.toString() ?? 'page';
      if (!['page', 'external', 'document'].contains(_linkType)) {
        _linkType = 'page';
      }
      _linkValueCtrl.text = widget.item!['linkValue']?.toString() ?? '';
      _sortOrderCtrl.text = (widget.item!['sortOrder'] ?? '').toString();
      _isActive = _asBool(widget.item!['isActive']) ? '1' : '0';
      if (_linkType == 'document') {
        _docPath = widget.item!['linkValue']?.toString();
      }
    } else {
      _sortOrderCtrl.text = widget.defaultSortOrder.toString();
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _linkValueCtrl.dispose();
    _sortOrderCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDocument() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
      );
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() => _uploading = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/menu_list/upload-document',
        filePath: f.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      final newName = (resp.data?['fileName'] as String?) ?? f.name;
      setState(() {
        _uploading = false;
        if (newPath.isNotEmpty) {
          _docPath = newPath;
          _docFileName = newName;
          _linkValueCtrl.text = newPath;
        }
      });
    } catch (e) {
      setState(() => _uploading = false);
      if (mounted) SnackbarUtils.showError(context, 'Upload failed');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final nameKey = widget.isSubMenu ? 'subMenuName' : 'menuName';
      final body = <String, dynamic>{
        nameKey: _nameCtrl.text.trim(),
        'linkType': _linkType,
        'linkValue': _linkType == 'document'
            ? (_docPath ?? _linkValueCtrl.text.trim())
            : _linkValueCtrl.text.trim(),
        'sortOrder': int.tryParse(_sortOrderCtrl.text.trim()) ?? 1,
        'isActive': _isActive == '1',
      };
      if (_isEdit) {
        final id = widget.item!['id'];
        if (widget.isSubMenu) {
          await _api.put(
              '/api/clubs/${widget.clubId}/website-data/menu_list/${widget.menuId}/submenus/$id',
              body: body);
        } else {
          await _api.put(
              '/api/clubs/${widget.clubId}/website-data/menu_list/$id',
              body: body);
        }
      } else {
        if (widget.isSubMenu) {
          await _api.post(
              '/api/clubs/${widget.clubId}/website-data/menu_list/${widget.menuId}/submenus',
              body: body);
        } else {
          await _api.post('/api/clubs/${widget.clubId}/website-data/menu_list',
              body: body);
        }
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Created');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final nameLabel = widget.isSubMenu ? 'Sub-Menu Name *' : 'Menu Name *';
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      maxChildSize: 0.9,
      minChildSize: 0.4,
      builder: (_, ctrl) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 12, bottom: 4),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Text(
                _isEdit
                    ? (widget.isSubMenu ? 'Edit Sub-Menu' : 'Edit Menu')
                    : (widget.isSubMenu ? 'Add Sub-Menu' : 'Add Menu'),
                style: AppTextStyles.h3,
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: ctrl,
                padding: EdgeInsets.fromLTRB(
                    20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
                child: Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: Column(
                    children: [
                      CustomTextField(
                        controller: _nameCtrl,
                        label: nameLabel,
                        validator: (v) =>
                            v == null || v.trim().isEmpty ? 'Required' : null,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _linkType,
                        decoration: InputDecoration(
                          labelText: 'Link Type *',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: const [
                          DropdownMenuItem(value: 'page', child: Text('Page')),
                          DropdownMenuItem(
                              value: 'external', child: Text('External Link')),
                          DropdownMenuItem(
                              value: 'document', child: Text('Document')),
                        ],
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() => _linkType = v);
                        },
                      ),
                      const SizedBox(height: 12),
                      if (_linkType == 'page')
                        CustomTextField(
                          controller: _linkValueCtrl,
                          label: 'Page Name',
                          hint: 'Enter page name (e.g., About Us)',
                        ),
                      if (_linkType == 'external')
                        CustomTextField(
                          controller: _linkValueCtrl,
                          label: 'External URL',
                          hint: 'https://...',
                          keyboardType: TextInputType.url,
                        ),
                      if (_linkType == 'document')
                        _UploadFieldRow(
                          label: 'Document',
                          fileName: _docFileName ?? _docPath?.split('/').last,
                          imagePath: null,
                          uploading: _uploading,
                          onPick: _pickDocument,
                          onClear: () => setState(() {
                            _docPath = null;
                            _docFileName = null;
                            _linkValueCtrl.text = '';
                          }),
                          isImage: false,
                        ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        controller: _sortOrderCtrl,
                        label: 'Sort Order',
                        keyboardType: TextInputType.number,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _isActive,
                        decoration: InputDecoration(
                          labelText: 'Status',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: const [
                          DropdownMenuItem(value: '1', child: Text('Active')),
                          DropdownMenuItem(value: '0', child: Text('Inactive')),
                        ],
                        onChanged: (v) => setState(() => _isActive = v ?? '1'),
                      ),
                      const SizedBox(height: 24),
                      CustomButton(
                        label: _isEdit ? 'Update' : 'Add Item',
                        onPressed: _saving ? null : _save,
                        isLoading: _saving,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SOCIAL LINK FORM SHEET
// Spec: platform, linkUrl, sortOrder, isActive, yearId (add only)
// ---------------------------------------------------------------------------

class _SocialLinkFormSheet extends StatefulWidget {
  final int clubId;
  final int yearId;
  final Map<String, dynamic>? item;
  final int defaultSortOrder;
  final VoidCallback onSaved;
  const _SocialLinkFormSheet({
    required this.clubId,
    required this.yearId,
    required this.onSaved,
    required this.defaultSortOrder,
    this.item,
  });

  @override
  State<_SocialLinkFormSheet> createState() => _SocialLinkFormSheetState();
}

class _SocialLinkFormSheetState extends State<_SocialLinkFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _urlCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  String _platform = 'facebook';
  String _isActive = '1';
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  static const _platforms = [
    'facebook',
    'instagram',
    'twitter',
    'linkedin',
    'youtube',
    'telegram',
    'pinterest',
    'threads',
    'website',
  ];

  static const _platformLabels = {
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'twitter': 'Twitter / X',
    'linkedin': 'LinkedIn',
    'youtube': 'YouTube',
    'telegram': 'Telegram',
    'pinterest': 'Pinterest',
    'threads': 'Threads',
    'website': 'Website',
  };

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      final m = widget.item!;
      final p = (m['platform']?.toString() ?? 'facebook').toLowerCase();
      _platform = _platforms.contains(p) ? p : 'facebook';
      _urlCtrl.text = m['linkUrl']?.toString() ?? '';
      _sortCtrl.text = (m['sortOrder'] ?? 0).toString();
      _isActive = _asBool(m['isActive'] ?? true) ? '1' : '0';
    } else {
      _sortCtrl.text = widget.defaultSortOrder.toString();
    }
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'platform': _platform,
        'linkUrl': _urlCtrl.text.trim(),
        'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 0,
        'isActive': _isActive == '1',
      };
      if (_isEdit) {
        await _api.put(
            '/api/clubs/${widget.clubId}/website-data/social_media_links/${widget.item!['id']}',
            body: body);
      } else {
        body['yearId'] = widget.yearId;
        await _api.post(
            '/api/clubs/${widget.clubId}/website-data/social_media_links',
            body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Saved');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      minChildSize: 0.4,
      builder: (_, ctrl) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 12, bottom: 4),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Text(_isEdit ? 'Edit Social Link' : 'Add Social Link',
                  style: AppTextStyles.h3),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: ctrl,
                padding: EdgeInsets.fromLTRB(
                    20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
                child: Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      DropdownButtonFormField<String>(
                        value: _platform,
                        decoration: InputDecoration(
                          labelText: 'Social Media Platform *',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: _platforms
                            .map((p) => DropdownMenuItem(
                                  value: p,
                                  child: Text(_platformLabels[p] ?? p),
                                ))
                            .toList(),
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() => _platform = v);
                        },
                        validator: (v) =>
                            v == null || v.isEmpty ? 'Required' : null,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        controller: _urlCtrl,
                        label: 'Link URL *',
                        hint: 'https://...',
                        keyboardType: TextInputType.url,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'URL required'
                            : null,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        controller: _sortCtrl,
                        label: 'Sort Order',
                        keyboardType: TextInputType.number,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _isActive,
                        decoration: InputDecoration(
                          labelText: 'Status',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: const [
                          DropdownMenuItem(value: '1', child: Text('Active')),
                          DropdownMenuItem(value: '0', child: Text('Inactive')),
                        ],
                        onChanged: (v) => setState(() => _isActive = v ?? '1'),
                      ),
                      const SizedBox(height: 24),
                      CustomButton(
                        label: _isEdit ? 'Update' : 'Save',
                        onPressed: _saving ? null : _save,
                        isLoading: _saving,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ABOUT FORM PAGE
// Spec: content (rich text / HTML), isActive
// ---------------------------------------------------------------------------

class _AboutFormPage extends StatefulWidget {
  final int clubId;
  final int yearId;
  final Map<String, dynamic>? item;
  final VoidCallback onSaved;
  const _AboutFormPage({
    required this.clubId,
    required this.yearId,
    required this.onSaved,
    this.item,
  });

  @override
  State<_AboutFormPage> createState() => _AboutFormPageState();
}

class _AboutFormPageState extends State<_AboutFormPage> {
  final _api = ApiClient();
  late final quill.QuillController _quillCtrl;
  final _editorFocusNode = FocusNode();
  final _editorScrollController = ScrollController();
  late String _activeStr;
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    final existingHtml = widget.item?['content']?.toString() ?? '';
    final initialDelta = existingHtml.trim().isNotEmpty
        ? HtmlToDelta().convert(existingHtml)
        : null;
    _quillCtrl = quill.QuillController(
      document: initialDelta != null
          ? quill.Document.fromDelta(initialDelta)
          : quill.Document(),
      selection: const TextSelection.collapsed(offset: 0),
    );
    _activeStr = (_asBool(widget.item?['isActive'] ?? true)) ? '1' : '0';
  }

  @override
  void dispose() {
    _quillCtrl.dispose();
    _editorFocusNode.dispose();
    _editorScrollController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final plain = _quillCtrl.document.toPlainText().trim();
    if (plain.isEmpty) {
      SnackbarUtils.showError(context, 'Content is required');
      return;
    }
    setState(() => _saving = true);
    try {
      final delta = _quillCtrl.document.toDelta();
      final converter = QuillDeltaToHtmlConverter(
        List<Map<String, dynamic>>.from(delta.toJson()),
        ConverterOptions.forEmail(),
      );
      final html = converter.convert();
      final body = <String, dynamic>{
        'content': html,
        'isActive': _activeStr == '1',
      };
      if (_isEdit) {
        await _api.put(
            '/api/clubs/${widget.clubId}/website-data/about/${widget.item!['id']}',
            body: body);
      } else {
        body['yearId'] = widget.yearId;
        await _api.post('/api/clubs/${widget.clubId}/website-data/about',
            body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Saved');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit About' : 'Add About',
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: _saving ? null : () => Navigator.pop(context),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : Text(_isEdit ? 'Update' : 'Save',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          // Quill toolbar
          Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              border: const Border(bottom: const BorderSide(color: AppColors.border)),
            ),
            child: quill.QuillSimpleToolbar(
              controller: _quillCtrl,
              config: const quill.QuillSimpleToolbarConfig(
                multiRowsDisplay: false,
                showFontFamily: false,
                showFontSize: false,
                showSmallButton: false,
                showStrikeThrough: false,
                showInlineCode: false,
                showCodeBlock: false,
                showQuote: false,
                showIndent: false,
                showSearchButton: false,
                showSubscript: false,
                showSuperscript: false,
                showDirection: false,
                showBackgroundColorButton: false,
                showListCheck: false,
                showLineHeightButton: false,
                showAlignmentButtons: true,
                showHeaderStyle: true,
                showListNumbers: true,
                showListBullets: true,
                showBoldButton: true,
                showItalicButton: true,
                showUnderLineButton: true,
                showColorButton: true,
                showClearFormat: true,
                showLink: true,
                showUndo: true,
                showRedo: true,
              ),
            ),
          ),
          // Quill editor
          Expanded(
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.all(16),
              child: quill.QuillEditor(
                controller: _quillCtrl,
                focusNode: _editorFocusNode,
                scrollController: _editorScrollController,
                config: const quill.QuillEditorConfig(
                  placeholder: 'Write about content here...',
                  expands: true,
                  scrollable: true,
                  autoFocus: false,
                ),
              ),
            ),
          ),
          // Status footer
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                Text('Status:', style: AppTextStyles.body),
                const SizedBox(width: 12),
                DropdownButton<String>(
                  value: _activeStr,
                  items: const [
                    DropdownMenuItem(value: '1', child: Text('Active')),
                    DropdownMenuItem(value: '0', child: Text('Inactive')),
                  ],
                  onChanged: (v) => setState(() => _activeStr = v ?? '1'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// CONTACT FORM SHEET
// Spec: email, phone, isActive, yearId (add only)
// ---------------------------------------------------------------------------

class _ContactFormSheet extends StatefulWidget {
  final int clubId;
  final int yearId;
  final Map<String, dynamic>? item;
  final VoidCallback onSaved;
  const _ContactFormSheet({
    required this.clubId,
    required this.yearId,
    required this.onSaved,
    this.item,
  });

  @override
  State<_ContactFormSheet> createState() => _ContactFormSheetState();
}

class _ContactFormSheetState extends State<_ContactFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  String _isActive = '1';
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _emailCtrl.text = widget.item!['email']?.toString() ?? '';
      _phoneCtrl.text = widget.item!['phone']?.toString() ?? '';
      _isActive = _asBool(widget.item!['isActive']) ? '1' : '0';
    }
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'email': _emailCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        'isActive': _isActive == '1',
      };
      if (_isEdit) {
        await _api.put(
            '/api/clubs/${widget.clubId}/website-data/contact_details/${widget.item!['id']}',
            body: body);
      } else {
        body['yearId'] = widget.yearId;
        await _api.post(
            '/api/clubs/${widget.clubId}/website-data/contact_details',
            body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Saved');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      minChildSize: 0.4,
      builder: (_, ctrl) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 12, bottom: 4),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Text(
                _isEdit ? 'Edit Contact' : 'Add Contact',
                style: AppTextStyles.h3,
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: ctrl,
                padding: EdgeInsets.fromLTRB(
                    20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
                child: Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: Column(
                    children: [
                      CustomTextField(
                        controller: _emailCtrl,
                        label: 'Email *',
                        hint: 'email@example.com',
                        keyboardType: TextInputType.emailAddress,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Email required'
                            : null,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        controller: _phoneCtrl,
                        label: 'Phone *',
                        hint: '+1 555 010 0100',
                        keyboardType: TextInputType.phone,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Phone required'
                            : null,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _isActive,
                        decoration: InputDecoration(
                          labelText: 'Status',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: const [
                          DropdownMenuItem(value: '1', child: Text('Active')),
                          DropdownMenuItem(value: '0', child: Text('Inactive')),
                        ],
                        onChanged: (v) => setState(() => _isActive = v ?? '1'),
                      ),
                      const SizedBox(height: 24),
                      CustomButton(
                        label: _isEdit ? 'Update' : 'Save',
                        onPressed: _saving ? null : _save,
                        isLoading: _saving,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
