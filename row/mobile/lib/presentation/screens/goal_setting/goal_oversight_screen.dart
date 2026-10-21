import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_exceptions.dart';
import '../../../core/services/district_admin_dashboard_api.dart';
import '../../../core/services/goal_setting_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../data/models/district_admin_dashboard_models.dart' show RotaryYearLite;
import '../../../data/models/goal_setting_models.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'widgets/goal_form_fields.dart';
import 'widgets/goal_club_matrix_sheet.dart';
import 'widgets/goal_messages_sheet.dart';
import 'widgets/goal_month_wise_sheet.dart';
import 'widgets/goal_district_matrix_table.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Goal Setting Oversight — mobile twin of the web `/goal-oversight` dashboard
/// for the goal oversight roles (RI Director / Zone Co-ordinator / District
/// Assistant).
///
/// Pick Zone → District → Club → Year, then READ the picked entity's Membership
/// / Youth Service / TRF / Public Image goals in exactly the form its own admin
/// fills in, greyed out. Excel goal reports download at whichever level is
/// selected. Below that sit the district overview matrix and the zone messaging
/// threads.
///
/// ⚠️ Web moved on (2026-09-11): its `/goal-oversight` no longer shows the
/// read-only form at all — `GoalReadonlyViewer` now lives only on the SuperAdmin
/// settings page. The DISTRICT MATRIX below is rebuilt to web's replacement
/// (`GoalOversightMatrix` → `district-summary-matrix`), but the drill-down form
/// above it is kept for now pending a call on removing it. Still outstanding
/// against web: the row-click month-wise popup, messages-in-a-popup with the
/// unread dot, and the acting-as role switcher.
///
/// Self-gates: a member with no goal assignment sees the "no oversight access"
/// state (mirrors web).
class GoalOversightScreen extends StatefulWidget {
  const GoalOversightScreen({super.key});

  @override
  State<GoalOversightScreen> createState() => _GoalOversightScreenState();
}

/// Which drill-down level an Excel report is being built for.
enum _ReportLevel { zone, district, club }

class _GoalOversightScreenState extends State<GoalOversightScreen> {
  final GoalSettingApi _api = GoalSettingApi();
  final DistrictAdminDashboardApi _dashApi = DistrictAdminDashboardApi();

  bool _loading = true;
  String? _bootError;

  List<GoalMyAssignment> _assignments = const [];

  /// Which goal role the member is acting AS, when they hold more than one.
  /// null = all of them at once, matching web with no `?as=` in the URL.
  ///
  /// ⚠️ Everything scope-shaped — zones, categories, the role label, bulk-lock,
  /// and therefore which matrix variant renders — must read the SCOPED list,
  /// not `_assignments`. Web filters exactly once, in the same place, for the
  /// same reason: a person who is both an RI Director and a District Assistant
  /// would otherwise see the two roles' scopes merged into one nonsense view.
  String? _actingRoleType;
  List<GoalCategory> _categories = const [];
  List<RotaryYearLite> _years = const [];
  int? _yearId;

  // ── drill-down selection (Zone → District → Club) ────────────────────────
  // The scoped district list is fetched once for the caller's FIRST assigned
  // category (as web does) and drives both the Zone and District pickers.
  List<GoalDistrictSummary> _districts = const [];
  bool _loadingDistricts = false;
  int? _zoneId;
  int? _districtId;

  List<GoalClubSummary> _clubs = const [];
  bool _loadingClubs = false;
  int? _clubId; // null → whole district

  // ── the read-only goal form ──────────────────────────────────────────────
  // Tabs cover EVERY category (not just the caller's), matching web: the panel
  // shows whatever the server returns for the picked entity, and a category
  // outside the caller's scope simply comes back with the server's message.
  int? _formCategoryId;
  GoalCategoryForm? _form;
  bool _loadingForm = false;
  String? _formError;
  final Map<int, GoalFieldBuffer> _buffers = {};
  int _reload = 0;

  // ── Excel reports ────────────────────────────────────────────────────────
  _ReportLevel? _downloading;

  // ── zone district matrix + bulk lock ─────────────────────────────────────
  // NOT category-keyed: the server returns every category the caller oversees
  // (RI Director = all four, a ZC/DA = their one), so this reloads on zone/year
  // only — never when the form's category tab changes.
  GoalDistrictSummaryMatrix? _matrix;
  bool _loadingMatrix = false;
  String? _matrixError;
  int? _downloadingDistrictId;

  /// Red dot on the Messages button — a message in this zone the caller hasn't
  /// seen. Re-checked whenever the zone/year changes and after the popup closes.
  bool _hasUnreadMessages = false;
  bool _bulkLocking = false;
  String? _bulkResult;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    setState(() {
      _loading = true;
      _bootError = null;
    });
    try {
      final results = await Future.wait([
        _api.getMyAssignments(),
        _api.getCategories(),
        _dashApi.getRotaryYears(),
      ]);
      if (!mounted) return;
      _assignments = results[0] as List<GoalMyAssignment>;
      _categories = results[1] as List<GoalCategory>;
      _years = results[2] as List<RotaryYearLite>;
      _yearId = _currentYearId(_years);
      _formCategoryId ??= _categories.isNotEmpty ? _categories.first.id : null;
      setState(() => _loading = false);
      _loadDistricts();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _bootError = friendlyErrorMessage(e, fallback: 'Failed to load Goal Setting.');
      });
    }
  }

  int? _currentYearId(List<RotaryYearLite> years) {
    if (years.isEmpty) return null;
    for (final y in years) {
      if (y.isCurrent) return y.id;
    }
    return years.first.id;
  }

  /// Categories the caller has an assignment for (∩ all categories). Only used
  /// to pick the id the district/club LIST endpoints are keyed by, and for the
  /// role label — the form tabs show every category, as on web.
  /// The assignments in force right now — all of them, or just the role being
  /// acted as. Read this, never `_assignments`.
  List<GoalMyAssignment> _scopedAssignments() {
    final t = _actingRoleType;
    if (t == null) return _assignments;
    return _assignments.where((a) => a.roleType == t).toList();
  }

  /// The distinct goal roles this member holds, in web's order. More than one
  /// ⇒ the switcher appears.
  List<({String type, String label})> _myRoles() {
    const order = [
      ('AllCategoryAllDistrictsFewZones', 'RI Director'),
      ('AllDistrictsOneCategoryOneZone', 'Zone Co-ordinator'),
      ('FewDistrictsOneCategoryOneZone', 'District Assistant'),
    ];
    final held = _assignments.map((a) => a.roleType).toSet();
    return [
      for (final r in order)
        if (held.contains(r.$1)) (type: r.$1, label: r.$2),
    ];
  }

  List<GoalCategory> _myCategories() {
    final ids = <int>{};
    for (final a in _scopedAssignments()) {
      ids.addAll(a.categoryIds);
    }
    if (ids.isEmpty) return const [];
    return _categories.where((c) => ids.contains(c.id)).toList();
  }

  /// The category id the scoped district/club lists are fetched with (web uses
  /// `myCategories[0]`). Falls back to the first category overall.
  int? get _listCategoryId {
    final mine = _myCategories();
    if (mine.isNotEmpty) return mine.first.id;
    return _categories.isNotEmpty ? _categories.first.id : null;
  }

  Set<int> _myZoneIds() {
    final s = <int>{};
    for (final a in _scopedAssignments()) {
      s.addAll(a.zoneIds);
    }
    return s;
  }

  String _roleLabel() {
    final types = _scopedAssignments().map((a) => a.roleType).toSet();
    if (types.contains('AllCategoryAllDistrictsFewZones')) return 'RI Director';
    if (types.contains('AllDistrictsOneCategoryOneZone')) return 'Zone Co-ordinator';
    if (types.contains('FewDistrictsOneCategoryOneZone')) return 'District Assistant';
    return 'Goal Setting Oversight';
  }

  bool get _canBulkLock => _scopedAssignments().any((a) => a.canBulkLock);

  // Zones derived from the scoped district list, restricted to assigned zones.
  List<({int id, String name})> _zonesInScope() {
    final my = _myZoneIds();
    final map = <int, String>{};
    for (final d in _districts) {
      if (d.zoneId != 0 && (my.isEmpty || my.contains(d.zoneId))) {
        map[d.zoneId] = d.zoneName ?? 'Zone ${d.zoneId}';
      }
    }
    final list = map.entries.map((e) => (id: e.key, name: e.value)).toList();
    list.sort((a, b) => a.name.compareTo(b.name));
    return list;
  }

  /// Districts shown in the District picker: the caller's scoped districts that
  /// sit in the selected zone.
  List<GoalDistrictSummary> _visibleDistricts() {
    final z = _zoneId;
    if (z == null) return const [];
    return _districts.where((d) => d.zoneId == z).toList()
      ..sort((a, b) => a.districtNumber.compareTo(b.districtNumber));
  }

  // ── loads ────────────────────────────────────────────────────────────────

  Future<void> _loadDistricts() async {
    final cat = _listCategoryId;
    final yr = _yearId;
    if (cat == null || yr == null) return;
    setState(() => _loadingDistricts = true);
    try {
      final rows = await _api.getScopedDistricts(cat, yr);
      if (!mounted) return;
      setState(() {
        _districts = rows;
        _loadingDistricts = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _districts = const [];
        _loadingDistricts = false;
      });
    }
    _reconcileSelection();
  }

  /// Keep the Zone/District selection valid after the district list reloads.
  /// A zone is auto-picked when there's only one in scope (a Zone Co-ordinator
  /// or District Assistant always has exactly one), so the common case needs no
  /// tap; District stays unpicked, matching web's "Select district".
  void _reconcileSelection() {
    final zones = _zonesInScope();
    if (zones.isEmpty) {
      setState(() {
        _zoneId = null;
        _districtId = null;
        _clubId = null;
        _matrix = null;
      });
      return;
    }
    if (_zoneId == null || !zones.any((z) => z.id == _zoneId)) {
      // Never leave a stale id selected — the dropdown asserts on a value that
      // isn't in its item list.
      _zoneId = zones.length == 1 ? zones.first.id : null;
    }
    if (_districtId != null && !_visibleDistricts().any((d) => d.districtId == _districtId)) {
      _districtId = null;
      _clubId = null;
      _clubs = const [];
    }
    setState(() {});
    _loadMatrix();
    if (_districtId != null) {
      _loadClubs();
      _loadForm();
    }
  }

  Future<void> _loadClubs() async {
    final cat = _listCategoryId;
    final yr = _yearId;
    final dist = _districtId;
    if (cat == null || yr == null || dist == null) {
      setState(() => _clubs = const []);
      return;
    }
    setState(() => _loadingClubs = true);
    try {
      final rows = await _api.getScopedDistrictClubs(cat, yr, dist);
      if (!mounted) return;
      setState(() {
        _clubs = rows;
        _loadingClubs = false;
        if (_clubId != null && !rows.any((c) => c.clubId == _clubId)) _clubId = null;
      });
    } catch (e) {
      if (!mounted) return;
      // A district whose clubs aren't listable is still viewable at district
      // level — drop the Club picker rather than failing the whole screen.
      setState(() {
        _clubs = const [];
        _loadingClubs = false;
        _clubId = null;
      });
    }
  }

  Future<void> _loadForm() async {
    final cat = _formCategoryId;
    final yr = _yearId;
    final dist = _districtId;
    if (cat == null || yr == null || dist == null) {
      setState(() {
        _form = null;
        _formError = null;
      });
      return;
    }
    setState(() {
      _loadingForm = true;
      _formError = null;
    });
    try {
      final club = _clubId;
      final GoalCategoryForm? form = club != null
          ? await _api.getScopedClubForm(cat, yr, club)
          : await _api.getScopedDistrictForm(cat, dist, yr);
      if (!mounted) return;
      if (form == null) {
        setState(() {
          _form = null;
          _loadingForm = false;
          _formError = 'No goals found for this selection.';
        });
        return;
      }
      _buffers
        ..clear()
        ..addAll(goalBuffersFromForm(form));
      _reload++;
      setState(() {
        _form = form;
        _loadingForm = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _form = null;
        _loadingForm = false;
        _formError = friendlyErrorMessage(e, fallback: 'Failed to load goals.');
      });
    }
  }

  Future<void> _loadMatrix() async {
    final zone = _zoneId;
    final yr = _yearId;
    if (zone == null || yr == null) {
      setState(() {
        _matrix = null;
        _matrixError = null;
      });
      return;
    }
    setState(() {
      _loadingMatrix = true;
      _matrixError = null;
    });
    try {
      final m = await _api.getDistrictSummaryMatrix(zone, yr);
      if (!mounted) return;
      setState(() {
        _matrix = m;
        _loadingMatrix = false;
      });
      _refreshUnread();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _matrix = null;
        _loadingMatrix = false;
        _matrixError =
            friendlyErrorMessage(e, fallback: 'Could not load the district overview.');
      });
    }
  }

  // ── selection handlers ───────────────────────────────────────────────────

  void _onZone(int? id) {
    if (id == null || id == _zoneId) return;
    setState(() {
      _zoneId = id;
      _districtId = null; // reset the lower selections, as web does
      _clubId = null;
      _clubs = const [];
      _form = null;
      _formError = null;
    });
    _loadMatrix();
  }

  void _onDistrict(int? id) {
    if (id == _districtId) return;
    setState(() {
      _districtId = id;
      _clubId = null;
      _clubs = const [];
      _form = null;
      _formError = null;
    });
    if (id != null) {
      _loadClubs();
      _loadForm();
    }
  }

  void _onClub(int? id) {
    if (id == _clubId) return;
    setState(() {
      _clubId = id;
      _form = null;
      _formError = null;
    });
    _loadForm();
  }

  /// Changing the year KEEPS the Zone/District/Club selection and just
  /// refreshes the figures (web behaves the same way).
  void _onYear(int? id) {
    if (id == null || id == _yearId) return;
    setState(() {
      _yearId = id;
      _form = null;
      _matrix = null;
      _matrixError = null;
      _bulkResult = null;
    });
    _loadDistricts();
  }

  void _onFormCategory(int id) {
    if (id == _formCategoryId) return;
    setState(() {
      _formCategoryId = id;
      _form = null;
      _formError = null;
    });
    _loadForm();
    // The district matrix is NOT category-keyed — it already carries every
    // category the caller oversees, so it must not be refetched here.
  }

  // ── Excel reports ────────────────────────────────────────────────────────

  /// Fetches the server-built Excel workbook for one drill-down level and hands
  /// it to the OS share sheet ("Save to Files" / Drive / send onward) — the
  /// mobile equivalent of the web's direct file save.
  Future<void> _downloadReport(_ReportLevel level) async {
    final yr = _yearId;
    if (yr == null || _downloading != null) return;

    String name;
    Future<List<int>> Function() fetch;
    switch (level) {
      case _ReportLevel.zone:
        final id = _zoneId;
        if (id == null) return;
        String? zoneName;
        for (final z in _zonesInScope()) {
          if (z.id == id) zoneName = z.name;
        }
        name = 'goal-zone-${_safe(zoneName ?? '$id')}';
        fetch = () => _api.downloadZoneReport(id, yr);
        break;
      case _ReportLevel.district:
        final id = _districtId;
        if (id == null) return;
        String? districtNo;
        for (final d in _districts) {
          if (d.districtId == id) districtNo = d.districtNumber;
        }
        name = 'goal-district-${_safe(districtNo ?? '$id')}';
        fetch = () => _api.downloadDistrictReport(id, yr);
        break;
      case _ReportLevel.club:
        final id = _clubId;
        if (id == null) return;
        String? clubName;
        for (final c in _clubs) {
          if (c.clubId == id) clubName = c.clubName;
        }
        name = 'goal-club-${_safe(clubName ?? '$id')}';
        fetch = () => _api.downloadClubReport(id, yr);
        break;
    }

    setState(() => _downloading = level);
    await _shareReport(name: name, fetch: fetch);
    if (mounted) setState(() => _downloading = null);
  }

  /// The oversight matrix's per-row download: that district's "District Goal
  /// Setting" workbook — the SAME file its own district admin gets. A different
  /// endpoint from the drill-down District report above, which is the older
  /// YTD + Month-wise sheet pair; web offers both side by side too.
  Future<void> _downloadDistrictSetting(int districtId, String districtNumber) async {
    final yr = _yearId;
    if (yr == null || _downloadingDistrictId != null) return;
    setState(() => _downloadingDistrictId = districtId);
    await _shareReport(
      name: 'District_Goal_Setting_D${_safe(districtNumber)}',
      fetch: () => _api.downloadDistrictSettingReport(districtId, yr),
    );
    if (mounted) setState(() => _downloadingDistrictId = null);
  }

  /// Fetches a server-built workbook, writes it to a temp file and hands it to
  /// the OS share sheet ("Save to Files" / Drive / send onward) — the mobile
  /// equivalent of the web's direct file save.
  Future<void> _shareReport({
    required String name,
    required Future<List<int>> Function() fetch,
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(
      content: Text('Preparing report…'),
      duration: Duration(seconds: 30),
    ));
    try {
      final bytes = await fetch();
      if (!mounted) return;
      final fileName = '$name-${_fileStamp()}.xlsx';
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(bytes, flush: true);
      if (!mounted) return;
      messenger.clearSnackBars();
      await Share.shareXFiles([XFile(file.path)], subject: fileName);
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      // The report endpoints answer a scope violation with 403 and a 404 with
      // "No data." — downloadBytes only carries the status code, so say plainly
      // what each means instead of surfacing "Download failed (HTTP 403)".
      String msg;
      if (e is ApiException && e.statusCode == 403) {
        msg = 'This report is outside your oversight scope.';
      } else if (e is ApiException && e.statusCode == 404) {
        msg = 'No goal data to report for this selection yet.';
      } else {
        msg = friendlyErrorMessage(e, fallback: 'Could not download the report.');
      }
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.error,
        content: Text(msg, style: const TextStyle(color: Colors.white)),
      ));
    }
  }

  String _safe(String s) => s.trim().replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-');

  String _fileStamp() {
    final n = DateTime.now();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${n.year}${two(n.month)}${two(n.day)}-${two(n.hour)}${two(n.minute)}';
  }

  /// "View clubs" on a district row — every club of that district, read-only.
  /// Categories come from the screen's own list so the sheet doesn't refetch
  /// them, and are passed whole: the sheet has its own category tabs, exactly
  /// like web's panel.
  void _openClubMatrix(int districtId, String districtNumber) {
    final yr = _yearId;
    if (yr == null) return;
    showGoalClubMatrixSheet(
      context,
      districtId: districtId,
      districtNumber: districtNumber,
      yearId: yr,
      categories: _categories,
    );
  }

  /// Tapping a district row — that district's month-wise collection across
  /// every category, read-only.
  void _openMonthWise(int districtId, String districtNumber) {
    final yr = _yearId;
    if (yr == null) return;
    showGoalMonthWiseSheet(
      context,
      districtId: districtId,
      districtNumber: districtNumber,
      yearId: yr,
      categories: _categories,
    );
  }

  // ── bulk lock ────────────────────────────────────────────────────────────

  Future<void> _bulkLock(bool locked) async {
    final yr = _yearId;
    if (yr == null || _bulkLocking) return;
    setState(() {
      _bulkLocking = true;
      _bulkResult = null;
    });
    try {
      final res = await _api.bulkLock(yearId: yr, locked: locked);
      if (!mounted) return;
      setState(() {
        _bulkLocking = false;
        _bulkResult =
            '${locked ? 'Locked' : 'Unlocked'} ${res.affectedCount} district × category record(s).';
      });
      _loadDistricts();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bulkLocking = false;
        _bulkResult = friendlyErrorMessage(e, fallback: 'Bulk lock failed.');
      });
    }
  }

  // ── build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Goal Setting'),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_bootError != null) {
      return ErrorStateWidget(message: _bootError!, onRetry: _boot);
    }
    // Self-gate: no oversight assignment → no access (mirrors web).
    if (_assignments.isEmpty) {
      return _noAccess();
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _boot,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          _headerCard(),
          if (_myRoles().length > 1) ...[
            const SizedBox(height: 12),
            _roleSwitcher(),
          ],
          const SizedBox(height: 14),
          _filterCard(),
          const SizedBox(height: 14),

          if (_canBulkLock) ...[
            _bulkLockCard(),
            const SizedBox(height: 14),
          ],

          _goalsSection(),
          const SizedBox(height: 18),

          _matrixSection(),
          const SizedBox(height: 18),

          const SizedBox(height: 14),
          // An RI Director reads a box per ZC/DA in the zone; a ZC/DA has the
          // single private thread with their RI Director, so name it for them.
          GoalMessagesButton(
            hasUnread: _hasUnreadMessages,
            label: _roleLabel() == 'RI Director'
                ? 'Messages: Zone Co-ordinators & District Assistants'
                : 'Messages: your RI Director',
            onTap: (_zoneId == null || _yearId == null) ? null : _openMessages,
          ),
        ],
      ),
    );
  }

  /// Acting-as switcher — only for someone holding more than one goal role.
  /// Web gives each role its own dashboard entry (`?as=`); on mobile they're
  /// chips on the one screen, which does the same job without a second route.
  Widget _roleSwitcher() {
    final roles = _myRoles();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'VIEWING AS',
            style: AppTextStyles.caption.copyWith(
              color: AppColors.slate500,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _roleChip('All roles', _actingRoleType == null, null),
              for (final r in roles)
                _roleChip(r.label, _actingRoleType == r.type, r.type),
            ],
          ),
        ],
      ),
    );
  }

  Widget _roleChip(String label, bool selected, String? type) {
    return Material(
      color: selected ? AppColors.primary : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: () => _onActingRole(type),
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
                color: selected ? AppColors.primary : AppColors.border),
          ),
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : AppColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }

  /// Switching role changes the whole scope — which zones exist, which
  /// categories, even which matrix renders — so every lower selection is reset
  /// and the district list refetched. Keeping the old zone would leave the
  /// screen showing a zone the new role may not oversee.
  void _onActingRole(String? type) {
    if (type == _actingRoleType) return;
    setState(() {
      _actingRoleType = type;
      _zoneId = null;
      _districtId = null;
      _clubId = null;
      _clubs = const [];
      _form = null;
      _formError = null;
      _matrix = null;
      _matrixError = null;
      _hasUnreadMessages = false;
      _bulkResult = null;
      _formCategoryId = _categories.isNotEmpty ? _categories.first.id : null;
    });
    _loadDistricts();
  }

  // ── header ───────────────────────────────────────────────────────────────

  Widget _headerCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.infoLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.flag_rounded, color: AppColors.info, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Goal Setting Oversight',
                    style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(
                  '${_roleLabel()} · read-only goals for your zones & districts',
                  style: AppFonts.body(
                      fontSize: 12, color: AppColors.slate500),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Zone → District → Club → Year pickers + report downloads ─────────────

  Widget _filterCard() {
    final zones = _zonesInScope();
    final districts = _visibleDistricts();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Goal Setting: read-only view',
              style: AppFonts.body(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 3),
          Text(
            'Pick a district or club to see its Membership / TRF / Youth Service / '
            'Public Image goals. Changing the year keeps your selection and just '
            'refreshes the figures below.',
            style: AppFonts.body(
                fontSize: 11.5, height: 1.35, color: AppColors.slate500),
          ),
          const SizedBox(height: 12),

          _PickerRow<int>(
            icon: Icons.public_rounded,
            label: 'Zone',
            value: _zoneId,
            hint: _loadingDistricts ? 'Loading…' : 'Select zone',
            items: [for (final z in zones) (value: z.id, label: z.name)],
            onChanged: _onZone,
          ),
          const SizedBox(height: 8),
          _PickerRow<int>(
            icon: Icons.map_outlined,
            label: 'District',
            value: _districtId,
            hint: _zoneId == null
                ? 'Pick a zone first'
                : (districts.isEmpty ? 'No districts' : 'Select district'),
            items: [
              for (final d in districts) (value: d.districtId, label: d.districtNumber)
            ],
            onChanged: _zoneId == null ? null : _onDistrict,
          ),
          const SizedBox(height: 8),
          _PickerRow<int>(
            icon: Icons.groups_rounded,
            label: 'Club',
            value: _clubId,
            hint: _loadingClubs ? 'Loading…' : 'Whole district (not a club)',
            items: [for (final c in _clubs) (value: c.clubId, label: c.clubName)],
            // Selecting the hint clears back to the whole district.
            allowClear: true,
            onChanged: _districtId == null ? null : _onClub,
          ),
          const SizedBox(height: 8),
          _PickerRow<int>(
            icon: Icons.calendar_today_rounded,
            label: 'Year',
            value: _yearId,
            hint: 'Select year',
            items: [
              for (final y in _years)
                (value: y.id, label: '${y.yearLabel}${y.isCurrent ? " (current)" : ""}')
            ],
            onChanged: _onYear,
          ),

          const SizedBox(height: 14),
          Text('DOWNLOAD REPORT',
              style: AppTextStyles.caption.copyWith(
                color: AppColors.slate500,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.4,
              )),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _DownloadButton(
                  label: 'Zone',
                  enabled: _zoneId != null && _downloading == null,
                  busy: _downloading == _ReportLevel.zone,
                  onTap: () => _downloadReport(_ReportLevel.zone),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _DownloadButton(
                  label: 'District',
                  enabled: _districtId != null && _downloading == null,
                  busy: _downloading == _ReportLevel.district,
                  onTap: () => _downloadReport(_ReportLevel.district),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _DownloadButton(
                  label: 'Club',
                  enabled: _clubId != null && _downloading == null,
                  busy: _downloading == _ReportLevel.club,
                  onTap: () => _downloadReport(_ReportLevel.club),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text('Excel: YTD + Month-wise sheets',
              style: AppFonts.body(
                  fontSize: 10.5, color: AppColors.slate400)),
        ],
      ),
    );
  }

  // ── the read-only goal form ──────────────────────────────────────────────

  Widget _goalsSection() {
    if (_districtId == null) {
      return _infoCard('Select a zone and district above to view its goals (read only).');
    }

    final form = _form;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _clubId != null ? 'Club Goals (read only)' : 'District Goals (read only)',
                  style: AppFonts.body(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary),
                ),
                if (form != null) ...[
                  const SizedBox(height: 2),
                  Text('${form.entityName} · RY ${form.yearLabel}',
                      style: AppFonts.body(
                          fontSize: 11.5, color: AppColors.slate500)),
                ],
              ],
            ),
          ),

          // Category tabs — every category, exactly as web.
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final c in _categories) ...[
                    GoalCategoryPill(
                      label: c.name,
                      active: c.id == _formCategoryId,
                      onTap: _loadingForm ? null : () => _onFormCategory(c.id),
                    ),
                    const SizedBox(width: 8),
                  ],
                ],
              ),
            ),
          ),

          if (_loadingForm)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_formError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
              child: Text(_formError!,
                  style: AppFonts.body(
                      fontSize: 12.5, color: AppColors.error)),
            )
          else if (form != null)
            Container(
              width: double.infinity,
              color: AppColors.slate50,
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _readOnlyChip(form),
                  for (final g in groupGoalFields(form))
                    GoalGroupCard(
                      groupName: g.key,
                      fields: g.value,
                      buffers: _buffers,
                      reloadTick: _reload,
                      enabled: false, // oversight is always read-only
                    ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text('${form.fields.length} fields',
                        style: AppFonts.body(
                            fontSize: 11, color: AppColors.slate400)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// The "Read only" / "Locked by …" status chip the web shows in the panel head.
  Widget _readOnlyChip(GoalCategoryForm form) {
    final locked = form.isLocked;
    final text = locked
        ? 'Locked${form.lockedByName != null ? " by ${form.lockedByName}" : ""}'
            '${form.lockedDate != null ? " · ${form.lockedDate}" : ""}'
        : 'Read only';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          const Icon(Icons.lock_outline_rounded, size: 14, color: AppColors.slate500),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: AppFonts.body(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.slate700)),
          ),
        ],
      ),
    );
  }

  // ── matrix + messages ────────────────────────────────────────────────────

  Widget _matrixSection() {
    if (_loadingDistricts || _loadingMatrix) {
      return _centeredLoader();
    }
    if (_matrixError != null) {
      return _infoCard(_matrixError!);
    }
    if (_zoneId == null) {
      return _infoCard('Select a zone to view its districts.');
    }
    final m = _matrix;
    if (m == null) {
      return _infoCard('No districts to show for this zone / year.');
    }
    // The District picker doubles as web's matrix District filter: picking one
    // narrows the table to that row and drops the TOTAL row.
    return GoalDistrictMatrixTable(
      matrix: m,
      districtFilterId: _districtId,
      onDownloadDistrict:
          _downloadingDistrictId == null ? _downloadDistrictSetting : null,
      onViewClubs: _yearId == null ? null : _openClubMatrix,
      onOpenMonthWise: _yearId == null ? null : _openMonthWise,
    );
  }

  /// The category the messages panel is keyed by.
  ///
  Future<void> _refreshUnread() async {
    final zone = _zoneId;
    final yr = _yearId;
    if (zone == null || yr == null) {
      if (_hasUnreadMessages) setState(() => _hasUnreadMessages = false);
      return;
    }
    final unread = await _api.hasUnreadZoneMessages(zone, yr);
    if (!mounted) return;
    setState(() => _hasUnreadMessages = unread);
  }

  /// Categories the messages popup shows a tab for: the ones the caller
  /// actually oversees. The matrix already carries exactly that set (RI
  /// Director = all four, a ZC/DA = their one), so prefer it and fall back to
  /// the assignment-derived list before the matrix has loaded.
  ///
  /// ⚠️ This is what keeps a ZC/DA pinned to their OWN category. They hold one
  /// category and one conversation in it; offering them another category's tab
  /// would blank their only thread, because the server answers
  /// `viewerRole: None` for a category they hold no role in. Never widen this
  /// to "all categories".
  List<({int id, String name})> _messageCategories() {
    final fromMatrix = _matrix?.categories ?? const [];
    if (fromMatrix.isNotEmpty) {
      return [for (final c in fromMatrix) (id: c.categoryId, name: c.name)];
    }
    final mine = _myCategories();
    return [for (final c in mine) (id: c.id, name: c.name)];
  }

  Future<void> _openMessages() async {
    final zone = _zoneId;
    final yr = _yearId;
    if (zone == null || yr == null) return;

    // Opening IS reading, as on web — clear the dot straight away rather than
    // making the reader hunt for whichever thread was new.
    setState(() => _hasUnreadMessages = false);
    _api.markZoneMessagesSeen(zone, yr);

    String zoneName = '';
    for (final z in _zonesInScope()) {
      if (z.id == zone) zoneName = z.name;
    }

    final role = _roleLabel();
    await showGoalMessagesSheet(
      context,
      zoneId: zone,
      yearId: yr,
      zoneName: zoneName,
      categories: _messageCategories(),
      // An RI Director reads everyone's threads (roster + filters + report); a
      // ZC/DA writes in their own single thread. Web splits this the same way,
      // across two separate matrix components.
      isDirector: role == 'RI Director' || role == 'Super Admin',
      districts: [
        for (final d in _visibleDistricts())
          (id: d.districtId, number: d.districtNumber),
      ],
    );
    // Something may have arrived while it was open.
    if (mounted) _refreshUnread();
  }

  // ── pieces ───────────────────────────────────────────────────────────────

  Widget _bulkLockCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.lock_outline, size: 16, color: AppColors.slate700),
              const SizedBox(width: 6),
              Expanded(
                child: Text('Bulk Lock: all your zones, all categories',
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _bulkLocking ? null : () => _bulkLock(true),
                  icon: const Icon(Icons.lock, size: 16),
                  label: const Text('Lock All'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.warning,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _bulkLocking ? null : () => _bulkLock(false),
                  icon: const Icon(Icons.lock_open, size: 16),
                  label: const Text('Unlock All'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.slate700,
                    side: const BorderSide(color: AppColors.slate200),
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
            ],
          ),
          if (_bulkLocking) ...[
            const SizedBox(height: 10),
            const Center(
              child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2)),
            ),
          ],
          if (_bulkResult != null) ...[
            const SizedBox(height: 8),
            Text(_bulkResult!,
                style: AppFonts.body(
                    fontSize: 11.5,
                    color: AppColors.success,
                    fontWeight: FontWeight.w600)),
          ],
        ],
      ),
    );
  }

  Widget _noAccess() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.flag_outlined, size: 44, color: AppColors.slate400),
            const SizedBox(height: 12),
            Text('No Goal Setting oversight access',
                textAlign: TextAlign.center,
                style: AppFonts.body(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const SizedBox(height: 6),
            Text(
              'Contact Super Admin if you believe this is incorrect.',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                  fontSize: 12.5, color: AppColors.slate500),
            ),
          ],
        ),
      ),
    );
  }

  Widget _centeredLoader() => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 26),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.slate200),
        ),
        child: const Center(
            child: const CircularProgressIndicator(color: AppColors.primary)),
      );

  Widget _infoCard(String text) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.slate200),
        ),
        child: Text(text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
                fontSize: 12.5, color: AppColors.slate400)),
      );
}

/// One compact picker row — icon + label on the left, a borderless dropdown on
/// the right. Same bar look as the app-wide Rotary Year selector, so four of
/// them stack cleanly on a phone where the web's four side-by-side selects
/// would not fit.
class _PickerRow<T> extends StatelessWidget {
  final IconData icon;
  final String label;
  final T? value;
  final String hint;
  final List<({T value, String label})> items;
  final ValueChanged<T?>? onChanged;

  /// When true the hint stays selectable, so picking it clears the value
  /// (the Club picker's "Whole district").
  final bool allowClear;

  const _PickerRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
    required this.items,
    required this.onChanged,
    this.allowClear = false,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = onChanged == null || (items.isEmpty && !allowClear);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: disabled ? AppColors.slate50 : AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Align(
              alignment: Alignment.centerRight,
              child: DropdownButton<T?>(
                value: value,
                isDense: true,
                isExpanded: false,
                underline: const SizedBox.shrink(),
                borderRadius: BorderRadius.circular(12),
                hint: Text(
                  hint,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                      fontSize: 12.5, color: AppColors.slate400),
                ),
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
                selectedItemBuilder: (_) => [
                  if (allowClear)
                    _rightAlignedText(hint, muted: true),
                  for (final i in items) _rightAlignedText(i.label),
                ],
                onChanged: disabled ? null : onChanged,
                items: [
                  if (allowClear)
                    DropdownMenuItem<T?>(
                      value: null,
                      child: Text(hint,
                          style: AppFonts.body(
                              fontSize: 13, color: AppColors.slate500)),
                    ),
                  for (final i in items)
                    DropdownMenuItem<T?>(
                      value: i.value,
                      child: Text(i.label, overflow: TextOverflow.ellipsis),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _rightAlignedText(String text, {bool muted = false}) => Container(
        constraints: const BoxConstraints(maxWidth: 190),
        alignment: Alignment.centerRight,
        child: Text(
          text,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.right,
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: muted ? AppColors.slate400 : AppColors.textPrimary,
          ),
        ),
      );
}

/// One of the three drill-down report buttons (Zone / District / Club).
class _DownloadButton extends StatelessWidget {
  final String label;
  final bool enabled;
  final bool busy;
  final VoidCallback onTap;

  const _DownloadButton({
    required this.label,
    required this.enabled,
    required this.busy,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: enabled ? onTap : null,
      icon: busy
          ? const SizedBox(
              width: 13, height: 13, child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.download_rounded, size: 15),
      label: Text(label, overflow: TextOverflow.ellipsis),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.info,
        backgroundColor: enabled ? AppColors.infoLight : AppColors.slate50,
        side: BorderSide(color: enabled ? AppColors.info : AppColors.slate200),
        padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: AppFonts.body(
            fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}
