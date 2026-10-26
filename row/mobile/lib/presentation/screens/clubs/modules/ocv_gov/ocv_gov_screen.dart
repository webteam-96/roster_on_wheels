import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/file_download_utils.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
final _dateFmt = DateFormat('dd MMM yyyy');

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

String _fmtDate(String? iso) {
  if (iso == null || iso.isEmpty) return '–';
  final dt = DateTime.tryParse(iso);
  if (dt == null || dt.year <= 1) return '–'; // `0001-01-01` zero date => no value
  return _dateFmt.format(dt.toLocal());
}

String _fmtAmount(num? amt) {
  if (amt == null) return '-';
  return formatMoney(amt, null);
}

String _fmtFileSize(int? bytes) {
  if (bytes == null || bytes == 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  double size = bytes.toDouble();
  int unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return '${size.toStringAsFixed(unitIndex == 0 ? 0 : 1)} ${units[unitIndex]}';
}

String _buildDocTypeLabel(_OcvDocument d) {
  final type = d.typeName ?? '';
  final custom = d.customTypeName ?? '';
  if (custom.isNotEmpty) return '$type - $custom';
  return type.isNotEmpty ? type : '(unnamed)';
}

/// Picks an icon + accent tint for an OCV/GOV section so the landing list reads
/// like the club dashboard's grouped rows. Keyed on the category code first,
/// then falls back to a loose name match.
({IconData icon, Color color}) _sectionVisual(String code, String name) {
  final k = '$code $name'.toLowerCase();
  if (k.contains('newsletter')) {
    return (icon: Icons.mark_email_unread_outlined, color: AppColors.accentBlue);
  }
  if (k.contains('live')) {
    return (icon: Icons.dynamic_feed_outlined, color: AppColors.accentBlue);
  }
  if (k.contains('financial') || k.contains('finance')) {
    return (icon: Icons.account_balance_wallet_outlined, color: AppColors.success);
  }
  if (k.contains('trust')) {
    return (icon: Icons.verified_user_outlined, color: AppColors.accentBlue);
  }
  if (k.contains('grant')) {
    return (icon: Icons.volunteer_activism_outlined, color: AppColors.warningDark);
  }
  if (k.contains('dues')) {
    return (icon: Icons.payments_outlined, color: AppColors.error);
  }
  if (k.contains('additional')) {
    return (icon: Icons.folder_copy_outlined, color: AppColors.warningDark);
  }
  if (k.contains('static')) {
    return (icon: Icons.description_outlined, color: AppColors.accentBlue);
  }
  return (icon: Icons.folder_outlined, color: AppColors.primaryPrime);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
class _Category {
  final int id;
  final String categoryName;
  final String categoryCode;
  final String? iconClass;
  final int sortOrder;

  const _Category({
    required this.id,
    required this.categoryName,
    required this.categoryCode,
    this.iconClass,
    this.sortOrder = 0,
  });

  factory _Category.fromJson(Map<String, dynamic> j) => _Category(
        id: (j['id'] as int?) ?? 0,
        categoryName: j['categoryName']?.toString() ?? '',
        categoryCode: j['categoryCode']?.toString() ?? '',
        iconClass: j['iconClass']?.toString(),
        sortOrder: (j['sortOrder'] as int?) ?? 0,
      );
}

class _DocType {
  final int id;
  final String typeName;
  final int categoryId;
  final bool isCustom;
  final bool allowMultiple;
  final bool isActive;
  final int sortOrder;

  const _DocType({
    required this.id,
    required this.typeName,
    required this.categoryId,
    this.isCustom = false,
    this.allowMultiple = false,
    this.isActive = true,
    this.sortOrder = 0,
  });

  factory _DocType.fromJson(Map<String, dynamic> j) => _DocType(
        id: (j['id'] as int?) ?? 0,
        typeName: j['typeName']?.toString() ?? '',
        categoryId: (j['categoryId'] as int?) ?? 0,
        isCustom: _asBool(j['isCustom']),
        allowMultiple: _asBool(j['allowMultiple']),
        isActive: _asBool(j['isActive'] ?? true),
        sortOrder: (j['sortOrder'] as int?) ?? 0,
      );
}

class _OcvDocument {
  final int id;
  final int typeId;
  final String? typeName;
  final String? customTypeName;
  final String? fileName;
  final String? originalFileName;
  final String? filePath;
  final int? fileSize;
  final num? amount;
  final String? paidOn;
  final int? yearId;
  final String? createdDate;

  const _OcvDocument({
    required this.id,
    required this.typeId,
    this.typeName,
    this.customTypeName,
    this.fileName,
    this.originalFileName,
    this.filePath,
    this.fileSize,
    this.amount,
    this.paidOn,
    this.yearId,
    this.createdDate,
  });

  factory _OcvDocument.fromJson(Map<String, dynamic> j) => _OcvDocument(
        id: (j['id'] as int?) ?? 0,
        typeId: (j['typeId'] as int?) ?? 0,
        typeName: j['typeName']?.toString(),
        customTypeName: j['customTypeName']?.toString(),
        fileName: j['fileName']?.toString(),
        originalFileName: j['originalFileName']?.toString(),
        filePath: j['filePath']?.toString(),
        fileSize: (j['fileSize'] as num?)?.toInt(),
        amount: j['amount'] is num ? j['amount'] as num : num.tryParse(j['amount']?.toString() ?? ''),
        paidOn: j['paidOn']?.toString(),
        yearId: (j['yearId'] as int?),
        createdDate: (j['createdDate'] ?? j['uploadedDate'])?.toString(),
      );
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear(
      {required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel:
            j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

// ---------------------------------------------------------------------------
// Landing screen — a single scannable list of OCV/GOV sections.
//
// Mirrors the club dashboard "List View": a white rounded card whose rows each
// carry a tinted circular icon, a label and a chevron. Tapping a row opens a
// dedicated page for that section (Newsletters / Live Documents route to their
// existing screens; every backend category opens `_OcvGovCategoryScreen`).
// ---------------------------------------------------------------------------
class OcvGovScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;

  /// When true, forces read-only rendering regardless of the user's admin
  /// role. Set by the unified flow when the user isn't admin of this club.
  final bool viewOnly;
  const OcvGovScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<OcvGovScreen> createState() => _OcvGovScreenState();
}

class _OcvGovScreenState extends State<OcvGovScreen> {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;

  List<_Category> _categories = [];
  List<_RotaryYear> _years = [];
  int? _currentYearId;

  String get _base => '/api/clubs/${widget.clubId}/ocv-gov';

  String get _currentYearLabel {
    for (final y in _years) {
      if (y.id == _currentYearId) return y.yearLabel;
    }
    return '';
  }

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        _fetchCategories(),
        _fetchYears(),
      ]);
      final cats = results[0] as List<_Category>;
      final years = results[1] as List<_RotaryYear>;

      _RotaryYear? current;
      for (final y in years) {
        if (y.isCurrent) {
          current = y;
          break;
        }
      }
      current ??= years.isNotEmpty ? years.first : null;

      setState(() {
        _categories = cats;
        _years = years;
        _currentYearId = current?.id;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<List<_Category>> _fetchCategories() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/categories',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _Category.fromJson(e as Map<String, dynamic>))
          .toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      return list;
    } on ApiException catch (e) {
      if (e.statusCode == 404) return const [];
      rethrow;
    }
  }

  Future<List<_RotaryYear>> _fetchYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/monthly-reports/years',
        fromJson: (j) => j as List<dynamic>,
      );
      return (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  void _openCategory(_Category cat) {
    final canManage =
        !widget.viewOnly && context.read<AuthProvider>().isClubAdminOf(widget.clubId);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _OcvGovCategoryScreen(
          clubId: widget.clubId,
          categoryId: cat.id,
          categoryName: cat.categoryName,
          categoryCode: cat.categoryCode,
          years: _years,
          initialYearId: _currentYearId,
          canManage: canManage,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Live Documents is an admin-only consolidated export — hide it for members.
    final showLiveDocs = !widget.viewOnly &&
        context.watch<AuthProvider>().isClubAdminOf(widget.clubId);

    final content = _loading
        ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
        : _error != null
            ? ErrorStateWidget(message: _error!, onRetry: _bootstrap)
            : _buildList(showLiveDocs);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : const CustomAppBar(title: 'OCV / GOV'),
      body: content,
    );
  }

  Widget _buildList(bool showLiveDocs) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _bootstrap,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _buildHero(),
          const SizedBox(height: 18),
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 10),
            child: Text(
              'CATEGORIES',
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: AppColors.primaryPrime,
                letterSpacing: 1.4,
              ),
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.divider),
            ),
            child: Column(
              children: _buildRows(showLiveDocs),
            ),
          ),
          if (_categories.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 28),
              child: Text(
                'No OCV/GOV categories are configured for this club.',
                textAlign: TextAlign.center,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary),
              ),
            ),
        ],
      ),
    );
  }

  /// "Document compliance hub" hero banner mirroring the web OCV/GOV header:
  /// RY label, title, descriptive blurb and the white "Generate OCV Report"
  /// action button (replaces the old app-bar icon).
  Widget _buildHero() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      decoration: BoxDecoration(
        color: AppColors.primaryLight.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeroYearSelector(),
          const SizedBox(height: 8),
          Text(
            'Document compliance hub',
            style: AppFonts.body(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Upload, review and generate documents required for the Official '
            'Club Visit and Governor\'s Official Visit. Use the categories '
            'below or jump straight to the compliance report.',
            style: AppFonts.body(
              fontSize: 12.5,
              height: 1.4,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 14),
          _buildGenerateReportButton(),
        ],
      ),
    );
  }

  /// Inline Rotary-Year selector inside the hero. The picked year drives both
  /// the "Generate OCV Report" action and seeds each category page's year.
  Widget _buildHeroYearSelector() {
    final label = _currentYearLabel;
    if (_years.isEmpty) {
      return label.isEmpty
          ? const SizedBox.shrink()
          : Text(
              'RY $label',
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textMuted,
                letterSpacing: 0.5,
              ),
            );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.white.withValues(alpha: 0.75),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.primaryPrime.withValues(alpha: 0.25)),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          value: _currentYearId,
          isDense: true,
          borderRadius: BorderRadius.circular(12),
          dropdownColor: AppColors.surface,
          icon: const Icon(Icons.keyboard_arrow_down_rounded,
              size: 18, color: AppColors.primaryPrime),
          selectedItemBuilder: (_) => _years
              .map((y) => Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'RY ${y.yearLabel}',
                      style: AppFonts.body(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primaryPrime,
                        letterSpacing: 0.3,
                      ),
                    ),
                  ))
              .toList(),
          items: _years
              .map((y) => DropdownMenuItem(
                    value: y.id,
                    child: Text(
                      'RY ${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                      style: AppFonts.body(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ))
              .toList(),
          onChanged: (v) {
            if (v == null) return;
            setState(() => _currentYearId = v);
          },
        ),
      ),
    );
  }

  void _openReport() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _OcvReportScreen(
          clubId: widget.clubId,
          years: _years,
          initialYearId: _currentYearId,
        ),
      ),
    );
  }

  /// White "Generate OCV Report" button sitting inside the hero (blue content
  /// on a white surface, matching the web header action). Opens the full
  /// document-compliance report page for the year picked in the hero selector.
  Widget _buildGenerateReportButton() {
    return Align(
      alignment: Alignment.centerLeft,
      child: ElevatedButton.icon(
        onPressed: _openReport,
        icon: const Icon(Icons.bar_chart_rounded, size: 18),
        label: Text(
          'Generate OCV Report',
          style: AppFonts.body(
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.white,
          foregroundColor: AppColors.primaryPrime,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(color: AppColors.primaryPrime.withValues(alpha: 0.35)),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildRows(bool showLiveDocs) {
    final rows = <Widget>[];

    void add(Widget row) {
      if (rows.isNotEmpty) {
        rows.add(const Divider(height: 1, indent: 60, color: AppColors.divider));
      }
      rows.add(row);
    }

    // Newsletters — its own dedicated screen.
    add(_OcvListRow(
      label: 'Newsletters',
      subtitle: 'Club e-bulletins & circulars',
      visual: _sectionVisual('newsletters', 'Newsletters'),
      onTap: () => context.push('/clubs/${widget.clubId}/newsletters'),
    ));

    // Live Documents — admin-only consolidated export.
    if (showLiveDocs) {
      add(_OcvListRow(
        label: 'Live Documents',
        subtitle: 'Consolidated live export',
        visual: _sectionVisual('live', 'Live Documents'),
        onTap: () {
          final yid = _currentYearId;
          final qs = yid == null ? '' : '?yearId=$yid';
          context.push('/clubs/${widget.clubId}/ocv-gov/live-documents$qs');
        },
      ));
    }

    // Backend categories — Static / Financial / Trust / Grants / Additional / Dues.
    for (final c in _categories) {
      add(_OcvListRow(
        label: c.categoryName,
        subtitle: 'View & manage documents',
        visual: _sectionVisual(c.categoryCode, c.categoryName),
        onTap: () => _openCategory(c),
      ));
    }

    return rows;
  }
}

// ---------------------------------------------------------------------------
// A single landing-list row (icon + label + chevron) — mirrors the club
// dashboard List View row.
// ---------------------------------------------------------------------------
class _OcvListRow extends StatelessWidget {
  final String label;
  final String subtitle;
  final ({IconData icon, Color color}) visual;
  final VoidCallback onTap;
  const _OcvListRow({
    required this.label,
    required this.subtitle,
    required this.visual,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: visual.color.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(visual.icon, color: visual.color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: AppFonts.body(
                        fontSize: 11.5,
                        color: AppColors.textMuted,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded,
                  color: AppColors.textMuted, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Category detail screen — one OCV/GOV section's document types + documents.
//
// Holds everything the old per-tab view did: the Rotary-Year picker, the
// document-type tiles (auto-expanded), inline documents, and the admin
// affordances (Add Custom Type, Upload, Edit, Delete, Delete Type).
// ---------------------------------------------------------------------------
class _OcvGovCategoryScreen extends StatefulWidget {
  final int clubId;
  final int categoryId;
  final String categoryName;
  final String categoryCode;
  final List<_RotaryYear> years;
  final int? initialYearId;
  final bool canManage;

  const _OcvGovCategoryScreen({
    required this.clubId,
    required this.categoryId,
    required this.categoryName,
    required this.categoryCode,
    required this.years,
    required this.initialYearId,
    required this.canManage,
  });

  @override
  State<_OcvGovCategoryScreen> createState() => __OcvGovCategoryScreenState();
}

class __OcvGovCategoryScreenState extends State<_OcvGovCategoryScreen> {
  final _api = ApiClient();

  int? _selectedYearId;

  List<_DocType>? _types;
  bool _typesLoading = false;

  List<_OcvDocument> _allDocs = [];
  bool _docsLoading = false;

  // Inline upload-form state.
  int? _uploadTypeId;
  final _uploadCustomCtrl = TextEditingController();
  final _uploadAmountCtrl = TextEditingController();
  DateTime? _uploadPaidOn;
  String? _uploadFilePath;
  String? _uploadFileName;
  bool _uploading = false;

  final _filterCtrl = TextEditingController();
  String _filterQuery = '';

  String get _base => '/api/clubs/${widget.clubId}/ocv-gov';
  bool get _isDues => widget.categoryCode == 'dues';

  @override
  void initState() {
    super.initState();
    _selectedYearId = widget.initialYearId;
    _bootstrap();
  }

  @override
  void dispose() {
    _uploadCustomCtrl.dispose();
    _uploadAmountCtrl.dispose();
    _filterCtrl.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    await _loadTypes(force: true);
    await _loadDocs(force: true);
  }

  Future<void> _loadTypes({bool force = false}) async {
    if (!force && _types != null) return;
    setState(() => _typesLoading = true);
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/document-types/${widget.categoryId}',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _DocType.fromJson(e as Map<String, dynamic>))
          .toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() {
        _types = list;
        _typesLoading = false;
        // Default the upload dropdown to the first active type.
        _uploadTypeId ??= list
            .where((t) => t.isActive)
            .map((t) => t.id)
            .cast<int?>()
            .firstWhere((_) => true, orElse: () => null);
      });
    } on ApiException catch (e) {
      setState(() {
        _types = const [];
        _typesLoading = false;
      });
      if (e.statusCode != 404 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load types: ${e.message}')),
        );
      }
    } catch (_) {
      setState(() {
        _types = const [];
        _typesLoading = false;
      });
    }
  }

  Future<void> _loadDocs({bool force = false}) async {
    if (_selectedYearId == null) {
      setState(() {
        _allDocs = const [];
        _docsLoading = false;
      });
      return;
    }
    setState(() => _docsLoading = true);
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/documents/${widget.categoryId}',
        queryParams: {'yearId': _selectedYearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _OcvDocument.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _allDocs = list;
        _docsLoading = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _allDocs = const [];
        _docsLoading = false;
      });
      if (e.statusCode != 404 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load documents: ${e.message}')),
        );
      }
    } catch (_) {
      setState(() {
        _allDocs = const [];
        _docsLoading = false;
      });
    }
  }

  void _onYearChanged(int? v) {
    if (v == null || v == _selectedYearId) return;
    setState(() => _selectedYearId = v);
    _loadDocs(force: true);
  }

  List<_OcvDocument> get _filteredDocs {
    final q = _filterQuery.trim().toLowerCase();
    if (q.isEmpty) return _allDocs;
    return _allDocs.where((d) {
      final type = _buildDocTypeLabel(d).toLowerCase();
      final file = (d.originalFileName ?? d.fileName ?? '').toLowerCase();
      return type.contains(q) || file.contains(q);
    }).toList();
  }

  int get _typesCovered {
    final present = <int>{};
    for (final d in _allDocs) {
      present.add(d.typeId);
    }
    final total = _types ?? const <_DocType>[];
    return total.where((t) => present.contains(t.id)).length;
  }

  // ── File picker / date ──────────────────────────────────────────────────
  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: [
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'gif'
      ],
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.first;
    if (f.path == null) return;
    setState(() {
      _uploadFilePath = f.path;
      _uploadFileName = f.name;
    });
  }

  Future<void> _pickPaidOn() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _uploadPaidOn ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() => _uploadPaidOn = picked);
  }

  // ── Upload (inline) ─────────────────────────────────────────────────────
  Future<void> _upload() async {
    if (_uploadTypeId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a document type')),
      );
      return;
    }
    if (_uploadFilePath == null || _uploadFilePath!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please choose a file')),
      );
      return;
    }
    final fields = <String, String>{
      'typeId': _uploadTypeId.toString(),
      'categoryId': widget.categoryId.toString(),
      if (_uploadCustomCtrl.text.trim().isNotEmpty)
        'customTypeName': _uploadCustomCtrl.text.trim(),
      if (_isDues && _uploadAmountCtrl.text.trim().isNotEmpty)
        'amount': _uploadAmountCtrl.text.trim(),
      if (_isDues && _uploadPaidOn != null)
        'paidOn':
            '${_uploadPaidOn!.year.toString().padLeft(4, '0')}-${_uploadPaidOn!.month.toString().padLeft(2, '0')}-${_uploadPaidOn!.day.toString().padLeft(2, '0')}',
      if (_selectedYearId != null) 'yearId': _selectedYearId.toString(),
    };
    setState(() => _uploading = true);
    try {
      await _api.sendMultipart(
        '$_base/documents',
        method: 'POST',
        fields: fields,
        files: {'file': _uploadFilePath!},
      );
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _uploadFilePath = null;
        _uploadFileName = null;
        _uploadCustomCtrl.clear();
        _uploadAmountCtrl.clear();
        _uploadPaidOn = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Document uploaded'),
          backgroundColor: AppColors.success,
        ),
      );
      await _loadDocs(force: true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Upload failed: $e')));
    }
  }

  // ── Edit / delete ───────────────────────────────────────────────────────
  Future<void> _openEdit(_OcvDocument doc) async {
    final types = _types ?? const <_DocType>[];
    if (types.isEmpty) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _DocumentFormScreen(
          clubId: widget.clubId,
          categoryId: widget.categoryId,
          categoryCode: widget.categoryCode,
          types: types,
          years: widget.years,
          initialYearId: doc.yearId ?? _selectedYearId,
          existing: doc,
        ),
      ),
    );
    if (saved == true) await _loadDocs(force: true);
  }

  Future<void> _deleteDocument(_OcvDocument doc) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Document'),
        content: Text('Delete "${doc.originalFileName ?? doc.fileName ?? 'this document'}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child:
                const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('$_base/documents/${doc.id}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Document deleted'),
          backgroundColor: AppColors.success,
        ),
      );
      await _loadDocs(force: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  // ── Build ───────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: widget.categoryName),
      body: (_types == null && _typesLoading)
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _bootstrap,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
                children: [
                  if (widget.years.isNotEmpty) ...[
                    _buildYearSelector(),
                    const SizedBox(height: 14),
                  ],
                  if (widget.canManage) ...[
                    _buildUploadCard(),
                    const SizedBox(height: 16),
                  ],
                  _buildDocumentsCard(),
                ],
              ),
            ),
    );
  }

  // ── Upload card ─────────────────────────────────────────────────────────
  Widget _buildUploadCard() {
    final types = (_types ?? const <_DocType>[]).where((t) => t.isActive).toList();
    final selected = types.firstWhere(
      (t) => t.id == _uploadTypeId,
      orElse: () => types.isNotEmpty
          ? types.first
          : const _DocType(id: 0, typeName: '', categoryId: 0),
    );
    final showCustom = selected.typeName.toLowerCase() == 'others';

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Upload a document',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Allowed file types: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF.',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 14),
          _fieldLabel('Document Type'),
          _typeDropdown(types),
          if (showCustom) ...[
            const SizedBox(height: 12),
            _fieldLabel('Document Name'),
            TextField(
              controller: _uploadCustomCtrl,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              decoration: _inputDecoration('Enter a custom document name'),
            ),
          ],
          if (_isDues) ...[
            const SizedBox(height: 12),
            _fieldLabel('Amount'),
            TextField(
              controller: _uploadAmountCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              decoration: _inputDecoration('0.00'),
            ),
            const SizedBox(height: 12),
            _fieldLabel('Paid On'),
            InkWell(
              onTap: _pickPaidOn,
              borderRadius: BorderRadius.circular(10),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  border: Border.all(color: AppColors.border),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.calendar_today,
                        size: 16, color: AppColors.textSecondary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _uploadPaidOn == null
                            ? 'Select date (optional)'
                            : _dateFmt.format(_uploadPaidOn!),
                        style: AppFonts.body(
                          fontSize: 13,
                          color: _uploadPaidOn == null
                              ? AppColors.textMuted
                              : AppColors.textPrimary,
                        ),
                      ),
                    ),
                    if (_uploadPaidOn != null)
                      InkWell(
                        onTap: () => setState(() => _uploadPaidOn = null),
                        child: const Icon(Icons.close, size: 16),
                      ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 12),
          _fieldLabel('Choose File'),
          OutlinedButton.icon(
            onPressed: _uploading ? null : _pickFile,
            icon: const Icon(Icons.attach_file_rounded, size: 18),
            label: Text(
              _uploadFileName ?? 'Choose file',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.textPrimary,
              side: const BorderSide(color: AppColors.border),
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _uploading ? null : _upload,
              icon: _uploading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.upload_rounded, size: 18),
              label: Text(_uploading ? 'Uploading…' : 'Upload'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                disabledBackgroundColor:
                    AppColors.primary.withValues(alpha: 0.6),
                disabledForegroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _fieldLabel(String text) => Padding(
        padding: const EdgeInsets.only(left: 2, bottom: 5),
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
            color: AppColors.textSecondary,
          ),
        ),
      );

  InputDecoration _inputDecoration(String hint) => InputDecoration(
        isDense: true,
        hintText: hint,
        hintStyle: AppFonts.body(
            fontSize: 13, color: AppColors.textMuted),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.primaryPrime),
        ),
      );

  Widget _typeDropdown(List<_DocType> types) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          value: _uploadTypeId,
          isExpanded: true,
          isDense: true,
          hint: Text('Select type…',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textMuted)),
          icon: const Icon(Icons.keyboard_arrow_down_rounded),
          borderRadius: BorderRadius.circular(12),
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
          items: types
              .map((t) => DropdownMenuItem(
                    value: t.id,
                    child: Text(t.typeName, overflow: TextOverflow.ellipsis),
                  ))
              .toList(),
          onChanged: (v) => setState(() => _uploadTypeId = v),
        ),
      ),
    );
  }

  // ── Documents list ──────────────────────────────────────────────────────
  Widget _buildDocumentsCard() {
    final total = _allDocs.length;
    final totalTypes = (_types ?? const <_DocType>[]).length;
    final docs = _filteredDocs;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Documents',
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$total record${total == 1 ? '' : 's'} · '
                  '$_typesCovered/$totalTypes types covered',
                  style: AppFonts.body(
                    fontSize: 11.5,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _filterCtrl,
                  onChanged: (v) => setState(() => _filterQuery = v),
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.textPrimary),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Filter documents…',
                    hintStyle: AppFonts.body(
                        fontSize: 13, color: AppColors.textMuted),
                    prefixIcon: const Icon(Icons.search_rounded, size: 18),
                    prefixIconConstraints:
                        const BoxConstraints(minWidth: 36, minHeight: 36),
                    filled: true,
                    fillColor: AppColors.surface,
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 10),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.primaryPrime),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (_docsLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 36),
              child: const Center(
                  child: const CircularProgressIndicator(color: AppColors.primary)),
            )
          else if (docs.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 28),
              child: Row(
                children: [
                  const Icon(Icons.info_outline,
                      size: 16, color: AppColors.textSecondary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _allDocs.isEmpty
                          ? 'No documents uploaded for selected year.'
                          : 'No documents match your filter.',
                      style: AppFonts.body(
                          fontSize: 12.5, color: AppColors.textSecondary),
                    ),
                  ),
                ],
              ),
            )
          else
            for (var i = 0; i < docs.length; i++) ...[
              const Divider(height: 1, color: AppColors.divider),
              _buildDocRow(docs[i]),
            ],
        ],
      ),
    );
  }

  Widget _buildDocRow(_OcvDocument d) {
    final fileName = d.originalFileName ?? d.fileName ?? '(unnamed)';
    final size = _fmtFileSize(d.fileSize);
    final uploaded = _fmtDateTime(d.createdDate);
    final hasFile = (d.filePath ?? '').isNotEmpty;

    final meta = <String>[
      if (size.isNotEmpty) size,
      if (_isDues && d.amount != null) _fmtAmount(d.amount),
      if (_isDues && d.paidOn != null) 'Paid ${_fmtDate(d.paidOn)}',
      if (uploaded.isNotEmpty) uploaded,
    ].join('  ·  ');

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 6, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Leading file-type icon chip.
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(_fileIcon(fileName),
                size: 20, color: AppColors.primaryPrime),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _buildDocTypeLabel(d),
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 11.5,
                    color: AppColors.textSecondary,
                  ),
                ),
                if (meta.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    meta,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 10.5,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (hasFile)
            IconButton(
              tooltip: 'View',
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.all(6),
              constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
              iconSize: 20,
              color: AppColors.primary,
              icon: const Icon(Icons.visibility_outlined),
              onPressed: () => downloadAndOpenServerFile(context,
                  filePath: d.filePath, fileName: fileName),
            ),
          if (hasFile || widget.canManage)
            PopupMenuButton<String>(
              tooltip: 'More',
              icon: const Icon(Icons.more_vert,
                  size: 20, color: AppColors.textMuted),
              padding: EdgeInsets.zero,
              onSelected: (v) {
                switch (v) {
                  case 'download':
                    shareServerFile(context,
                        filePath: d.filePath, fileName: fileName);
                    break;
                  case 'edit':
                    _openEdit(d);
                    break;
                  case 'delete':
                    _deleteDocument(d);
                    break;
                }
              },
              itemBuilder: (_) => [
                if (hasFile)
                  const PopupMenuItem(
                    value: 'download',
                    child: Row(children: [
                      Icon(Icons.download_rounded, size: 18),
                      SizedBox(width: 10),
                      Text('Download'),
                    ]),
                  ),
                if (widget.canManage)
                  const PopupMenuItem(
                    value: 'edit',
                    child: Row(children: [
                      Icon(Icons.edit_outlined, size: 18),
                      SizedBox(width: 10),
                      Text('Edit'),
                    ]),
                  ),
                if (widget.canManage)
                  const PopupMenuItem(
                    value: 'delete',
                    child: Row(children: [
                      Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                      SizedBox(width: 10),
                      Text('Delete', style: TextStyle(color: AppColors.error)),
                    ]),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  IconData _fileIcon(String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    if (ext == 'pdf') return Icons.picture_as_pdf_outlined;
    if (ext == 'doc' || ext == 'docx') return Icons.description_outlined;
    if (ext == 'xls' || ext == 'xlsx') return Icons.table_chart_outlined;
    if (ext == 'jpg' || ext == 'jpeg' || ext == 'png' || ext == 'gif') {
      return Icons.image_outlined;
    }
    return Icons.insert_drive_file_outlined;
  }

  String _fmtDateTime(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final dt = DateTime.tryParse(iso);
    if (dt == null || dt.year <= 1) return '';
    return DateFormat('dd MMM yyyy, hh:mm a').format(dt.toLocal());
  }

  // ── Year selector (compact pill) ─────────────────────────────────────────
  Widget _buildYearSelector() {
    // Sits inside a ListView already inset by 16 horizontally, so drop the
    // bar's own horizontal margin to avoid doubled padding. The ListView gives
    // it a bounded width, so the internal Spacer lays out correctly.
    return RotaryYearBar<int>(
      value: _selectedYearId,
      margin: EdgeInsets.zero,
      options: [
        for (final y in widget.years)
          RotaryYearOption(
            value: y.id,
            label: y.yearLabel,
            isCurrent: y.isCurrent,
          ),
      ],
      onChanged: _onYearChanged,
    );
  }
}

// ---------------------------------------------------------------------------
// Document upload/edit screen
// ---------------------------------------------------------------------------
class _DocumentFormScreen extends StatefulWidget {
  final int clubId;
  final int categoryId;
  final String categoryCode;
  final List<_DocType> types;
  final List<_RotaryYear> years;
  final int? initialYearId;
  final _OcvDocument? existing;

  const _DocumentFormScreen({
    required this.clubId,
    required this.categoryId,
    required this.categoryCode,
    required this.types,
    required this.years,
    required this.initialYearId,
    this.existing,
  });

  @override
  State<_DocumentFormScreen> createState() => _DocumentFormScreenState();
}

class _DocumentFormScreenState extends State<_DocumentFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _customNameCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();

  int? _typeId;
  int? _yearId;
  DateTime? _paidOn;
  String? _pickedFilePath;
  String? _pickedFileName;
  bool _saving = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _yearId = widget.initialYearId;
    _typeId = widget.existing?.typeId;
    if (_typeId != null && !widget.types.any((t) => t.id == _typeId)) {
      _typeId = widget.types.isNotEmpty ? widget.types.first.id : null;
    }
    final e = widget.existing;
    if (e != null) {
      _customNameCtrl.text = e.customTypeName ?? '';
      if (e.amount != null) _amountCtrl.text = e.amount.toString();
      if (e.paidOn != null) _paidOn = DateTime.tryParse(e.paidOn!);
      _pickedFileName = e.originalFileName ?? e.fileName;
    }
  }

  @override
  void dispose() {
    _customNameCtrl.dispose();
    _amountCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'gif'],
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.first;
    if (f.path == null) return;
    setState(() {
      _pickedFilePath = f.path;
      _pickedFileName = f.name;
    });
  }

  Future<void> _pickPaidOn() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _paidOn ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() => _paidOn = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_typeId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a document type')),
      );
      return;
    }
    if (!_isEdit && (_pickedFilePath == null || _pickedFilePath!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please pick a file')),
      );
      return;
    }

    final fields = <String, String>{
      'typeId': _typeId.toString(),
      'categoryId': widget.categoryId.toString(),
      if (_customNameCtrl.text.trim().isNotEmpty)
        'customTypeName': _customNameCtrl.text.trim(),
      if (widget.categoryCode == 'dues' && _amountCtrl.text.trim().isNotEmpty)
        'amount': _amountCtrl.text.trim(),
      if (widget.categoryCode == 'dues' && _paidOn != null)
        'paidOn':
            '${_paidOn!.year.toString().padLeft(4, '0')}-${_paidOn!.month.toString().padLeft(2, '0')}-${_paidOn!.day.toString().padLeft(2, '0')}',
      if (_yearId != null) 'yearId': _yearId.toString(),
    };
    final files = <String, String>{};
    if (_pickedFilePath != null && _pickedFilePath!.isNotEmpty) {
      files['file'] = _pickedFilePath!;
    }

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.sendMultipart(
          '/api/clubs/${widget.clubId}/ocv-gov/documents/${widget.existing!.id}',
          method: 'PUT',
          fields: fields,
          files: files.isEmpty ? null : files,
        );
      } else {
        await _api.sendMultipart(
          '/api/clubs/${widget.clubId}/ocv-gov/documents',
          method: 'POST',
          fields: fields,
          files: files,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Save failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedType = widget.types.firstWhere(
      (t) => t.id == _typeId,
      orElse: () => widget.types.isNotEmpty
          ? widget.types.first
          : const _DocType(id: 0, typeName: '', categoryId: 0),
    );
    final showCustomName = selectedType.typeName.toLowerCase() == 'others';

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Document' : 'Add Document',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<int>(
                value: _typeId,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'Document Type *',
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8)),
                ),
                items: widget.types
                    .where((t) => t.isActive)
                    .map((t) => DropdownMenuItem(
                          value: t.id,
                          child: Text(t.typeName,
                              overflow: TextOverflow.ellipsis),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _typeId = v),
                validator: (v) => v == null ? 'Type is required' : null,
              ),
              if (showCustomName) ...[
                const SizedBox(height: 12),
                CustomTextField(
                  label: 'Document Name',
                  controller: _customNameCtrl,
                  hint: 'Enter a custom document name',
                ),
              ],
              const SizedBox(height: 12),
              if (widget.years.isNotEmpty)
                DropdownButtonFormField<int>(
                  value: _yearId,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: 'Rotary Year',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  items: widget.years
                      .map((y) => DropdownMenuItem(
                            value: y.id,
                            child: Text(
                                '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}'),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _yearId = v),
                ),
              if (widget.categoryCode == 'dues') ...[
                const SizedBox(height: 12),
                CustomTextField(
                  label: 'Amount',
                  controller: _amountCtrl,
                  hint: '0.00',
                  keyboardType: const TextInputType.numberWithOptions(
                      decimal: true),
                ),
                const SizedBox(height: 12),
                InkWell(
                  onTap: _pickPaidOn,
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 14),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.calendar_today,
                            size: 16, color: AppColors.textSecondary),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _paidOn == null
                                ? 'Paid On (optional)'
                                : 'Paid: ${_dateFmt.format(_paidOn!)}',
                            style: AppTextStyles.body,
                          ),
                        ),
                        if (_paidOn != null)
                          IconButton(
                            icon: const Icon(Icons.close, size: 16),
                            onPressed: () => setState(() => _paidOn = null),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.upload_file, size: 18),
                  label: Text(_pickedFileName == null
                      ? (_isEdit ? 'Replace File (optional)' : 'Pick File *')
                      : _pickedFileName!),
                  onPressed: _saving ? null : _pickFile,
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : Text(_isEdit ? 'Update' : 'Upload'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// OCV compliance report
// ---------------------------------------------------------------------------

/// One row of the OCV compliance report — a required document type and whether
/// it has been uploaded for the selected year. Mirrors the web `OcvReportItem`.
class _OcvReportItem {
  final String categoryName;
  final String categoryCode;
  final int categoryId;
  final int typeId;
  final String typeName;
  final bool isUploaded;
  final int? documentId;
  final String? filePath;
  final String? originalFileName;

  const _OcvReportItem({
    required this.categoryName,
    required this.categoryCode,
    required this.categoryId,
    required this.typeId,
    required this.typeName,
    required this.isUploaded,
    this.documentId,
    this.filePath,
    this.originalFileName,
  });

  factory _OcvReportItem.fromJson(Map<String, dynamic> j) => _OcvReportItem(
        categoryName: j['categoryName']?.toString() ?? '',
        categoryCode: j['categoryCode']?.toString() ?? '',
        categoryId: (j['categoryId'] as int?) ?? 0,
        typeId: (j['typeId'] as int?) ?? 0,
        typeName: j['typeName']?.toString() ?? '',
        isUploaded: _asBool(j['isUploaded']),
        documentId: (j['documentId'] as int?),
        filePath: j['filePath']?.toString(),
        originalFileName: j['originalFileName']?.toString(),
      );
}

/// Full-page document-compliance report reached from the hero's "Generate OCV
/// Report" button. Mirrors the web `/clubs/[id]/ocv-gov/report` page: year +
/// module + status filters, results grouped by category with per-type
/// Uploaded/Pending status + View/Download, a summary, and a CSV share.
class _OcvReportScreen extends StatefulWidget {
  final int clubId;
  final List<_RotaryYear> years;
  final int? initialYearId;

  const _OcvReportScreen({
    required this.clubId,
    required this.years,
    required this.initialYearId,
  });

  @override
  State<_OcvReportScreen> createState() => _OcvReportScreenState();
}

class _OcvReportScreenState extends State<_OcvReportScreen> {
  final _api = ApiClient();

  int? _yearId;
  String _statusFilter = 'all'; // all | yes | no
  String _categoryFilter = 'all';

  bool _loading = true;
  String? _error;
  List<_OcvReportItem> _items = [];

  String get _base => '/api/clubs/${widget.clubId}/ocv-gov';

  String get _yearLabel {
    for (final y in widget.years) {
      if (y.id == _yearId) return y.yearLabel;
    }
    return '';
  }

  @override
  void initState() {
    super.initState();
    _yearId = widget.initialYearId;
    if (_yearId == null && widget.years.isNotEmpty) {
      _RotaryYear? cur;
      for (final y in widget.years) {
        if (y.isCurrent) {
          cur = y;
          break;
        }
      }
      _yearId = (cur ?? widget.years.first).id;
    }
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    if (_yearId == null) {
      setState(() {
        _items = const [];
        _loading = false;
      });
      return;
    }
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/report',
        queryParams: {'yearId': _yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _OcvReportItem.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _items = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _items = const [];
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _items = const [];
        _loading = false;
      });
    }
  }

  // Status + module filtering happen client-side so changing them is instant
  // (the year is the only server-side refetch).
  List<_OcvReportItem> get _filtered {
    return _items.where((i) {
      if (_statusFilter == 'yes' && !i.isUploaded) return false;
      if (_statusFilter == 'no' && i.isUploaded) return false;
      if (_categoryFilter != 'all' && i.categoryName != _categoryFilter) {
        return false;
      }
      return true;
    }).toList();
  }

  List<String> get _categoryNames {
    final seen = <String>[];
    for (final i in _items) {
      if (!seen.contains(i.categoryName)) seen.add(i.categoryName);
    }
    return seen;
  }

  List<({String name, List<_OcvReportItem> items})> get _grouped {
    final order = <String>[];
    final map = <String, List<_OcvReportItem>>{};
    for (final i in _filtered) {
      if (!map.containsKey(i.categoryName)) {
        map[i.categoryName] = [];
        order.add(i.categoryName);
      }
      map[i.categoryName]!.add(i);
    }
    return order.map((n) => (name: n, items: map[n]!)).toList();
  }

  String _csvCell(String? v) {
    final s = (v ?? '').replaceAll('"', '""');
    return '"$s"';
  }

  Future<void> _shareCsv() async {
    final rows = _filtered;
    if (rows.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nothing to export for these filters.')),
      );
      return;
    }
    final box = context.findRenderObject() as RenderBox?;
    final origin = (box != null && box.hasSize)
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 1, 1);

    final buf = StringBuffer();
    buf.writeln('S.No,Module,Document Type,Status,File Name');
    var sno = 0;
    for (final r in rows) {
      sno++;
      buf.writeln([
        _csvCell('$sno'),
        _csvCell(r.categoryName),
        _csvCell(r.typeName),
        _csvCell(r.isUploaded ? 'Uploaded' : 'Not Uploaded'),
        _csvCell(r.originalFileName ?? ''),
      ].join(','));
    }
    try {
      final safeYear = _yearLabel.replaceAll('/', '-').replaceAll(' ', '');
      final name = 'OCV_Report${safeYear.isEmpty ? '' : '_$safeYear'}.csv';
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$name');
      await file.writeAsString(buf.toString(), flush: true);
      await Share.shareXFiles(
        [XFile(file.path)],
        subject: name,
        sharePositionOrigin: origin,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Export failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'OCV Report'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _buildBody(),
    );
  }

  Widget _buildBody() {
    final filtered = _filtered;
    final uploaded = filtered.where((i) => i.isUploaded).length;
    final pending = filtered.length - uploaded;
    final groups = _grouped;

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _fetch,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
        children: [
          Text(
            'Document compliance report',
            style: AppFonts.body(
              fontSize: 12.5,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          _buildFilters(),
          const SizedBox(height: 14),
          if (filtered.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 60),
              child: EmptyStateWidget(
                title: 'No report data',
                subtitle: 'No documents found for the selected filters.',
                icon: Icons.event_note_outlined,
              ),
            )
          else ...[
            for (final g in groups) _buildGroupCard(g.name, g.items),
            const SizedBox(height: 8),
            _buildSummary(uploaded, pending, filtered.length),
          ],
        ],
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.years.isNotEmpty) ...[
            _filterLabel('Rotary Year'),
            _dropdown<int>(
              value: _yearId,
              items: widget.years
                  .map((y) => DropdownMenuItem(
                        value: y.id,
                        child: Text(
                            '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}'),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v == null || v == _yearId) return;
                setState(() => _yearId = v);
                _fetch();
              },
            ),
            const SizedBox(height: 10),
          ],
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _filterLabel('Module'),
                    _dropdown<String>(
                      value: _categoryFilter,
                      items: [
                        const DropdownMenuItem(
                            value: 'all', child: Text('All Modules')),
                        ..._categoryNames.map((c) =>
                            DropdownMenuItem(value: c, child: Text(c))),
                      ],
                      onChanged: (v) =>
                          setState(() => _categoryFilter = v ?? 'all'),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _filterLabel('Status'),
                    _dropdown<String>(
                      value: _statusFilter,
                      items: const [
                        DropdownMenuItem(value: 'all', child: Text('All')),
                        DropdownMenuItem(
                            value: 'yes', child: Text('Uploaded')),
                        DropdownMenuItem(
                            value: 'no', child: Text('Not Uploaded')),
                      ],
                      onChanged: (v) =>
                          setState(() => _statusFilter = v ?? 'all'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _shareCsv,
              icon: const Icon(Icons.ios_share_rounded, size: 18),
              label: const Text('Share as CSV'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primary,
                side: const BorderSide(color: AppColors.border),
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterLabel(String text) => Padding(
        padding: const EdgeInsets.only(left: 2, bottom: 4),
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.textMuted,
          ),
        ),
      );

  Widget _dropdown<T>({
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          isExpanded: true,
          isDense: true,
          borderRadius: BorderRadius.circular(12),
          icon: const Icon(Icons.keyboard_arrow_down_rounded),
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
          items: items,
          onChanged: onChanged,
        ),
      ),
    );
  }

  Widget _buildGroupCard(String name, List<_OcvReportItem> items) {
    final up = items.where((i) => i.isUploaded).length;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            decoration: BoxDecoration(
              color: AppColors.primaryLight.withValues(alpha: 0.45),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(13)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: AppFonts.body(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryPrime,
                    ),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.divider),
                  ),
                  child: Text(
                    '$up/${items.length} uploaded',
                    style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              ],
            ),
          ),
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.divider),
            _buildItemRow(i + 1, items[i]),
          ],
        ],
      ),
    );
  }

  Widget _buildItemRow(int sno, _OcvReportItem item) {
    final hasFile = item.isUploaded && (item.filePath ?? '').isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 22,
            child: Text(
              '$sno',
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.typeName,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    _statusPill(item.isUploaded),
                    if ((item.originalFileName ?? '').isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          item.originalFileName!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppFonts.body(
                            fontSize: 11,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          if (hasFile) ...[
            IconButton(
              tooltip: 'View',
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.visibility_outlined,
                  size: 20, color: AppColors.primary),
              onPressed: () => downloadAndOpenServerFile(
                context,
                filePath: item.filePath,
                fileName: item.originalFileName,
              ),
            ),
            IconButton(
              tooltip: 'Download',
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.download_rounded,
                  size: 20, color: AppColors.primary),
              onPressed: () => shareServerFile(
                context,
                filePath: item.filePath,
                fileName: item.originalFileName,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _statusPill(bool uploaded) {
    final bg = uploaded ? AppColors.successLight : AppColors.errorLight;
    final fg = uploaded ? AppColors.successDark : AppColors.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        uploaded ? 'Uploaded' : 'Pending',
        style: AppFonts.body(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: fg,
        ),
      ),
    );
  }

  Widget _buildSummary(int uploaded, int pending, int total) {
    Widget chip(String label, String value, Color color) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: color.withValues(alpha: 0.25)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '$label ',
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
              Text(
                value,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
            ],
          ),
        );

    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        chip('Uploaded', '$uploaded', AppColors.successDark),
        chip('Pending', '$pending', AppColors.error),
        chip('Total types', '$total', AppColors.primaryPrime),
      ],
    );
  }
}
