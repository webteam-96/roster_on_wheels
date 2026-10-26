import 'dart:async';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/utils/image_crop.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/services/project_share_service.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/pagination_widget.dart';
import '../../../../widgets/detail/detail_widgets.dart';
import '../../../../widgets/detail/detail_hero_layout.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/utils/currency_symbol.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// Flutter uses string module keys; backend requires numeric moduleId.
// IDs are looked up dynamically from `/api/modules` (see _resolveModuleId)
// because the deployed DB may not match these hardcoded values. The map is
// retained only as a last-resort fallback when the lookup fails.
const Map<String, int> _kModuleKeyToId = {
  'club': 11, 'club_service': 11,
  'community': 12, 'community_service': 12,
  'vocational': 13, 'vocational_service': 13,
  'international': 14, 'international_service': 14,
  'new_generation': 15, 'new_generation_service': 15,
  'public-image': 16, 'public_image_initiative': 16,
};

/// Canonicalises module key aliases (e.g. `community` ↔ `community_service`,
/// `public-image` ↔ `public_image_initiative`) into the form returned by
/// `/api/modules`. Used to match by moduleKey when resolving the id.
String _canonicalModuleKey(String key) {
  switch (key) {
    case 'club': return 'club_service';
    case 'community': return 'community_service';
    case 'vocational': return 'vocational_service';
    case 'international': return 'international_service';
    case 'new_generation': return 'new_generation_service';
    case 'public-image':
    case 'public_image': return 'public_image_initiative';
    default: return key;
  }
}

/// The "Please Note" paragraph shared by every module's agreement text.
String get _kAgreeNote =>
    'Please Note: The content posted here will be displayed on the '
    '${Brand.current.productName} Website, District Website, Club Monthly Report & '
    '${Brand.current.productName} Integrated Club Website';

/// Per-module "I Agree" disclaimer text shown when tapping Add (mirrors the web
/// frontend's AGREE_MESSAGE per module). Keyed by canonical module key.
final Map<String, String> _kAgreeMessages = {
  'club_service':
      'The data I will enter is for a Meeting / Event conducted by my club. '
          'E.g., Installation, Navratri Celebration, Weekly Meetings, Etc.\n\n'
          'It is not a Community / Vocational / International / New Generation '
          'Service. E.g., Blood Donation Camp, Tree Plantation, Heart Surgeries, '
          'etc.\n\n$_kAgreeNote',
  'community_service':
      'The data I will enter is for a Community service project conducted by my '
          'club that has benefitted my community. E.g., Heart Surgeries, Tree '
          'Plantation, etc.\n\n$_kAgreeNote',
          // 'It is not a club meeting, fellowship meeting, club celebration or any '
          // 'other miscellaneous event or Project. E.g., Doctor\'s day celebration, '
          // 'Birthday and Anniversary celebration of members, Navratri Celebration, '
          // 'etc.\n\n$_kAgreeNote',
  'vocational_service':
      'The data I will enter is for a Vocational service project conducted by my '
          'club that has benefitted my community. E.g., Career Guidance and Skill '
          'Development, Computer Literacy, etc.\n\n$_kAgreeNote',
          // 'It is not a club meeting, fellowship meeting, club celebration or any '
          // 'other miscellaneous event or Project. E.g., Doctor\'s day celebration, '
          // 'Birthday and Anniversary celebration of members, Blood Donation Camp, '
          // 'etc.\n\n$_kAgreeNote',
  'international_service':
      'The data I will enter is for a International Service project conducted by '
          'my club that has benefitted my community. E.g., Rotary Youth Exchange, '
          'Rotary Friendship Exchange, etc.\n\n$_kAgreeNote',
          // 'It is not a club meeting, fellowship meeting, club celebration or any '
          // 'other miscellaneous event or Project. E.g., Doctor\'s day celebration, '
          // 'Birthday and Anniversary celebration of members, Blood Donation Camp, '
          // 'etc.\n\n$_kAgreeNote',
  'new_generation_service':
      'The data I will enter is for a New generation Service Project conducted by '
          'my club that has benefitted my community. E.g., Formation of an Interact '
          'Club, Formation of a Rotaract Club, etc.\n\n$_kAgreeNote',
          // 'It is not a club meeting, fellowship meeting, club celebration or any '
          // 'other miscellaneous event or Project. E.g., Doctor\'s day celebration, '
          // 'Birthday and Anniversary celebration of members, Blood Donation Camp, '
          // 'etc.\n\n$_kAgreeNote',
  'public_image_initiative':
      'The data I will enter is for a Public Image Initiative conducted by my '
          'club. E.g., Hoardings, Marathons, Rotary Stories on News Papers / Radio '
          '/ TV ads, etc.\n\n$_kAgreeNote',
          // 'It is not a club meeting, fellowship meeting, club celebration or any '
          // 'other miscellaneous event or Project. E.g., Doctor\'s day celebration, '
          // 'Birthday and Anniversary celebration of members, Blood Donation Camp, '
          // 'etc.\n\n$_kAgreeNote',
};

/// Fetches `/api/modules` and returns the id of the module whose moduleKey
/// matches `moduleType`. Falls back to the hardcoded `_kModuleKeyToId` value
/// if the lookup fails or returns no match.
Future<int> _resolveModuleId(ApiClient api, String moduleType) async {
  final canonical = _canonicalModuleKey(moduleType);
  try {
    final resp = await api.get<List<dynamic>>(
      '/api/modules',
      fromJson: (j) => j as List<dynamic>,
    );
    final list = resp.data ?? const [];
    for (final raw in list) {
      if (raw is! Map<String, dynamic>) continue;
      final mk = raw['moduleKey']?.toString();
      if (mk == canonical) {
        final id = raw['id'];
        if (id is int && id > 0) return id;
      }
    }
  } catch (_) {/* fall through to hardcoded fallback */}
  return _kModuleKeyToId[moduleType] ?? _kModuleKeyToId[canonical] ?? 0;
}

// ---------------------------------------------------------------------------
// Currency (project cost). Mirrors rotary-frontend/src/lib/currency.ts so the
// mobile form matches the web Financial & Impact "Currency" dropdown 1:1.
// ---------------------------------------------------------------------------
class _CurrencyOption {
  final String code;
  final String label;
  final String symbol;
  const _CurrencyOption(this.code, this.label, this.symbol);
}

/// The currencies this instance offers (brand `locale.currencies`), as the web `currencyOptions`.
List<_CurrencyOption> get _kCurrencyOptions => [
      for (final c in Brand.current.currencies) _CurrencyOption(c, '$c (${currencySymbolFor(c)})', currencySymbolFor(c)),
    ];

/// Symbol for a currency code, in the brand locale (web getCurrencySymbol).
String _currencySymbol(String? code) => currencySymbolFor(code);

/// The district's configured default when the instance offers it, else the
/// instance default. Mirrors web resolveClubDefaultCurrency.
String _resolveClubDefaultCurrency({String? districtDefaultCurrency, String? districtCountry}) {
  final explicit = (districtDefaultCurrency ?? '').trim().toUpperCase();
  if (Brand.current.currencies.contains(explicit)) return explicit;
  return Brand.current.defaultCurrency;
}

// ---------------------------------------------------------------------------
// Classification smart-search / AI-suggest result (one Area of Focus).
// Mirrors backend ClassificationSearchResultDto + web ClassificationSearchResult.
// ---------------------------------------------------------------------------
class _ClassificationResult {
  final int areaOfFocusId;
  final String areaOfFocusName;
  // Populated only on the cross-module AI `betterModule` (the module a project
  // reads like it belongs to) so the "Better fit" hint can name + route to it.
  final String? moduleKey;
  final String? moduleName;

  const _ClassificationResult({
    required this.areaOfFocusId,
    required this.areaOfFocusName,
    this.moduleKey,
    this.moduleName,
  });

  factory _ClassificationResult.fromJson(Map<String, dynamic> j) => _ClassificationResult(
        areaOfFocusId: (j['areaOfFocusId'] as num?)?.toInt() ?? 0,
        areaOfFocusName: (j['areaOfFocusName'] ?? '').toString(),
        moduleKey: (j['moduleKey'])?.toString(),
        moduleName: (j['moduleName'])?.toString(),
      );
}

// Service-avenue modules the shared project form can switch between (all handled
// by _ProjectFormScreen). Mirrors the web MODULE_ROUTE_SEGMENT allow-list so a
// "better fit" hint never points at a module without an Add form. club_service
// is excluded — it has no classification, so the AI never returns it as a match.
const Set<String> _kSwitchableModuleKeys = {
  'community_service',
  'vocational_service',
  'international_service',
  'new_generation_service',
  'public_image_initiative',
};

String _normalizeModuleKey(String? k) =>
    (k ?? '').toLowerCase().replaceAll('-', '_');

// ---------------------------------------------------------------------------
// Module capability matrix
// ---------------------------------------------------------------------------
/// Describes which form sections/behaviors a given service-area module exposes.
/// All 6 modules share the same backend but diverge significantly in UI/fields.
class _ModuleCaps {
  final bool showClassification;        // Area of Focus row
  final bool showMeetingFields;         // club_service only
  final bool showOngoingType;           // community + public_image
  final bool showJointProject;          // community + public_image
  final bool showCost;                  // all except club_service
  final bool showBeneficiaries;         // all except club_service + public_image
  final bool showFunding;               // all except club_service
  final bool showManHoursRotarians;     // all except club_service
  final bool showLocation;              // all except club_service
  final bool showAgendaDocument;        // legacy agenda doc — off for community

  const _ModuleCaps({
    this.showClassification = true,
    this.showMeetingFields = false,
    this.showOngoingType = true,
    this.showJointProject = true,
    this.showCost = true,
    this.showBeneficiaries = true,
    this.showFunding = true,
    this.showManHoursRotarians = true,
    this.showLocation = true,
    this.showAgendaDocument = true,
  });

  factory _ModuleCaps.forKey(String k) {
    final key = k.toLowerCase().replaceAll('-', '_');
    switch (key) {
      case 'club_service':
      case 'club':
        return const _ModuleCaps(
          showClassification: false,
          showMeetingFields: true,
          showOngoingType: false,
          showJointProject: false,
          showCost: false,
          showBeneficiaries: false,
          showFunding: false,
          showManHoursRotarians: false,
          showLocation: false,
        );
      case 'community_service':
      case 'community':
        return const _ModuleCaps(
          showClassification: true,
          showOngoingType: true,
          showJointProject: true,
          showBeneficiaries: true,
          showFunding: true,
          showManHoursRotarians: true,
          showAgendaDocument: false,
        );
      case 'vocational_service':
      case 'vocational':
      case 'international_service':
      case 'international':
        return const _ModuleCaps(
          showClassification: true,
          showOngoingType: false,
          showJointProject: false,
          showBeneficiaries: true,
          showFunding: true,
          showManHoursRotarians: true,
          showAgendaDocument: false,
        );
      case 'new_generation_service':
      case 'new_generation':
        return const _ModuleCaps(
          showClassification: true,
          showOngoingType: false,
          showJointProject: false,
          showBeneficiaries: true,
          showFunding: true,
          showManHoursRotarians: true,
          showAgendaDocument: false,
        );
      case 'public_image_initiative':
      case 'public_image':
        return const _ModuleCaps(
          showClassification: true,
          showOngoingType: true,
          showJointProject: true,
          showBeneficiaries: false,
          showFunding: true,
          showManHoursRotarians: true,
          showAgendaDocument: false,
        );
      default:
        return const _ModuleCaps(); // community_service defaults
    }
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
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
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent'] ?? j['current']),
      );
}

class _Project {
  final int id;
  final String title;
  final String? description;
  final String? location;
  final DateTime? projectDate;
  final double? projectCost;
  final String? currency;
  final int? directBeneficiaries;
  final bool isJointProject;
  final String? coHostName;
  final String? projectType;
  final int? parentProjectId;
  final String? ongoingGroupTitle;
  final int? areaOfFocusId;
  final String? areaOfFocusName;
  final String? otherAreaOfFocus;
  final int? fundingId;
  final String? fundingName;
  final String? globalGrantNumber;
  final double? amountSanctioned;
  final double? amountReceived;
  final double? amountSpent;
  final String? hostClubsDistricts;
  final String? globalPartnerClubsDistricts;
  final String? csrCompanyName;
  final int? manHours;
  final int? rotariansInvolved;
  final int? rotaractorsInvolved;
  final String? yearLabel;
  final int? yearId;
  final String? primaryPhotoPath;
  final List<_ProjectPhoto> photos;
  final int? attendance;
  final double? attendancePercentage;
  final String? meetingType;
  final String? agendaDocument;
  final String? agendaDocumentName;
  final String? minutesDocument;
  final String? minutesDocumentName;
  final String? clubRole;

  const _Project({
    required this.id,
    required this.title,
    this.description,
    this.location,
    this.projectDate,
    this.projectCost,
    this.currency,
    this.directBeneficiaries,
    this.isJointProject = false,
    this.coHostName,
    this.projectType,
    this.parentProjectId,
    this.ongoingGroupTitle,
    this.areaOfFocusId,
    this.areaOfFocusName,
    this.otherAreaOfFocus,
    this.fundingId,
    this.fundingName,
    this.globalGrantNumber,
    this.amountSanctioned,
    this.amountReceived,
    this.amountSpent,
    this.hostClubsDistricts,
    this.globalPartnerClubsDistricts,
    this.csrCompanyName,
    this.manHours,
    this.rotariansInvolved,
    this.rotaractorsInvolved,
    this.yearLabel,
    this.yearId,
    this.primaryPhotoPath,
    this.photos = const [],
    this.attendance,
    this.attendancePercentage,
    this.meetingType,
    this.agendaDocument,
    this.agendaDocumentName,
    this.minutesDocument,
    this.minutesDocumentName,
    this.clubRole,
  });

  factory _Project.fromJson(Map<String, dynamic> j) {
    // The detail endpoint returns `photos[]` (with imagePath, description,
    // isPrimary, sortOrder). The list endpoint may instead return a flat
    // `primaryPhotoPath` field. Handle both, deriving `primaryPhotoPath` from
    // the photos array when needed so list cards keep working.
    final rawPhotos = (j['photos'] as List<dynamic>?) ?? const [];
    final photos = rawPhotos
        .whereType<Map<String, dynamic>>()
        .map(_ProjectPhoto.fromJson)
        .toList();
    String? primary = (j['primaryPhotoPath'])?.toString();
    if ((primary == null || primary.isEmpty) && photos.isNotEmpty) {
      final p = photos.firstWhere(
        (x) => x.isPrimary && x.path.isNotEmpty,
        orElse: () => photos.firstWhere(
          (x) => x.path.isNotEmpty,
          orElse: () => photos.first,
        ),
      );
      primary = p.path.isNotEmpty ? p.path : null;
    }
    return _Project(
        id: j['id'] as int? ?? 0,
        title: j['title'] as String? ?? '',
        description: j['description'] as String?,
        location: j['location'] as String?,
        projectDate: j['projectDate'] != null ? DateTime.tryParse(j['projectDate'] as String) : null,
        projectCost: (j['projectCost'] as num?)?.toDouble(),
        currency: (j['currency'])?.toString(),
        directBeneficiaries: j['directBeneficiaries'] as int?,
        isJointProject: _asBool(j['isJointProject']),
        coHostName: j['coHostName'] as String?,
        projectType: (j['projectType'])?.toString(),
        parentProjectId: j['parentProjectId'] as int?,
        ongoingGroupTitle: (j['ongoingGroupTitle'])?.toString(),
        areaOfFocusId: (j['areaOfFocusId'] as num?)?.toInt(),
        areaOfFocusName: (j['areaOfFocusName'])?.toString(),
        otherAreaOfFocus: (j['otherAreaOfFocus'])?.toString(),
        fundingId: (j['fundingId'] as num?)?.toInt(),
        fundingName: (j['fundingName'])?.toString(),
        globalGrantNumber: (j['globalGrantNumber'])?.toString(),
        amountSanctioned: (j['amountSanctioned'] as num?)?.toDouble(),
        amountReceived: (j['amountReceived'] as num?)?.toDouble(),
        amountSpent: (j['amountSpent'] as num?)?.toDouble(),
        hostClubsDistricts: (j['hostClubsDistricts'])?.toString(),
        globalPartnerClubsDistricts:
            (j['globalPartnerClubsDistricts'])?.toString(),
        csrCompanyName: (j['csrCompanyName'])?.toString(),
        manHours: (j['manHours'] as num?)?.toInt(),
        rotariansInvolved: (j['rotariansInvolved'] as num?)?.toInt(),
        rotaractorsInvolved: (j['rotaractorsInvolved'] as num?)?.toInt(),
        yearLabel: (j['yearLabel'])?.toString(),
        yearId: j['yearId'] as int?,
        primaryPhotoPath: primary,
        photos: photos,
        attendance: j['attendance'] as int?,
        attendancePercentage: (j['attendancePercentage'] as num?)?.toDouble(),
        meetingType: (j['meetingType'])?.toString(),
        agendaDocument: (j['agendaDocument'])?.toString(),
        agendaDocumentName: (j['agendaDocumentName'] ?? j['agendaDocumentOriginalName'])?.toString(),
        minutesDocument: (j['minutesDocument'])?.toString(),
        minutesDocumentName: (j['minutesDocumentName'] ?? j['minutesDocumentOriginalName'])?.toString(),
        clubRole: (j['clubRole'])?.toString(),
      );
  }
}

class _DropdownItem {
  final int id;
  final String name;
  final bool isActive;
  const _DropdownItem({required this.id, required this.name, this.isActive = true});

  factory _DropdownItem.fromJson(Map<String, dynamic> j) => _DropdownItem(
        id: j['id'] as int? ?? 0,
        name: j['name'] as String? ?? j['title'] as String? ?? '',
        isActive: _asBool(j['isActive'] ?? j['active'] ?? true),
      );
}

/// Keep only active options, and drop any API row literally named "Others":
/// the classification dropdowns always render their own synthetic "Others"
/// (the free-text trigger), so a backend "Others" would show up twice.
/// Mirrors the web console, which filters `aof.filter(a => a.isActive)`.
List<_DropdownItem> _usableOptions(List<_DropdownItem> items) => items
    .where((e) => e.isActive && e.name.trim().toLowerCase() != 'others')
    .toList();

/// Represents a single uploaded project photo with metadata.
class _ProjectPhoto {
  String path;
  String description;
  bool isPrimary;
  _ProjectPhoto({required this.path, this.description = '', this.isPrimary = false});

  Map<String, dynamic> toJson() => {
        'path': path,
        'description': description,
        'isPrimary': isPrimary,
      };

  factory _ProjectPhoto.fromJson(Map<String, dynamic> j) => _ProjectPhoto(
        path: (j['imagePath'] ?? j['path'] ?? j['url'] ?? '').toString(),
        description: (j['description'] ?? '').toString(),
        isPrimary: _asBool(j['isPrimary']),
      );
}

/// Lightweight representation of a parent (ongoing) project for picker.
class _ParentProjectOption {
  final int id;
  final String title;
  final String? ongoingGroupTitle;
  const _ParentProjectOption({required this.id, required this.title, this.ongoingGroupTitle});
  factory _ParentProjectOption.fromJson(Map<String, dynamic> j) => _ParentProjectOption(
        id: j['id'] as int? ?? 0,
        title: j['title']?.toString() ?? '',
        ongoingGroupTitle: j['ongoingGroupTitle']?.toString(),
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class ProjectsScreen extends StatefulWidget {
  final int clubId;
  final String moduleType;
  final bool embedded;
  final bool viewOnly;
  // When set (from Club Monthly Report flow), the add/edit form locks the
  // project-date picker to this month so the project lands in the right
  // monthly report bucket. Web parity: `frozenMonth` + `frozenYearId`.
  final int? frozenMonth;
  final int? frozenYearId;
  // When true and the user can manage, auto-open the add form once the
  // screen mounts (matches web's `?add=1` deep-link from Monthly Report).
  final bool autoOpenAdd;
  // When set, auto-open the EDIT form for this project (deep-link from the
  // Club Dashboard › Service Projects per-row Edit action).
  final int? autoOpenEditProjectId;
  final int? autoOpenEditYearId;
  // When set (from a push-notification deep-link), auto-open this project's
  // read-only DETAIL once the screen mounts. Available to any viewer (unlike
  // the Edit deep-link, which is admin-gated).
  final int? autoOpenDetailProjectId;
  final int? autoOpenDetailYearId;

  const ProjectsScreen({
    super.key,
    required this.clubId,
    required this.moduleType,
    this.embedded = false,
    this.viewOnly = false,
    this.frozenMonth,
    this.frozenYearId,
    this.autoOpenAdd = false,
    this.autoOpenEditProjectId,
    this.autoOpenEditYearId,
    this.autoOpenDetailProjectId,
    this.autoOpenDetailYearId,
  });

  @override
  State<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends State<ProjectsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');
  final _numFmt = NumberFormat('#,##0.00');
  final _searchCtrl = TextEditingController();
  String _projectTypeFilter = 'all';

  final List<_Project> _projects = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;

  // Module id resolved from `/api/modules` by matching moduleKey. The
  // hardcoded `_kModuleKeyToId` is kept only as a fallback for offline /
  // failed-lookup cases — the deployed DB's module IDs may not match the
  // hardcoded values (caused the "data showing in any avenue" bug since
  // the wrong moduleId was sent to the backend's project list filter).
  int? _resolvedModuleId;

  String get _screenTitle {
    switch (widget.moduleType) {
      case 'community':
      case 'community_service': return 'Community Service';
      case 'vocational':
      case 'vocational_service': return 'Vocational Service';
      case 'club':
      case 'club_service': return 'Club Service';
      case 'international':
      case 'international_service': return 'International Service';
      case 'new_generation':
      case 'new_generation_service': return 'New Generation Service';
      case 'public-image':
      case 'public_image_initiative': return 'Public Image Initiative';
      default: return 'Projects';
    }
  }

  // Club Service records meetings/events, not projects — its user-facing copy
  // uses "Meeting" instead of "Project" (mirrors the web club-service page).
  bool get _isMeetingModule {
    switch (widget.moduleType) {
      case 'club':
      case 'club_service':
        return true;
      default:
        return false;
    }
  }

  String get _itemNoun => _isMeetingModule ? 'Meeting' : 'Project';
  String get _itemNounLower => _isMeetingModule ? 'meeting' : 'project';

  // The Add-button copy: Club Service uses its module name (mirrors the web
  // "Add Club Service" rename), everything else uses the item noun.
  String get _addActionLabel =>
      widget.moduleType == 'club_service' ? 'Add Club Service' : 'Add $_itemNoun';

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(_onSearchChanged);
    _bootstrap();
  }

  Timer? _debounce;
  void _onSearchChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      _fetch(reset: true);
    });
  }

  Future<void> _bootstrap() async {
    // Resolve the backend moduleId from `/api/modules` BEFORE the first
    // year/project fetch — otherwise we'd request with the hardcoded id
    // which may be wrong on the deployed DB and leak data from a different
    // avenue.
    _resolvedModuleId = await _resolveModuleId(_api, widget.moduleType);
    await _loadYears();
    // If the screen was opened from Club Monthly Report with `frozenYearId`,
    // align the year filter to that report's year so the new project shows
    // up here after it's saved.
    if (widget.frozenYearId != null && widget.frozenYearId! > 0) {
      _selectedYearId = widget.frozenYearId;
    }
    await _fetch(reset: true);
    // Auto-open the add form when requested by the caller (Monthly Report).
    if (!mounted) return;
    if (widget.autoOpenAdd && canManage) {
      // Wait until layout settles before pushing the form route.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showForm();
      });
    } else if (widget.autoOpenEditProjectId != null && canManage) {
      // Deep-link edit (from the Club Dashboard Service Projects tab).
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _openEditById(
            widget.autoOpenEditProjectId!,
            widget.autoOpenEditYearId ?? _selectedYearId ?? 0,
          );
        }
      });
    } else if (widget.autoOpenDetailProjectId != null) {
      // Deep-link view (from a push notification). Not admin-gated.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _openDetailById(
            widget.autoOpenDetailProjectId!,
            widget.autoOpenDetailYearId ?? _selectedYearId ?? 0,
          );
        }
      });
    }
  }

  /// Open a project's read-only detail by id+year (deep-link from a push
  /// notification — no list `_Project` row on hand). Verifies the project still
  /// exists first, so a deleted/invalid id falls back to the list instead of a
  /// dead-end "Failed to load" detail screen.
  Future<void> _openDetailById(int projectId, int yearId) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/$yearId/$projectId',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.data == null) {
        _showDeepLinkUnavailable();
        return;
      }
    } catch (_) {
      _showDeepLinkUnavailable();
      return;
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ProjectDetailScreen(
          clubId: widget.clubId,
          moduleType: widget.moduleType,
          projectId: projectId,
          yearId: yearId,
          screenTitle: _screenTitle,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  void _showDeepLinkUnavailable() {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('This ${_itemNoun.toLowerCase()} is no longer available.')),
    );
  }

  /// Fetch a project's detail by id+year and open its edit form. Used by the
  /// deep-link Edit from the dashboard (no list `_Project` object on hand).
  Future<void> _openEditById(int projectId, int yearId) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/$yearId/$projectId',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted || resp.data == null) return;
      final detailed = _Project.fromJson(resp.data!);
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => _ProjectFormScreen(
            clubId: widget.clubId,
            moduleType: widget.moduleType,
            yearId: yearId,
            existing: detailed,
            frozenMonth: widget.frozenMonth,
            frozenYearLabel: _frozenYearLabel,
            onSaved: () => _fetch(reset: true),
          ),
        ),
      );
    } catch (_) {
      // Detail fetch failed — leave the user on the list screen.
    }
  }

  Future<void> _loadYears() async {
    final moduleId = _resolvedModuleId ?? (_kModuleKeyToId[widget.moduleType] ?? 0);
    List<_RotaryYear> years = [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/projects/years',
        queryParams: {'moduleId': moduleId},
        fromJson: (j) => j as List<dynamic>,
      );
      years = (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      years = [];
    }
    if (years.isEmpty) {
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
    }
    final current = years.firstWhere(
      (y) => y.isCurrent,
      orElse: () => years.isNotEmpty
          ? years.first
          : const _RotaryYear(id: 0, yearLabel: ''),
    );
    if (!mounted) return;
    setState(() {
      _years = years;
      _selectedYearId = current.id != 0 ? current.id : null;
    });
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _projects.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final moduleId = _resolvedModuleId ?? (_kModuleKeyToId[widget.moduleType] ?? 0);
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          'moduleId': moduleId,
          'yearId': _selectedYearId ?? 0,
          if (_searchCtrl.text.trim().isNotEmpty)
            'search': _searchCtrl.text.trim(),
          if (_projectTypeFilter != 'all')
            'projectType': _projectTypeFilter,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Project.fromJson(j));
      setState(() {
        _projects.addAll(paged.items);
        _totalPages = paged.totalPages;
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; _loadingMore = false; });
    }
  }

  Future<void> _delete(_Project proj) async {
    // Year-scoped delete — projects live in year-partitioned tables.
    final yearId = proj.yearId ?? _selectedYearId;
    if (yearId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: missing $_itemNounLower year'), backgroundColor: AppColors.error),
        );
      }
      return;
    }
    try {
      await _api.delete('/api/clubs/${widget.clubId}/projects/$yearId/${proj.id}');
      setState(() => _projects.removeWhere((p) => p.id == proj.id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$_itemNoun deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _openDetail(_Project project) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ProjectDetailScreen(
          clubId: widget.clubId,
          moduleType: widget.moduleType,
          projectId: project.id,
          yearId: project.yearId ?? _selectedYearId ?? 0,
          screenTitle: _screenTitle,
          listRow: project,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Future<void> _showForm({_Project? existing}) async {
    // "I Agree" disclaimer gate — shown on Add only (never Edit), mirroring the
    // web frontend. Cancel aborts; "I Agree & Continue" proceeds to the form.
    if (existing == null) {
      final agreed = await _showAgreementDialog();
      if (agreed != true || !mounted) return;
    }
    // For edit, fetch full detail so the form pre-fills fields the list
    // endpoint omits (agenda/minutes documents, etc.).
    _Project? detailed = existing;
    if (existing != null) {
      try {
        final detailYearId = existing.yearId ?? _selectedYearId ?? 0;
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/projects/$detailYearId/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) {
          detailed = _Project.fromJson(resp.data!);
        }
      } catch (_) {
        // Fall back to list summary if detail fetch fails.
      }
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ProjectFormScreen(
          clubId: widget.clubId,
          moduleType: widget.moduleType,
          yearId: _selectedYearId ?? 0,
          existing: detailed,
          frozenMonth: widget.frozenMonth,
          frozenYearLabel: _frozenYearLabel,
          onSaved: () => _fetch(reset: true),
        ),
      ),
    );
  }

  /// Shows the per-module "I Agree" disclaimer (web parity). Returns true when
  /// the user taps "I Agree & Continue", false/null on Cancel or dismiss.
  Future<bool?> _showAgreementDialog() {
    final message = _kAgreeMessages[_canonicalModuleKey(widget.moduleType)] ??
        _kAgreeMessages['community_service']!;
    final maxH = MediaQuery.of(context).size.height * 0.8;
    return showDialog<bool>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.white,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxH, maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Icon badge + title
                Center(
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.10),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.info_outline,
                        color: AppColors.primary, size: 30),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'I Agree',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.h3.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 16),
                // Scrollable body so the long agreement never clips.
                Flexible(
                  child: SingleChildScrollView(
                    child: Text(
                      message,
                      style: AppTextStyles.body.copyWith(
                        color: AppColors.textSecondary,
                        height: 1.45,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                // Full-width stacked buttons — never collide on narrow screens.
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('I Agree & Continue',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 48,
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textSecondary,
                      side: const BorderSide(color: AppColors.border),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Year label (e.g. "2025-26") for the frozen year — used to clamp the
  /// project date picker to a specific calendar month.
  String? get _frozenYearLabel {
    if (widget.frozenYearId == null) return null;
    final y = _years.firstWhere(
      (e) => e.id == widget.frozenYearId,
      orElse: () => const _RotaryYear(id: 0, yearLabel: '', isCurrent: false),
    );
    return y.yearLabel.isEmpty ? null : y.yearLabel;
  }

  /// Per-level gating: only club admins of THIS club can manage.
  bool get canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded ? null : CustomAppBar(title: _screenTitle),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _showForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          if (_years.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.calendar_today_rounded,
                        size: 15, color: AppColors.textSecondary),
                    const SizedBox(width: 8),
                    Text('Rotary Year',
                        style: AppFonts.body(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary,
                        )),
                    const Spacer(),
                    DropdownButton<int>(
                      value: _selectedYearId,
                      underline: const SizedBox.shrink(),
                      isDense: true,
                      borderRadius: BorderRadius.circular(12),
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      onChanged: (v) {
                        setState(() => _selectedYearId = v);
                        _fetch(reset: true);
                      },
                      items: [
                        for (final y in _years)
                          DropdownMenuItem<int>(
                            value: y.id,
                            child: Text(
                              '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: TextField(
              controller: _searchCtrl,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              decoration: InputDecoration(
                hintText: 'Search ${_itemNounLower}s...',
                hintStyle: AppFonts.body(
                    fontSize: 13, color: AppColors.textMuted),
                prefixIcon: const Icon(Icons.search_rounded, size: 18),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                        },
                      )
                    : null,
                isDense: true,
                filled: true,
                fillColor: AppColors.surface,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
          ),
          // The One Time / Ongoing filter only makes sense in modules that
          // actually support ongoing/repeat projects — Community Service and
          // Public Image Initiative. Club Service, Vocational, International,
          // New Generation are one-time only, so the chips were misleading
          // there (selecting "Ongoing" always produced an empty list).
          if (_ModuleCaps.forKey(widget.moduleType).showOngoingType)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Row(
                children: [
                  _buildTypeChip('all', 'All'),
                  const SizedBox(width: 8),
                  _buildTypeChip('one_time', 'One Time'),
                  const SizedBox(width: 8),
                  _buildTypeChip('ongoing_repeat', 'Ongoing'),
                ],
              ),
            ),
          Expanded(child: _buildListBody()),
        ],
      ),
    );
  }

  Widget _buildTypeChip(String value, String label) {
    final selected = _projectTypeFilter == value;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) {
        setState(() => _projectTypeFilter = value);
        _fetch(reset: true);
      },
      selectedColor: AppColors.primary.withValues(alpha: 0.15),
      labelStyle: AppFonts.body(
        fontSize: 12.5,
        color: selected ? AppColors.primaryPrime : AppColors.textSecondary,
        fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
      ),
      backgroundColor: AppColors.surface,
      side: BorderSide(color: selected ? AppColors.primary : AppColors.divider),
      visualDensity: VisualDensity.compact,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    );
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.removeListener(_onSearchChanged);
    _searchCtrl.dispose();
    super.dispose();
  }

  Widget _buildListBody() {
    return _loading
          ? const ShimmerList(itemCount: 6, itemHeight: 110)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
              : _projects.isEmpty
                  ? EmptyStateWidget(
                      title: 'No ${_itemNoun}s',
                      subtitle: canManage
                          ? 'Tap + to add a new $_itemNounLower.'
                          : 'No ${_itemNounLower}s have been added yet.',
                      icon: Icons.workspaces_outlined,
                      actionLabel: canManage ? _addActionLabel : null,
                      onAction: canManage ? () => _showForm() : null,
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: () => _fetch(reset: true),
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _projects.length + 1,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (ctx, i) {
                          if (i == _projects.length) {
                            return PaginationWidget(
                              currentPage: _page,
                              totalPages: _totalPages,
                              totalCount: _totalCount,
                              isLoading: _loadingMore,
                              onLoadMore: () {
                                if (_page < _totalPages && !_loadingMore) { _page++; _fetch(); }
                              },
                            );
                          }
                          final proj = _projects[i];
                          return _ProjectCard(
                            project: proj,
                            df: _df,
                            numFmt: _numFmt,
                            caps: _ModuleCaps.forKey(widget.moduleType),
                            canManage: canManage,
                            moduleType: widget.moduleType,
                            onTap: () => _openDetail(proj),
                            onEdit: () => _showForm(existing: proj),
                            onDelete: () async {
                              final ok = await ConfirmationDialog.show(
                                context,
                                title: 'Delete $_itemNoun',
                                message: 'Delete "${proj.title}"?',
                              );
                              if (ok) _delete(proj);
                            },
                          );
                        },
                      ),
                    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _ProjectCard extends StatelessWidget {
  final _Project project;
  final DateFormat df;
  final NumberFormat numFmt;
  final _ModuleCaps caps;
  final bool canManage;
  final String moduleType;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback? onTap;

  const _ProjectCard({
    required this.project,
    required this.df,
    required this.numFmt,
    required this.caps,
    required this.canManage,
    required this.moduleType,
    required this.onEdit,
    required this.onDelete,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isMeeting = caps.showMeetingFields;

    // Tier 1 — textual facts (icon + label).
    final facts = <Widget>[
      if (project.projectDate != null)
        _MetaFact(
          icon: Icons.calendar_today_outlined,
          text: df.format(project.projectDate!),
        ),
      if (isMeeting) ...[
        if (project.meetingType != null && project.meetingType!.isNotEmpty)
          _MetaFact(
            icon: Icons.event_note_outlined,
            text:
                '${project.meetingType![0].toUpperCase()}${project.meetingType!.substring(1)} meeting',
          ),
      ] else ...[
        if (project.location != null && project.location!.isNotEmpty)
          _MetaFact(icon: Icons.location_on_outlined, text: project.location!),
        if (project.areaOfFocusName != null && project.areaOfFocusName!.isNotEmpty)
          _MetaFact(icon: Icons.category_outlined, text: project.areaOfFocusName!),
      ],
    ];

    // Tier 2 — numeric metrics (tinted pills).
    final pills = <Widget>[
      if (isMeeting) ...[
        if (project.attendance != null)
          _CountPill(text: 'Attendance: ${project.attendance}'),
      ] else ...[
        if (project.directBeneficiaries != null)
          _CountPill(text: '${project.directBeneficiaries} beneficiaries'),
      ],
      // Cost is intentionally OUTSIDE the meeting/project branch — it renders
      // for ANY module when present, preserving the previous behavior.
      if (project.projectCost != null)
        _CountPill(text: '${_currencySymbol(project.currency)} ${numFmt.format(project.projectCost!)}'),
    ];

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.divider),
      ),
      color: AppColors.card,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: badge + title/pills + overflow menu.
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _AvenueBadge(icon: _avenueIcon(moduleType)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          project.title,
                          style: AppFonts.body(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (project.isJointProject) ...[
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            children: [
                              if (project.isJointProject) const _JointPill(),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (canManage)
                    _CardMenu(onEdit: onEdit, onDelete: onDelete),
                ],
              ),
              if (facts.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(spacing: 14, runSpacing: 6, children: facts),
              ],
              if (pills.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 6, children: pills),
              ],
              if (project.isJointProject &&
                  project.coHostName != null &&
                  project.coHostName!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('Co-host: ${project.coHostName}',
                    style: AppFonts.body(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    )),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// Leading avenue icon for the card badge. Presentation-only; falls back to a
// generic icon for any unknown module type.
IconData _avenueIcon(String moduleType) {
  switch (moduleType) {
    case 'club_service':
      return Icons.groups_outlined;
    case 'community_service':
      return Icons.volunteer_activism_outlined;
    case 'vocational_service':
      return Icons.work_outline_rounded;
    case 'international_service':
      return Icons.public;
    case 'new_generation_service':
      return Icons.school_outlined;
    case 'public_image_initiative':
      return Icons.campaign_outlined;
    default:
      return Icons.workspaces_outlined;
  }
}

/// Leading tinted icon badge identifying the avenue.
class _AvenueBadge extends StatelessWidget {
  final IconData icon;
  const _AvenueBadge({required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(icon, size: 20, color: AppColors.primaryPrime),
    );
  }
}

/// Small tonal "JOINT" tag for joint projects.
class _JointPill extends StatelessWidget {
  const _JointPill();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        'JOINT',
        style: AppFonts.body(
          fontSize: 10,
          fontWeight: FontWeight.w800,
          color: AppColors.primaryPrime,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// Icon + label textual fact (date / location / area-of-focus / meeting type).
class _MetaFact extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaFact({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.textSecondary),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            text,
            style: AppFonts.body(
              fontSize: 11.5,
              color: AppColors.textSecondary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// Tinted numeric metric pill (beneficiaries / attendance / money amount).
class _CountPill extends StatelessWidget {
  final String text;
  const _CountPill({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: AppColors.primaryPrime,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}

/// Admin-only overflow menu hosting Edit / Delete (replaces the inline icons).
class _CardMenu extends StatelessWidget {
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _CardMenu({required this.onEdit, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<int>(
      icon: const Icon(Icons.more_vert, size: 20, color: AppColors.textMuted),
      padding: EdgeInsets.zero,
      tooltip: 'More',
      onSelected: (v) {
        if (v == 0) {
          onEdit();
        } else if (v == 1) {
          onDelete();
        }
      },
      itemBuilder: (_) => [
        const PopupMenuItem<int>(
          value: 0,
          child: Row(children: [
            Icon(Icons.edit_outlined, size: 18),
            SizedBox(width: 10),
            Text('Edit'),
          ]),
        ),
        const PopupMenuItem<int>(
          value: 1,
          child: Row(children: [
            Icon(Icons.delete_outline, size: 18, color: AppColors.error),
            SizedBox(width: 10),
            Text('Delete', style: TextStyle(color: AppColors.error)),
          ]),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Detail Screen — view-only display of a single project / meeting.
// Mirrors the web's `/clubs/{id}/club-service/{projectId}` page: title bar,
// numbered sections (Meeting Details, Meeting Type, Documents, Attendance,
// Photos), and an Edit action for admins that opens the existing form.
// ---------------------------------------------------------------------------
class _ProjectDetailScreen extends StatefulWidget {
  final int clubId;
  final String moduleType;
  final int projectId;
  final int yearId; // year-partitioned table the project lives in
  final String screenTitle;

  /// The summary row from the list, used as a fallback if the year-scoped
  /// detail fetch fails for any reason.
  final _Project? listRow;

  const _ProjectDetailScreen({
    required this.clubId,
    required this.moduleType,
    required this.projectId,
    required this.yearId,
    required this.screenTitle,
    this.listRow,
  });

  @override
  State<_ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<_ProjectDetailScreen> {
  final _api = ApiClient();
  final _displayDf = DateFormat('dd MMM yyyy');
  _Project? _project;
  bool _loading = true;
  String? _error;
  bool _changed = false;
  // True when the detail endpoint failed and we're showing the list-row
  // summary instead (some fields like documents/photos may be missing).
  bool _partial = false;

  static const _meetingTypeLabels = <String, String>{
    'regular': 'Regular',
    'fellowship': 'Fellowship',
    'bod': 'BOD',
    'assembly': 'Assembly',
    'trust': 'Trust',
  };

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/${widget.yearId}/${widget.projectId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.data == null) {
        _fallbackToListRow(
            '${_ModuleCaps.forKey(widget.moduleType).showMeetingFields ? 'Meeting' : 'Project'} not found');
        return;
      }
      setState(() {
        _project = _Project.fromJson(resp.data!);
        _partial = false;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      // Safety net: if the year-scoped detail fetch fails for any reason, show
      // the list-row summary instead of a hard error so the project is still
      // viewable.
      _fallbackToListRow('Failed to load: $e');
    }
  }

  void _fallbackToListRow(String error) {
    if (widget.listRow != null) {
      setState(() {
        _project = widget.listRow;
        _partial = true;
        _loading = false;
      });
    } else {
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _edit() async {
    final p = _project;
    if (p == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ProjectFormScreen(
          clubId: widget.clubId,
          moduleType: widget.moduleType,
          yearId: p.yearId ?? 0,
          existing: p,
          onSaved: () {
            _changed = true;
            _fetch();
          },
        ),
      ),
    );
  }

  Future<void> _openDoc(String? path) async {
    if (path == null || path.isEmpty) return;
    final url = ApiConstants.mediaUrl(path);
    if (url.isEmpty) return;
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open document')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = _canManage;
    return WillPopScope(
      onWillPop: () async {
        Navigator.of(context).pop(_changed);
        return false;
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: CustomAppBar(
          title: widget.screenTitle,
          actions: [
            if (_project != null)
              IconButton(
                tooltip: 'Share',
                icon: const Icon(Icons.share_outlined),
                onPressed: () => shareProject(context,
                    projectId: _project!.id, yearId: _project!.yearId),
              ),
            if (canManage && _project != null)
              IconButton(
                tooltip: 'Edit',
                icon: const Icon(Icons.edit_outlined),
                onPressed: _edit,
              ),
          ],
        ),
        body: _loading
            ? const LoadingWidget()
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          TextButton(onPressed: _fetch, child: const Text('Retry')),
                        ],
                      ),
                    ),
                  )
                : _buildBody(_project!),
      ),
    );
  }

  Widget _buildBody(_Project p) {
    final caps = _ModuleCaps.forKey(widget.moduleType);
    final isClubService = caps.showMeetingFields;
    // Community projects hide the agenda doc entirely (form + detail).
    final showAgenda = caps.showAgendaDocument &&
        p.agendaDocument != null &&
        p.agendaDocument!.isNotEmpty;
    final hasMinutes =
        p.minutesDocument != null && p.minutesDocument!.isNotEmpty;
    final hasDocs = showAgenda || hasMinutes;

    // Area of Focus value (respects caps + "Others:" fallback).
    final aofVal = (p.otherAreaOfFocus?.isNotEmpty ?? false)
        ? 'Others: ${p.otherAreaOfFocus}'
        : ((p.areaOfFocusName?.isNotEmpty ?? false) ? p.areaOfFocusName : null);

    // Urls + per-photo captions built together so they stay index-aligned even
    // when a photo path is blank/unresolvable (mirrors District Events).
    final galleryUrls = <String>[];
    final galleryCaptions = <String>[];
    for (final ph in p.photos) {
      if (ph.path.trim().isEmpty) continue;
      final url = detailMediaUrl(ph.path);
      if (url == null) continue;
      galleryUrls.add(url);
      galleryCaptions.add(ph.description.trim());
    }

    final meetingTypeLabel =
        (isClubService && p.meetingType != null && p.meetingType!.isNotEmpty)
            ? (_meetingTypeLabels[p.meetingType!.toLowerCase()] ??
                p.meetingType!)
            : null;

    // Date / location / area-of-focus surfaced as chips (club-finder style).
    final chips = <Widget>[
      if (p.projectDate != null)
        detailInfoChip(
            Icons.calendar_today_outlined, _displayDf.format(p.projectDate!)),
      if (p.location != null && p.location!.isNotEmpty)
        detailInfoChip(Icons.location_on_outlined, p.location!),
      if (caps.showClassification && aofVal != null)
        detailInfoChip(Icons.track_changes_outlined, aofVal),
      if (meetingTypeLabel != null)
        detailInfoChip(Icons.event_available_outlined, meetingTypeLabel),
    ];

    String? cur(double? v) =>
        v == null ? null : _money(v, symbol: _currencySymbol(p.currency));

    final rows = <DetailKV>[
      if (caps.showOngoingType)
        DetailKV('Project Type',
            p.projectType == 'one_time' ? 'One Time' : 'Ongoing / Repeat'),
      DetailKV('Ongoing/Repeat Title',
          (p.ongoingGroupTitle?.isNotEmpty ?? false) ? p.ongoingGroupTitle : null),
      if (caps.showJointProject)
        DetailKV('Joint Project', p.isJointProject ? 'Yes' : 'No'),
      DetailKV(
          'Co-Host',
          (p.isJointProject && (p.coHostName?.isNotEmpty ?? false))
              ? p.coHostName
              : null),
      DetailKV(
          'Club Role',
          (p.isJointProject && (p.clubRole?.isNotEmpty ?? false))
              ? (p.clubRole!.toLowerCase() == 'lead'
                  ? 'Lead Club'
                  : 'Co-Host Club')
              : null),
      if (caps.showClassification) DetailKV('Area of Focus', aofVal),
      // Club-service attendance.
      if (isClubService && p.attendance != null)
        DetailKV('Attendance', '${p.attendance}'),
      if (isClubService && p.attendancePercentage != null)
        DetailKV('Attendance (%)', '${p.attendancePercentage!}%'),
      // Financial & impact (non club-service avenues).
      if (!isClubService) DetailKV('Project Cost', cur(p.projectCost)),
      if (!isClubService)
        DetailKV('Funding',
            (p.fundingName?.isNotEmpty ?? false) ? p.fundingName : null),
      if (!isClubService)
        DetailKV(
            'Global Grant Number',
            (p.globalGrantNumber?.isNotEmpty ?? false)
                ? p.globalGrantNumber
                : null),
      if (!isClubService)
        DetailKV('Amount Sanctioned', cur(p.amountSanctioned)),
      if (!isClubService) DetailKV('Amount Received', cur(p.amountReceived)),
      if (!isClubService)
        DetailKV('Amount Spent Till Date', cur(p.amountSpent)),
      if (!isClubService)
        DetailKV(
            'Host Clubs/Districts',
            (p.hostClubsDistricts?.isNotEmpty ?? false)
                ? p.hostClubsDistricts
                : null),
      if (!isClubService)
        DetailKV(
            'Global Partner Clubs/Districts',
            (p.globalPartnerClubsDistricts?.isNotEmpty ?? false)
                ? p.globalPartnerClubsDistricts
                : null),
      if (!isClubService)
        DetailKV('CSR Company',
            (p.csrCompanyName?.isNotEmpty ?? false) ? p.csrCompanyName : null),
      if (!isClubService &&
          caps.showBeneficiaries &&
          p.directBeneficiaries != null)
        DetailKV('Direct Beneficiaries', _num(p.directBeneficiaries!)),
      if (!isClubService && caps.showManHoursRotarians && p.manHours != null)
        DetailKV('Man Hours', _num(p.manHours!)),
      if (!isClubService &&
          caps.showManHoursRotarians &&
          p.rotariansInvolved != null)
        DetailKV('Rotarians Involved', _num(p.rotariansInvolved!)),
      if (!isClubService &&
          caps.showManHoursRotarians &&
          p.rotaractorsInvolved != null)
        DetailKV('Rotaractors Involved', _num(p.rotaractorsInvolved!)),
    ];

    return ListView(
      padding: EdgeInsets.zero,
      children: [
        DetailHeroGallery(urls: galleryUrls, captions: galleryCaptions),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_partial) ...[
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline,
                          size: 16, color: AppColors.textSecondary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Showing summary only. Full details (documents, '
                          'photos, attendance) could not be loaded.',
                          style: AppFonts.body(
                              fontSize: 11.5, color: AppColors.textSecondary),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],
              DetailHeroTitle(title: p.title),
              DetailHeroChips(chips: chips),
              if (p.description != null && p.description!.isNotEmpty)
                DetailHeroParagraph(text: p.description!),
              DetailHeroInfoCard(rows: rows),
              if (hasDocs) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (showAgenda)
                        _DocLink(
                          label: 'Agenda',
                          name: p.agendaDocumentName ?? 'View Agenda',
                          onTap: () => _openDoc(p.agendaDocument),
                        ),
                      if (hasMinutes) ...[
                        if (showAgenda)
                          const Divider(height: 1, color: AppColors.divider),
                        _DocLink(
                          label: 'Minutes of Meeting',
                          name: p.minutesDocumentName ?? 'View Minutes',
                          onTap: () => _openDoc(p.minutesDocument),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  static NumberFormat get _inrFmt => NumberFormat.decimalPattern(brandNumberLocale());
  String _money(double v, {String? symbol}) {
    final hasFraction = v != v.truncateToDouble();
    final s = hasFraction
        ? _inrFmt.format(v)
        : _inrFmt.format(v.toInt());
    return '${symbol ?? currencySymbolFor(null)}$s';
  }

  String _num(int v) => _inrFmt.format(v);
}

class _DocLink extends StatelessWidget {
  final String label;
  final String name;
  final VoidCallback onTap;
  const _DocLink({
    required this.label,
    required this.name,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.description_outlined,
                  size: 20, color: AppColors.primaryPrime),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label.toUpperCase(),
                    style: AppFonts.body(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary,
                      letterSpacing: 0.4,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primaryPrime,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.open_in_new, size: 18, color: AppColors.primaryPrime),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Form Sheet
// ---------------------------------------------------------------------------
class _ProjectFormScreen extends StatefulWidget {
  final int clubId;
  final String moduleType;
  final int yearId;
  final _Project? existing;
  final VoidCallback onSaved;
  // When set (from the Club Monthly Report flow), the date picker is clamped
  // to the calendar month derived from `frozenYearLabel` ("2025-26") +
  // `frozenMonth` (1-12). Rotary years run Jul → Jun.
  final int? frozenMonth;
  final String? frozenYearLabel;
  // Cross-module "Better fit" carry-over (web parity). When the user switches a
  // project to a different avenue, the source form's filled fields arrive as
  // `switchDraft` and the AI's suggested classification as `switchSuggested`.
  final Map<String, dynamic>? switchDraft;
  final _ClassificationResult? switchSuggested;

  const _ProjectFormScreen({
    required this.clubId,
    required this.moduleType,
    required this.yearId,
    this.existing,
    required this.onSaved,
    this.frozenMonth,
    this.frozenYearLabel,
    this.switchDraft,
    this.switchSuggested,
  });

  // Calendar year that contains `frozenMonth` inside the rotary year window.
  int? get _frozenCalendarYear {
    if (frozenMonth == null || frozenYearLabel == null) return null;
    final parts = frozenYearLabel!.split('-');
    final start = int.tryParse(parts.first);
    if (start == null) return null;
    return frozenMonth! >= 7 ? start : start + 1;
  }

  DateTime? get frozenMonthStart {
    final y = _frozenCalendarYear;
    if (y == null || frozenMonth == null) return null;
    return DateTime(y, frozenMonth!, 1);
  }

  DateTime? get frozenMonthEnd {
    final y = _frozenCalendarYear;
    if (y == null || frozenMonth == null) return null;
    return DateTime(y, frozenMonth! + 1, 1).subtract(const Duration(days: 1));
  }

  @override
  State<_ProjectFormScreen> createState() => _ProjectFormScreenState();
}

class _ProjectFormScreenState extends State<_ProjectFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');
  final _isoFmt = DateFormat('yyyy-MM-dd');

  // Controllers
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();
  final _costCtrl = TextEditingController();
  final _beneficiariesCtrl = TextEditingController();
  final _attendanceCtrl = TextEditingController();
  final _coHostCtrl = TextEditingController();
  final _manHoursCtrl = TextEditingController();
  final _rotariansCtrl = TextEditingController();
  final _rotaractorsCtrl = TextEditingController();
  final _ongoingGroupTitleCtrl = TextEditingController();
  final _otherAofCtrl = TextEditingController();

  // Funding-conditional fields (shown only for Global Grant / CSR funding).
  final _ggNumberCtrl = TextEditingController();
  final _amtSanctionedCtrl = TextEditingController();
  final _amtReceivedCtrl = TextEditingController();
  final _amtSpentCtrl = TextEditingController();
  final _hostCtrl = TextEditingController();
  final _partnerCtrl = TextEditingController();
  final _csrCompanyCtrl = TextEditingController();

  DateTime? _projectDate;
  bool _isJointProject = false;
  bool _saving = false;

  // Currency (Financial & Impact). Defaults to the brand currency; resolved from the club's
  // district on Add and from the saved project on Edit. Web parity: the Project
  // Cost / Grant / CSR amount labels show this currency's symbol.
  String _currency = Brand.current.defaultCurrency;

  // ── Classification AI gate (web parity: ClassificationAssist) ──────────────
  // The Area of Focus dropdown starts LOCKED on Add until the user taps
  // "Auto-Suggest Area of Focus" (which also fires the AI). Unlocked by default
  // on Edit so the saved value stays visible/editable.
  bool _classUnlocked = false;
  // Smart search (module-scoped) over the areas of focus.
  final _classSearchCtrl = TextEditingController();
  Timer? _classSearchDebounce;
  List<_ClassificationResult> _classSearchResults = [];
  bool _classSearching = false;
  bool _showClassSearchResults = false;
  // AI suggestion state. 'idle' | 'loading' | 'error' | 'done'.
  String _aiStatus = 'idle';
  List<_ClassificationResult> _aiMatches = [];
  // Cross-module "Better fit" suggestion (a different avenue suits this project).
  _ClassificationResult? _aiBetter;
  bool _aiNeedText = false; // pressed with too little text to suggest
  String? _aiLastKey; // dedupe on exact title+description
  static const int _kMinAiDesc = 15;

  // Project type: 'one_time' (default) or 'ongoing_repeat'.
  String _projectType = 'one_time';
  _ParentProjectOption? _selectedParent;
  // Ongoing/Repeat sub-mode: 'create' (enter a new group title) or 'existing'
  // (pick an existing parent project). Mirrors the web "Create New / Select
  // Existing" toggle; maps onto the existing ongoingGroupTitle / parentProjectId
  // fields (no new data — only one is populated at a time).
  String _ongoingMode = 'create';

  bool _sendEmail = false;
  String _clubRole = 'Lead';
  static const List<String> _clubRoles = ['Lead', 'CoHost', 'Participant'];
  // Club Service meeting type radios (lowercase strings for backend).
  String? _meetingType;
  static const List<String> _clubMeetingTypes = [
    'regular', 'fellowship', 'bod', 'assembly', 'trust',
  ];

  // Multi-photo gallery (up to 5)
  final List<_ProjectPhoto> _photos = [];
  static const int _maxPhotos = 5;
  bool _uploadingPhoto = false;

  // Agenda document (community/generic legacy field + club_service agenda)
  String? _agendaDocPath;
  String? _agendaDocName;
  bool _uploadingDoc = false;

  // Club Service minutes document
  String? _minutesDocPath;
  String? _minutesDocName;
  bool _uploadingMinutes = false;

  // Club Service attendance %
  final _attendancePctCtrl = TextEditingController();

  // Club Service: total members of the club (used to compute attendance %).
  int _totalMembers = 0;

  // Dropdown data
  List<_DropdownItem> _areasOfFocus = [];
  List<_DropdownItem> _fundings = [];

  // Sentinel value for "Others" free-text entries in dropdowns.
  static const int _kOthersSentinel = -999;

  int? _selectedAreaOfFocusId;
  int? _selectedFundingId;

  bool _loadingDropdowns = true;

  bool get _isEditing => widget.existing != null;

  // Module capabilities derived once from widget.moduleType.
  late final _ModuleCaps _caps = _ModuleCaps.forKey(widget.moduleType);

  // Club Service records meetings/events — its form copy says "Meeting".
  String get _itemNoun => _caps.showMeetingFields ? 'Meeting' : 'Project';

  // Backend moduleId resolved from `/api/modules`. See _resolveModuleId.
  int? _resolvedModuleId;
  int get _moduleId => _resolvedModuleId ?? (_kModuleKeyToId[widget.moduleType] ?? 0);

  // ── Funding classification (mirrors backend ClassifyFunding + web) ──────────
  String _classifyFunding(String? name) {
    if (name == null) return '';
    final n = name.trim().toLowerCase();
    if (n.contains('global grant')) return 'global_grant';
    if (n == 'csr' || n.startsWith('csr ') || n.contains(' csr') || n.contains('(csr)')) {
      return 'csr';
    }
    return '';
  }

  String? get _selectedFundingName {
    for (final f in _fundings) {
      if (f.id == _selectedFundingId) return f.name;
    }
    return null;
  }

  String get _fundingClass => _classifyFunding(_selectedFundingName);
  bool get _showGlobalGrant => _caps.showFunding && _fundingClass == 'global_grant';
  bool get _showCsr => _caps.showFunding && _fundingClass == 'csr';

  String? _nullIfEmpty(String s) => s.trim().isEmpty ? null : s.trim();

  String? _validateFunding() {
    if (_showGlobalGrant) {
      if (_ggNumberCtrl.text.trim().isEmpty) return 'Global Grant Number is required for Global Grant.';
      if (_amtSanctionedCtrl.text.trim().isEmpty) return 'Amount Sanctioned is required for Global Grant.';
      if (_amtReceivedCtrl.text.trim().isEmpty) return 'Amount Received is required for Global Grant.';
      if (_amtSpentCtrl.text.trim().isEmpty) return 'Amount Spent Till Date is required for Global Grant.';
      if (_hostCtrl.text.trim().isEmpty) return 'Host Clubs/Districts is required for Global Grant.';
      if (_partnerCtrl.text.trim().isEmpty) return 'Global Partner Clubs/Districts is required for Global Grant.';
    } else if (_showCsr) {
      if (_csrCompanyCtrl.text.trim().isEmpty) return 'Name of the CSR Company is required for CSR.';
      if (_amtSanctionedCtrl.text.trim().isEmpty) return 'Amount Sanctioned is required for CSR.';
      if (_amtReceivedCtrl.text.trim().isEmpty) return 'Amount Received is required for CSR.';
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    // Classification is unlocked immediately on Edit (saved values must show)
    // and on a cross-module switch (a suggestion is being applied); locked on a
    // fresh Add until the user taps Auto-Suggest.
    _classUnlocked = _isEditing || widget.switchDraft != null;
    // Hydrate a cross-module "Better fit" carry-over draft (before dropdowns
    // load; the suggested classification is applied once they do).
    if (widget.switchDraft != null) {
      _hydrateFromSwitchDraft(widget.switchDraft!);
    }
    _resolveModuleId(_api, widget.moduleType).then((id) {
      if (mounted) setState(() => _resolvedModuleId = id);
    });
    _loadDropdowns();
    // Currency: on a fresh Add, resolve the club's district default (brand
    // currency fallback); on Edit it's prefilled below, and on a switch the draft carries
    // it.
    if (!_isEditing && widget.switchDraft == null && _caps.showCost) {
      _loadClubDefaultCurrency();
    }
    if (_caps.showMeetingFields) {
      _loadTotalMembers();
      _attendanceCtrl.addListener(_recalcAttendancePct);
    }
    // For NEW projects opened from Club Monthly Report, pre-fill the date
    // to the report's month start so the user only has to confirm.
    if (!_isEditing) {
      _projectDate = widget.frozenMonthStart;
    }
    if (_isEditing) {
      final e = widget.existing!;
      _titleCtrl.text = e.title;
      _descCtrl.text = e.description ?? '';
      _locationCtrl.text = e.location ?? '';
      _costCtrl.text = e.projectCost?.toString() ?? '';
      final savedCur = (e.currency ?? '').trim().toUpperCase();
      if (_kCurrencyOptions.any((c) => c.code == savedCur)) _currency = savedCur;
      _beneficiariesCtrl.text = e.directBeneficiaries?.toString() ?? '';
      _coHostCtrl.text = e.coHostName ?? '';
      _projectDate = e.projectDate;
      _isJointProject = e.isJointProject;
      // Load every saved photo (not just the primary) so editing preserves
      // descriptions, ordering, and any non-primary photos in the gallery.
      final loaded = e.photos
          .where((p) => p.path.isNotEmpty)
          .map((p) => _ProjectPhoto(
                path: p.path,
                description: p.description,
                isPrimary: p.isPrimary,
              ))
          .toList();
      if (loaded.isNotEmpty) {
        if (!loaded.any((p) => p.isPrimary)) {
          loaded.first.isPrimary = true;
        }
        _photos.addAll(loaded);
      } else if (e.primaryPhotoPath != null &&
          e.primaryPhotoPath!.isNotEmpty) {
        // Backward-compat: list endpoints that only expose primaryPhotoPath.
        _photos.add(_ProjectPhoto(path: e.primaryPhotoPath!, isPrimary: true));
      }
      _projectType = (e.projectType == 'ongoing_repeat') ? 'ongoing_repeat' : 'one_time';
      _ongoingGroupTitleCtrl.text = e.ongoingGroupTitle ?? '';
      _clubRole = _clubRoles.contains(e.clubRole) ? e.clubRole! : 'Lead';
      // Meeting type: stored lowercase for club_service. Preserve as-is.
      _meetingType = (e.meetingType != null && e.meetingType!.isNotEmpty)
          ? e.meetingType!.toLowerCase()
          : null;
      _attendanceCtrl.text = e.attendance?.toString() ?? '';
      _attendancePctCtrl.text = e.attendancePercentage?.toString() ?? '';
      if (e.agendaDocument != null && e.agendaDocument!.isNotEmpty) {
        _agendaDocPath = e.agendaDocument;
        _agendaDocName = e.agendaDocumentName ?? e.agendaDocument!.split('/').last;
      }
      if (e.minutesDocument != null && e.minutesDocument!.isNotEmpty) {
        _minutesDocPath = e.minutesDocument;
        _minutesDocName = e.minutesDocumentName ?? e.minutesDocument!.split('/').last;
      }
      if (e.parentProjectId != null) {
        _selectedParent = _ParentProjectOption(id: e.parentProjectId!, title: e.ongoingGroupTitle ?? 'Parent Project');
        _ongoingMode = 'existing';
      } else {
        _ongoingMode = 'create';
      }
      _otherAofCtrl.text = e.otherAreaOfFocus ?? '';
      // Funding + conditional fields (preselect dropdown + prefill the relevant
      // Global Grant / CSR block).
      _selectedFundingId = e.fundingId;
      _ggNumberCtrl.text = e.globalGrantNumber ?? '';
      _amtSanctionedCtrl.text = e.amountSanctioned == null ? '' : _numToStr(e.amountSanctioned!);
      _amtReceivedCtrl.text = e.amountReceived == null ? '' : _numToStr(e.amountReceived!);
      _amtSpentCtrl.text = e.amountSpent == null ? '' : _numToStr(e.amountSpent!);
      _hostCtrl.text = e.hostClubsDistricts ?? '';
      _partnerCtrl.text = e.globalPartnerClubsDistricts ?? '';
      _csrCompanyCtrl.text = e.csrCompanyName ?? '';
    }
  }

  // Whole numbers render without a trailing ".0" (amounts are entered as digits).
  String _numToStr(double v) => v == v.truncateToDouble() ? v.toInt().toString() : v.toString();

  Future<void> _loadTotalMembers() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data;
      if (data == null) return;
      final tm = (data['totalMembers'] as num?)?.toInt() ?? 0;
      if (!mounted) return;
      setState(() => _totalMembers = tm);
      _recalcAttendancePct();
    } catch (_) {
      // Silent: totalMembers stays 0; auto-calc just won't run.
    }
  }

  void _recalcAttendancePct() {
    if (_totalMembers <= 0) return;
    final att = int.tryParse(_attendanceCtrl.text.trim());
    if (att == null) return;
    final pct = (att / _totalMembers) * 100;
    final newText = pct.toStringAsFixed(2);
    if (_attendancePctCtrl.text != newText) {
      _attendancePctCtrl.text = newText;
    }
  }

  /// Resolve the default project currency from the club's district (Add only).
  /// Falls back silently to the brand currency when the fetch fails or fields are absent.
  Future<void> _loadClubDefaultCurrency() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data;
      if (data == null || !mounted) return;
      final resolved = _resolveClubDefaultCurrency(
        districtDefaultCurrency: data['districtDefaultCurrency']?.toString(),
        districtCountry: data['districtCountry']?.toString(),
      );
      setState(() => _currency = resolved);
    } catch (_) {
      // The brand currency default stands.
    }
  }

  // ── Classification smart search + AI suggest ───────────────────────────────
  /// Debounced module-scoped search across the areas of focus.
  void _onClassSearchChanged(String v) {
    setState(() => _showClassSearchResults = true);
    _classSearchDebounce?.cancel();
    final term = v.trim();
    if (term.isEmpty || _moduleId == 0) {
      setState(() {
        _classSearchResults = [];
        _classSearching = false;
      });
      return;
    }
    setState(() => _classSearching = true);
    _classSearchDebounce = Timer(const Duration(milliseconds: 300), () async {
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/project-classification/search',
          queryParams: {'q': term, 'moduleId': _moduleId},
          fromJson: (j) => j as List<dynamic>,
        );
        if (!mounted) return;
        setState(() {
          _classSearchResults = (resp.data ?? [])
              .map((e) => _ClassificationResult.fromJson(e as Map<String, dynamic>))
              .toList();
          _classSearching = false;
        });
      } catch (_) {
        if (!mounted) return;
        setState(() {
          _classSearchResults = [];
          _classSearching = false;
        });
      }
    });
  }

  /// Button handler: unlock the section (once) + fire the AI suggest request.
  Future<void> _handleAutoSuggest() async {
    if (!_classUnlocked) setState(() => _classUnlocked = true);
    if (_moduleId == 0) return;
    final t = _titleCtrl.text.trim();
    final d = _descCtrl.text.trim();
    if (t.isEmpty || d.length < _kMinAiDesc) {
      setState(() => _aiNeedText = true); // unlocked; just no AI call
      return;
    }
    setState(() => _aiNeedText = false);
    final key = '$t\n$d';
    if (key == _aiLastKey && _aiStatus == 'done') return; // already suggested
    _aiLastKey = key;
    setState(() => _aiStatus = 'loading');
    try {
      final resp = await _api.post<Map<String, dynamic>>(
        '/api/project-classification/suggest',
        body: {'title': t, 'description': d, 'moduleId': _moduleId},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data ?? const {};
      final matches = (data['matches'] as List<dynamic>? ?? [])
          .map((e) => _ClassificationResult.fromJson(e as Map<String, dynamic>))
          .toList();
      final betterRaw = data['betterModule'];
      final better = (betterRaw is Map<String, dynamic>)
          ? _ClassificationResult.fromJson(betterRaw)
          : null;
      setState(() {
        _aiMatches = matches;
        _aiBetter = better;
        _aiStatus = 'done';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _aiMatches = [];
        _aiBetter = null;
        _aiStatus = 'error';
      });
    }
  }

  /// Whether the AI's cross-module suggestion should surface as a "Better fit"
  /// hint: it must be a supported avenue, DIFFERENT from this form's module, and
  /// carry a real area-of-focus (mirrors the web showBetter gate).
  bool get _showBetter {
    final b = _aiBetter;
    if (b == null) return false;
    final key = _normalizeModuleKey(b.moduleKey);
    return _kSwitchableModuleKeys.contains(key) &&
        key != _normalizeModuleKey(widget.moduleType) &&
        b.areaOfFocusId > 0;
  }

  /// Switch this project to the AI-suggested better-fitting avenue, carrying
  /// over everything the user has filled + the suggested classification. Opens
  /// the target module's form via pushReplacement (web parity: stash draft +
  /// navigate to the target Add page).
  void _switchToBetterModule() {
    final b = _aiBetter;
    if (b == null) return;
    final draft = _buildSwitchDraft();
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => _ProjectFormScreen(
          clubId: widget.clubId,
          moduleType: _normalizeModuleKey(b.moduleKey),
          yearId: widget.yearId,
          onSaved: widget.onSaved,
          frozenMonth: widget.frozenMonth,
          frozenYearLabel: widget.frozenYearLabel,
          switchDraft: draft,
          switchSuggested: b,
        ),
      ),
    );
  }

  /// Flat bag of everything the user has filled (web buildSwitchDraft parity).
  /// The target form reads only the keys its module supports.
  Map<String, dynamic> _buildSwitchDraft() => {
        'title': _titleCtrl.text,
        'description': _descCtrl.text,
        'location': _locationCtrl.text,
        'projectDate': _projectDate?.toIso8601String(),
        'projectCost': _costCtrl.text,
        'currency': _currency,
        'selectedFundingId': _selectedFundingId,
        'directBeneficiaries': _beneficiariesCtrl.text,
        'manHours': _manHoursCtrl.text,
        'rotariansInvolved': _rotariansCtrl.text,
        'rotaractorsInvolved': _rotaractorsCtrl.text,
        'projectType': _projectType,
        'ongoingMode': _ongoingMode,
        'ongoingGroupTitle': _ongoingGroupTitleCtrl.text,
        'isJointProject': _isJointProject,
        'coHostName': _coHostCtrl.text,
        'clubRole': _clubRole,
        'globalGrantNumber': _ggNumberCtrl.text,
        'amountSanctioned': _amtSanctionedCtrl.text,
        'amountReceived': _amtReceivedCtrl.text,
        'amountSpent': _amtSpentCtrl.text,
        'hostClubsDistricts': _hostCtrl.text,
        'globalPartnerClubsDistricts': _partnerCtrl.text,
        'csrCompanyName': _csrCompanyCtrl.text,
        'sendEmail': _sendEmail,
        'photos': [
          for (final p in _photos)
            {'path': p.path, 'description': p.description, 'isPrimary': p.isPrimary},
        ],
      };

  /// Hydrate this form from an incoming cross-module switch draft (web
  /// consumeProjectSwitchDraft parity). Only text/scalar fields + photos; the
  /// suggested classification is applied separately once dropdowns load.
  void _hydrateFromSwitchDraft(Map<String, dynamic> d) {
    String s(String k) => (d[k] ?? '').toString();
    _titleCtrl.text = s('title');
    _descCtrl.text = s('description');
    if (_caps.showLocation) _locationCtrl.text = s('location');
    final dateStr = d['projectDate']?.toString();
    if (dateStr != null && dateStr.isNotEmpty) {
      _projectDate = DateTime.tryParse(dateStr) ?? _projectDate;
    }
    if (_caps.showCost) {
      _costCtrl.text = s('projectCost');
      final cur = (d['currency'] ?? '').toString().trim().toUpperCase();
      if (_kCurrencyOptions.any((c) => c.code == cur)) _currency = cur;
    }
    if (_caps.showBeneficiaries) _beneficiariesCtrl.text = s('directBeneficiaries');
    if (_caps.showManHoursRotarians) {
      _manHoursCtrl.text = s('manHours');
      _rotariansCtrl.text = s('rotariansInvolved');
      _rotaractorsCtrl.text = s('rotaractorsInvolved');
    }
    if (_caps.showOngoingType) {
      final pt = s('projectType');
      if (pt == 'one_time' || pt == 'ongoing_repeat') _projectType = pt;
      final om = s('ongoingMode');
      if (om == 'create' || om == 'existing') _ongoingMode = om;
      _ongoingGroupTitleCtrl.text = s('ongoingGroupTitle');
    }
    if (_caps.showJointProject) {
      _isJointProject = d['isJointProject'] == true;
      _coHostCtrl.text = s('coHostName');
      final role = s('clubRole');
      if (_clubRoles.contains(role)) _clubRole = role;
    }
    if (_caps.showFunding) {
      _selectedFundingId = (d['selectedFundingId'] as num?)?.toInt();
      _ggNumberCtrl.text = s('globalGrantNumber');
      _amtSanctionedCtrl.text = s('amountSanctioned');
      _amtReceivedCtrl.text = s('amountReceived');
      _amtSpentCtrl.text = s('amountSpent');
      _hostCtrl.text = s('hostClubsDistricts');
      _partnerCtrl.text = s('globalPartnerClubsDistricts');
      _csrCompanyCtrl.text = s('csrCompanyName');
    }
    _sendEmail = d['sendEmail'] == true;
    final photos = d['photos'];
    if (photos is List) {
      for (final p in photos) {
        if (p is Map && (p['path']?.toString().isNotEmpty ?? false)) {
          _photos.add(_ProjectPhoto(
            path: p['path'].toString(),
            description: (p['description'] ?? '').toString(),
            isPrimary: p['isPrimary'] == true,
          ));
        }
      }
    }
  }

  /// Apply a picked classification (search result or AI suggestion): set its
  /// Area of Focus.
  void _applyClassificationResult(_ClassificationResult r) {
    // Collapse the search UI immediately.
    setState(() {
      _classSearchCtrl.clear();
      _classSearchResults = [];
      _showClassSearchResults = false;
    });

    bool isOthersName(String? n) => (n ?? '').trim().toLowerCase() == 'others';

    // ── Area of Focus ──
    // The dropdown strips any backend row named "Others" and renders its own
    // synthetic Others (the _kOthersSentinel free-text trigger). So an AI match
    // whose area is "Others" — or whose id isn't in the loaded list because it
    // was stripped — must resolve to the sentinel, not be discarded. Selecting
    // the sentinel reveals the "Other Area of Focus" text field for the user.
    final aofIsOthers = isOthersName(r.areaOfFocusName) ||
        !_areasOfFocus.any((a) => a.id == r.areaOfFocusId);
    setState(() => _selectedAreaOfFocusId =
        aofIsOthers ? _kOthersSentinel : r.areaOfFocusId);
  }

  Future<void> _pickAndUploadPhoto() async {
    if (_photos.length >= _maxPhotos) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: const Text('Maximum $_maxPhotos photos allowed'), backgroundColor: AppColors.warning),
      );
      return;
    }
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      // Free-form crop before upload (no fixed ratio).
      final cropped = await cropImageFree(picked.path, title: 'Crop Image');
      if (cropped == null) return;
      setState(() => _uploadingPhoto = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/upload',
        filePath: cropped,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      // Upload endpoint may return either `path` or `imagePath` depending on
      // backend version — accept either.
      final path = (resp.data?['imagePath'] as String?) ??
          (resp.data?['path'] as String?) ??
          '';
      if (path.isEmpty) throw Exception('Upload returned empty path');
      setState(() {
        final isFirst = _photos.isEmpty;
        _photos.add(_ProjectPhoto(path: path, isPrimary: isFirst));
        _uploadingPhoto = false;
      });
    } catch (e) {
      setState(() => _uploadingPhoto = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Photo upload failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _markPrimary(int index) {
    setState(() {
      for (var i = 0; i < _photos.length; i++) {
        _photos[i].isPrimary = (i == index);
      }
    });
  }

  void _removePhoto(int index) {
    setState(() {
      final wasPrimary = _photos[index].isPrimary;
      _photos.removeAt(index);
      if (wasPrimary && _photos.isNotEmpty) _photos.first.isPrimary = true;
    });
  }

  Future<void> _pickAndUploadAgendaDoc() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'doc', 'docx'],
      );
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() => _uploadingDoc = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/upload-document',
        filePath: f.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      setState(() {
        _agendaDocPath = (resp.data?['path'] as String?) ?? '';
        _agendaDocName = (resp.data?['fileName'] as String?) ?? f.name;
        _uploadingDoc = false;
      });
    } catch (e) {
      setState(() => _uploadingDoc = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Document upload failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  /// Picks & uploads a Club Service "Minutes" PDF via the shared document
  /// upload endpoint. Mirrors the agenda flow but writes into `_minutesDoc*`.
  Future<void> _pickAndUploadMinutesDoc() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
      );
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() => _uploadingMinutes = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/upload-document',
        filePath: f.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      setState(() {
        _minutesDocPath = (resp.data?['path'] as String?) ?? '';
        _minutesDocName = (resp.data?['fileName'] as String?) ?? f.name;
        _uploadingMinutes = false;
      });
    } catch (e) {
      setState(() => _uploadingMinutes = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Minutes upload failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  @override
  void dispose() {
    if (_caps.showMeetingFields) {
      _attendanceCtrl.removeListener(_recalcAttendancePct);
    }
    _classSearchDebounce?.cancel();
    for (final c in [
      _titleCtrl, _descCtrl, _locationCtrl, _costCtrl, _beneficiariesCtrl,
      _attendanceCtrl, _attendancePctCtrl, _coHostCtrl, _manHoursCtrl,
      _rotariansCtrl, _rotaractorsCtrl, _ongoingGroupTitleCtrl, _otherAofCtrl,
      _classSearchCtrl,
      _ggNumberCtrl, _amtSanctionedCtrl, _amtReceivedCtrl, _amtSpentCtrl,
      _hostCtrl, _partnerCtrl, _csrCompanyCtrl,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadDropdowns() async {
    setState(() => _loadingDropdowns = true);
    // Club Service has no classification / funding dropdowns. Skip the fetch
    // but still finish the loading state so the form renders immediately.
    if (!_caps.showClassification && !_caps.showFunding) {
      setState(() => _loadingDropdowns = false);
      return;
    }
    try {
      final moduleId = _moduleId;
      List<_DropdownItem> aof = [];
      List<_DropdownItem> funding = [];
      if (_caps.showClassification) {
        final r = await _api.get<List<dynamic>>('/api/area-of-focus',
            queryParams: {'moduleId': moduleId},
            fromJson: (j) => j as List<dynamic>);
        aof = _usableOptions((r.data ?? [])
            .map((e) => _DropdownItem.fromJson(e as Map<String, dynamic>))
            .toList());
      }
      if (_caps.showFunding) {
        final r = await _api.get<List<dynamic>>('/api/funding',
            fromJson: (j) => j as List<dynamic>);
        // Funding is left unfiltered: it has a real "Others" option (used by
        // _classifyFunding), no synthetic Others, and is preselected on edit
        // (filtering could drop a now-inactive saved funding and break the form).
        funding = (r.data ?? [])
            .map((e) => _DropdownItem.fromJson(e as Map<String, dynamic>))
            .toList();
      }
      setState(() {
        _areasOfFocus = aof;
        _fundings = funding;
        _loadingDropdowns = false;
      });
      // On edit, preselect the saved Area of Focus (it isn't set in initState
      // because the options must be loaded first).
      if (_isEditing) {
        _preselectClassification();
      } else if (widget.switchSuggested != null && _caps.showClassification) {
        // Cross-module switch: preselect the AI's betterModule Area of Focus.
        _applyClassificationResult(widget.switchSuggested!);
      }
    } catch (_) {
      setState(() => _loadingDropdowns = false);
    }
  }

  /// Restore the saved Area of Focus when editing: its id, or the Others
  /// sentinel when an `otherAreaOfFocus` free-text value was saved. The id is
  /// only set if present in the (active) loaded list, so a since-deactivated
  /// option can't crash the dropdown.
  void _preselectClassification() {
    if (!_caps.showClassification) return;
    final e = widget.existing!;
    if ((e.otherAreaOfFocus ?? '').isNotEmpty) {
      setState(() => _selectedAreaOfFocusId = _kOthersSentinel);
      return;
    }
    final aofId = e.areaOfFocusId;
    if (aofId == null || !_areasOfFocus.any((a) => a.id == aofId)) return;
    setState(() => _selectedAreaOfFocusId = aofId);
  }

  Future<void> _pickDate() async {
    final monthStart = widget.frozenMonthStart;
    final monthEnd = widget.frozenMonthEnd;
    // Projects can only be dated today or in the past — no future dates.
    final today = DateTime.now();
    final firstDate = monthStart ?? DateTime(2000);
    // Cap at the earlier of "today" and any frozen month-end, but never let the
    // upper bound fall before firstDate (would crash showDatePicker).
    DateTime lastDate = today;
    if (monthEnd != null && monthEnd.isBefore(lastDate)) lastDate = monthEnd;
    if (lastDate.isBefore(firstDate)) lastDate = firstDate;
    DateTime initial = _projectDate ?? monthStart ?? today;
    if (initial.isBefore(firstDate)) initial = firstDate;
    if (initial.isAfter(lastDate)) initial = lastDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: firstDate,
      lastDate: lastDate,
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _projectDate = picked);
  }

  Future<void> _pickParentProject() async {
    final moduleId = _moduleId;
    final result = await showModalBottomSheet<_ParentProjectOption>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _ParentProjectPicker(
        api: _api,
        clubId: widget.clubId,
        moduleId: moduleId,
        // Scope the existing-project search to the year this project is being
        // filed under (defaults to the current year) — parents from other years
        // shouldn't show up.
        yearId: widget.yearId,
      ),
    );
    if (result != null) setState(() => _selectedParent = result);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all required fields')),
      );
      return;
    }

    // Manual checks for non-Form widgets that can't use validators.
    if (_projectDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Please select $_itemNoun Date')),
      );
      return;
    }
    if (_caps.showMeetingFields) {
      if (_meetingType == null || _meetingType!.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select Meeting Type')),
        );
        return;
      }
      // Agenda and Minutes of Meeting are optional — no upload is required.
      // Attendance cap removed (2026-06-12 product decision) — admins may record
      // attendance exceeding the member/BOD count; the backend no longer rejects it.
    }
    if (_photos.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('At least 1 photo is required')),
      );
      return;
    }
    // Funding-conditional required fields (Global Grant / CSR).
    final fundingErr = _validateFunding();
    if (fundingErr != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(fundingErr), backgroundColor: AppColors.error),
      );
      return;
    }

    final int beneficiaries = int.tryParse(_beneficiariesCtrl.text) ?? 0;

    setState(() => _saving = true);

    // "Others" normalization: send null id when sentinel selected.
    final int? aofIdForBody =
        (_selectedAreaOfFocusId != null && _selectedAreaOfFocusId != _kOthersSentinel)
            ? _selectedAreaOfFocusId
            : null;

    // Start with base fields common to every module.
    final body = <String, dynamic>{
      'title': _titleCtrl.text.trim(),
      'description': _descCtrl.text.trim(),
      // Numeric moduleId for backend; moduleType string retained for compatibility.
      'moduleId': _moduleId,
      'moduleType': widget.moduleType,
      'yearId': widget.yearId,
      'sendEmail': _sendEmail,
      'photos': [
        for (var i = 0; i < _photos.length; i++)
          {
            'imagePath': _photos[i].path,
            'description': _photos[i].description,
            'isPrimary': _photos[i].isPrimary,
            'sortOrder': i,
          }
      ],
      if (_projectDate != null) 'projectDate': _isoFmt.format(_projectDate!),
      if (_caps.showCost && _costCtrl.text.isNotEmpty)
        'projectCost': double.tryParse(_costCtrl.text),
      if (_caps.showCost) 'currency': _currency,
    };

    if (_caps.showLocation) {
      body['location'] = _locationCtrl.text.trim();
    }

    // Classification (Area of Focus).
    if (_caps.showClassification) {
      body['areaOfFocusId'] = aofIdForBody;
      body['otherAreaOfFocus'] = _selectedAreaOfFocusId == _kOthersSentinel
          ? _otherAofCtrl.text.trim()
          : null;
    }

    // Project type: ongoing/repeat only for modules that show it, else one_time.
    if (_caps.showOngoingType) {
      final isOngoing = _projectType == 'ongoing_repeat';
      body['projectType'] = _projectType;
      // Create New → send the new group title; Select Existing → send the
      // chosen parent id. Only the active mode's field is sent.
      body['parentProjectId'] =
          (isOngoing && _ongoingMode == 'existing') ? _selectedParent?.id : null;
      body['ongoingGroupTitle'] = (isOngoing && _ongoingMode == 'create')
          ? (_ongoingGroupTitleCtrl.text.trim().isEmpty
              ? null
              : _ongoingGroupTitleCtrl.text.trim())
          : null;
    } else {
      body['projectType'] = 'one_time';
    }

    // Joint project (coHost + clubRole) only where allowed.
    if (_caps.showJointProject) {
      body['isJointProject'] = _isJointProject;
      body['clubRole'] = _clubRole;
      if (_isJointProject && _coHostCtrl.text.isNotEmpty) {
        body['coHostName'] = _coHostCtrl.text.trim();
      }
    } else {
      body['isJointProject'] = false;
    }

    // Beneficiaries.
    if (_caps.showBeneficiaries) {
      if (_beneficiariesCtrl.text.isNotEmpty) {
        body['directBeneficiaries'] = beneficiaries;
      }
    } else {
      body['directBeneficiaries'] = null;
    }

    // Funding.
    if (_caps.showFunding && _selectedFundingId != null) {
      body['fundingId'] = _selectedFundingId;
      // Funding-conditional fields — only the ones relevant to the selected
      // funding; the backend nulls non-applicable ones too.
      body['globalGrantNumber'] = _showGlobalGrant ? _nullIfEmpty(_ggNumberCtrl.text) : null;
      body['amountSanctioned'] =
          (_showGlobalGrant || _showCsr) ? num.tryParse(_amtSanctionedCtrl.text.trim()) : null;
      body['amountReceived'] =
          (_showGlobalGrant || _showCsr) ? num.tryParse(_amtReceivedCtrl.text.trim()) : null;
      body['amountSpent'] = _showGlobalGrant ? num.tryParse(_amtSpentCtrl.text.trim()) : null;
      body['hostClubsDistricts'] = _showGlobalGrant ? _nullIfEmpty(_hostCtrl.text) : null;
      body['globalPartnerClubsDistricts'] = _showGlobalGrant ? _nullIfEmpty(_partnerCtrl.text) : null;
      body['csrCompanyName'] = _showCsr ? _nullIfEmpty(_csrCompanyCtrl.text) : null;
    }

    // Man hours + rotarian counts.
    if (_caps.showManHoursRotarians) {
      body['manHours'] = int.tryParse(_manHoursCtrl.text) ?? 0;
      body['rotariansInvolved'] = int.tryParse(_rotariansCtrl.text) ?? 0;
      body['rotaractorsInvolved'] = int.tryParse(_rotaractorsCtrl.text) ?? 0;
    }

    // Club Service meeting block (lean: no classification/funding/etc).
    if (_caps.showMeetingFields) {
      body['meetingType'] = _meetingType;
      if (_agendaDocPath != null && _agendaDocPath!.isNotEmpty) {
        body['agendaDocument'] = _agendaDocPath;
      }
      if (_minutesDocPath != null && _minutesDocPath!.isNotEmpty) {
        body['minutesDocument'] = _minutesDocPath;
      }
      if (_attendanceCtrl.text.isNotEmpty) {
        body['attendance'] = int.tryParse(_attendanceCtrl.text);
      }
      if (_attendancePctCtrl.text.isNotEmpty) {
        body['attendancePercentage'] = double.tryParse(_attendancePctCtrl.text);
      }
    } else if (_caps.showAgendaDocument) {
      // Legacy agenda field retained for non-club modules that still support it
      // (community projects opt out via showAgendaDocument=false).
      if (_agendaDocPath != null && _agendaDocPath!.isNotEmpty) {
        body['agendaDocument'] = _agendaDocPath;
      }
    }

    try {
      if (_isEditing) {
        // Year-scoped update. The project's own year takes precedence over the
        // form's year context. If the edited date crosses into another rotary
        // year the server returns 409 and we confirm a move (new id in target).
        final yearId = widget.existing!.yearId ?? widget.yearId;
        final id = widget.existing!.id;
        try {
          await _api.put('/api/clubs/${widget.clubId}/projects/$yearId/$id', body: body);
        } on ApiException catch (e) {
          if (e.statusCode != 409) rethrow;
          if (!mounted) return;
          final confirmed = await ConfirmationDialog.show(
            context,
            title: 'Move project?',
            message: e.message,
            confirmLabel: 'Move',
          );
          if (!confirmed) {
            if (mounted) setState(() => _saving = false);
            return;
          }
          await _api.post('/api/clubs/${widget.clubId}/projects/$yearId/$id/move', body: body);
        }
      } else {
        await _api.post<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/projects',
          body: body,
          fromJson: (j) => j is Map<String, dynamic> ? j : <String, dynamic>{},
        );
      }

      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? '$_itemNoun updated' : '$_itemNoun created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Save failed: $e';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.muted,
      appBar: CustomAppBar(
        title: _isEditing ? 'Edit $_itemNoun' : 'New $_itemNoun',
      ),
      body: _loadingDropdowns
          ? const LoadingWidget()
          : Form(
              key: _formKey,
              // Validate only on Save (_formKey.currentState!.validate()), NOT on
              // every keystroke: onUserInteraction lit up ALL required fields red
              // the moment any one field was touched — and the classification
              // dropdowns are locked until Auto-Suggest, so their "required"
              // errors couldn't even be cleared yet.
              autovalidateMode: AutovalidateMode.disabled,
              // SingleChildScrollView + Column (not ListView): a ListView lazily
              // disposes off-screen fields, which deregisters them from the Form
              // — so validate() skipped Title/Description once the user scrolled
              // to the Save button, letting empty projects save. Building all
              // fields eagerly keeps every validator registered.
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                child: Builder(builder: (context) {
                  // Build the section list per module, then render each as a
                  // numbered accent card. Fields/validators are unchanged —
                  // only the visual grouping (web-parity) differs.
                  final specs = <_Section>[];

                  // Project Type (community + public_image only) — pill design,
                  // mirroring the web. Joint-project question lives here too
                  // (showJointProject coincides with showOngoingType).
                  if (_caps.showOngoingType) {
                    specs.add(_Section(Icons.layers_outlined, 'Project Type', [
                      Text('Select Project Type *', style: AppTextStyles.label),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 10,
                        runSpacing: 8,
                        children: [
                          _RadioPill(
                            label: 'One Time Project',
                            selected: _projectType == 'one_time',
                            onTap: () => setState(() => _projectType = 'one_time'),
                          ),
                          _RadioPill(
                            label: 'Ongoing / Repeat Project',
                            selected: _projectType == 'ongoing_repeat',
                            onTap: () => setState(() => _projectType = 'ongoing_repeat'),
                          ),
                        ],
                      ),
                      if (_projectType == 'ongoing_repeat') ...[
                        const SizedBox(height: 16),
                        Text('Ongoing/Repeat Type *', style: AppTextStyles.label),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 10,
                          runSpacing: 8,
                          children: [
                            _RadioPill(
                              label: 'Create New',
                              selected: _ongoingMode == 'create',
                              // Switching to Create New drops any chosen parent.
                              onTap: () => setState(() {
                                _ongoingMode = 'create';
                                _selectedParent = null;
                              }),
                            ),
                            _RadioPill(
                              label: 'Select Existing',
                              selected: _ongoingMode == 'existing',
                              // Switching to Select Existing clears the new title.
                              onTap: () => setState(() {
                                _ongoingMode = 'existing';
                                _ongoingGroupTitleCtrl.clear();
                              }),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        if (_ongoingMode == 'create')
                          CustomTextField(
                            label: 'Title of Ongoing/Repeat Project *',
                            controller: _ongoingGroupTitleCtrl,
                            hint: 'e.g. Monthly Blood Donation Drive',
                          )
                        else ...[
                          Text('Search Existing Project *', style: AppTextStyles.label),
                          const SizedBox(height: 6),
                          InkWell(
                            onTap: _pickParentProject,
                            borderRadius: BorderRadius.circular(8),
                            child: InputDecorator(
                              decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                              child: Row(
                                children: [
                                  const Icon(Icons.search, size: 16, color: AppColors.textSecondary),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      _selectedParent?.title ?? 'Type to search existing project…',
                                      style: _selectedParent != null
                                          ? AppTextStyles.body
                                          : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  if (_selectedParent != null)
                                    IconButton(
                                      icon: const Icon(Icons.close, size: 16),
                                      onPressed: () => setState(() => _selectedParent = null),
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ],
                      // Joint project question (Yes/No pills).
                      if (_caps.showJointProject) ...[
                        const SizedBox(height: 16),
                        Text('Is this a joint project with any other Rotary Club / Organization? *',
                            style: AppTextStyles.label),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 10,
                          runSpacing: 8,
                          children: [
                            _RadioPill(
                              label: 'Yes',
                              selected: _isJointProject,
                              onTap: () => setState(() => _isJointProject = true),
                            ),
                            _RadioPill(
                              label: 'No',
                              selected: !_isJointProject,
                              onTap: () => setState(() => _isJointProject = false),
                            ),
                          ],
                        ),
                        if (_isJointProject) ...[
                          const SizedBox(height: 12),
                          CustomTextField(
                            label: 'Co-host Name',
                            controller: _coHostCtrl,
                            hint: 'Enter co-host club name',
                            prefixIcon: Icons.group_work_outlined,
                          ),
                          const SizedBox(height: 8),
                          Text('Club Role', style: AppTextStyles.label),
                          const SizedBox(height: 6),
                          DropdownButtonFormField<String>(
                            value: _clubRole,
                            decoration: const InputDecoration(
                                contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                            style: AppTextStyles.body,
                            isExpanded: true,
                            items: _clubRoles
                                .map((r) => DropdownMenuItem<String>(value: r, child: Text(r)))
                                .toList(),
                            onChanged: (v) => setState(() => _clubRole = v ?? 'Lead'),
                          ),
                        ],
                      ],
                    ]));
                  }

                  // Project / Meeting Details — Title, Description, Location, Date
                  specs.add(_Section(
                    Icons.description_outlined,
                    _caps.showMeetingFields ? 'Meeting Details' : 'Project Details',
                    [
                      CustomTextField(
                        label: 'Title *',
                        controller: _titleCtrl,
                        hint: 'Enter ${_itemNoun.toLowerCase()} title',
                        validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        label: 'Description *',
                        controller: _descCtrl,
                        hint: 'Enter description',
                        maxLines: 3,
                        // Multiline: Enter inserts a newline instead of jumping to
                        // the next field (default TextInputAction.next blocked it).
                        keyboardType: TextInputType.multiline,
                        textInputAction: TextInputAction.newline,
                        validator: (v) => (v == null || v.trim().isEmpty) ? 'Description is required' : null,
                      ),
                      if (_caps.showLocation) ...[
                        const SizedBox(height: 12),
                        CustomTextField(
                          label: 'Location *',
                          controller: _locationCtrl,
                          hint: 'Enter location',
                          prefixIcon: Icons.location_on_outlined,
                          validator: (v) => (v == null || v.trim().isEmpty) ? 'Location is required' : null,
                        ),
                      ],
                      const SizedBox(height: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('$_itemNoun Date *', style: AppTextStyles.label),
                          const SizedBox(height: 6),
                          InkWell(
                            onTap: _pickDate,
                            borderRadius: BorderRadius.circular(8),
                            child: InputDecorator(
                              decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                              child: Row(
                                children: [
                                  const Icon(Icons.calendar_today_outlined, size: 16, color: AppColors.textSecondary),
                                  const SizedBox(width: 10),
                                  Text(
                                    _projectDate != null ? _displayDf.format(_projectDate!) : 'Select date',
                                    style: _projectDate != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ));

                  // Financial & Impact — cost / beneficiaries / man-hours
                  if (_caps.showBeneficiaries || _caps.showCost || _caps.showManHoursRotarians) {
                    final curSym = _currencySymbol(_currency);
                    specs.add(_Section(Icons.payments_outlined, 'Financial & Impact', [
                      if (_caps.showCost) ...[
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Currency *', style: AppTextStyles.label),
                            const SizedBox(height: 6),
                            DropdownButtonFormField<String>(
                              value: _currency,
                              decoration: const InputDecoration(
                                  contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                              style: AppTextStyles.body,
                              isExpanded: true,
                              items: _kCurrencyOptions
                                  .map((c) => DropdownMenuItem<String>(
                                        value: c.code, child: Text(c.label)))
                                  .toList(),
                              onChanged: (v) => setState(() => _currency = v ?? Brand.current.defaultCurrency),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (_caps.showBeneficiaries)
                        Row(
                          children: [
                            Expanded(
                              child: CustomTextField(
                                label: 'Project Cost ($curSym) *',
                                controller: _costCtrl,
                                hint: '0.00',
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Project Cost is required' : null,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: CustomTextField(
                                label: 'Direct Beneficiaries *',
                                controller: _beneficiariesCtrl,
                                hint: '0',
                                keyboardType: TextInputType.number,
                                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Direct Beneficiaries is required' : null,
                              ),
                            ),
                          ],
                        )
                      else if (_caps.showCost)
                        CustomTextField(
                          label: 'Project Cost ($curSym)',
                          controller: _costCtrl,
                          hint: '0.00',
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                        ),
                      if ((_caps.showBeneficiaries || _caps.showCost) && _caps.showManHoursRotarians)
                        const SizedBox(height: 12),
                      if (_caps.showManHoursRotarians)
                        Row(
                          children: [
                            Expanded(
                              child: CustomTextField(
                                label: 'Man Hours *',
                                controller: _manHoursCtrl,
                                hint: '0',
                                keyboardType: TextInputType.number,
                                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Man Hours is required' : null,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: CustomTextField(
                                label: 'Rotarians *',
                                controller: _rotariansCtrl,
                                hint: '0',
                                keyboardType: TextInputType.number,
                                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Rotarians is required' : null,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: CustomTextField(
                                label: 'Rotaractors *',
                                controller: _rotaractorsCtrl,
                                hint: '0',
                                keyboardType: TextInputType.number,
                                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Rotaractors is required' : null,
                              ),
                            ),
                          ],
                        ),
                    ]));
                  }

                  // Club Service: Meeting Type / Documents / Attendance
                  if (_caps.showMeetingFields) {
                    specs.add(_Section(Icons.event_note_outlined, 'Meeting Type', [
                      Text('Meeting Type *', style: AppTextStyles.label),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 10,
                        runSpacing: 8,
                        children: _clubMeetingTypes
                            .map((t) => _RadioPill(
                                  label: '${t[0].toUpperCase()}${t.substring(1)}',
                                  selected: _meetingType == t,
                                  onTap: () => setState(() => _meetingType = t),
                                ))
                            .toList(),
                      ),
                    ]));
                    specs.add(_Section(Icons.upload_file_outlined, 'Documents', [
                      Text('Agenda', style: AppTextStyles.label),
                      const SizedBox(height: 6),
                      OutlinedButton.icon(
                        icon: _uploadingDoc
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.picture_as_pdf_outlined, size: 18),
                        label: Text(_uploadingDoc
                            ? 'Uploading...'
                            : (_agendaDocName ?? 'Pick Agenda PDF')),
                        onPressed: _uploadingDoc ? null : _pickAndUploadAgendaDoc,
                      ),
                      const SizedBox(height: 12),
                      Text('Minutes of Meeting', style: AppTextStyles.label),
                      const SizedBox(height: 6),
                      OutlinedButton.icon(
                        icon: _uploadingMinutes
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.picture_as_pdf_outlined, size: 18),
                        label: Text(_uploadingMinutes
                            ? 'Uploading...'
                            : (_minutesDocName ?? 'Pick Minutes PDF')),
                        onPressed: _uploadingMinutes ? null : _pickAndUploadMinutesDoc,
                      ),
                    ]));
                    specs.add(_Section(Icons.groups_outlined, 'Attendance', [
                      CustomTextField(
                        label: 'Attendance (Total Members: $_totalMembers) *',
                        controller: _attendanceCtrl,
                        hint: 'Number of attendees',
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        validator: (v) => (v == null || v.trim().isEmpty) ? 'Attendance is required' : null,
                      ),
                      const SizedBox(height: 12),
                      CustomTextField(
                        label: 'Attendance (%) *',
                        controller: _attendancePctCtrl,
                        hint: 'Auto-calculated',
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                      ),
                    ]));
                  }

                  // Classification: Area of Focus
                  if (_caps.showClassification) {
                    specs.add(_Section(Icons.track_changes_outlined, 'Classification', [
                      _buildClassificationAssist(),
                      const SizedBox(height: 12),
                      // AoF dropdown — greyed & non-interactive until the
                      // section is unlocked via Auto-Suggest (web parity).
                      Opacity(
                        opacity: _classUnlocked ? 1.0 : 0.5,
                        child: IgnorePointer(
                          ignoring: !_classUnlocked,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                      _buildDropdown(
                        label: 'Area of Focus *',
                        value: _selectedAreaOfFocusId,
                        items: _areasOfFocus,
                        includeOthers: true,
                        isRequired: true,
                        onChanged: (v) => setState(() => _selectedAreaOfFocusId = v),
                      ),
                      if (_selectedAreaOfFocusId == _kOthersSentinel) ...[
                        const SizedBox(height: 8),
                        CustomTextField(
                          label: 'Other Area of Focus',
                          controller: _otherAofCtrl,
                          hint: 'Specify',
                        ),
                      ],
                            ],
                          ),
                        ),
                      ),
                    ]));
                  }

                  // Funding (all except club_service)
                  if (_caps.showFunding) {
                    specs.add(_Section(Icons.account_balance_outlined, 'Funding', [
                      _buildDropdown(
                        label: 'Funding *',
                        value: _selectedFundingId,
                        items: _fundings,
                        isRequired: true,
                        // Changing funding wipes the conditional fields so
                        // stale Global Grant/CSR values aren't carried over.
                        onChanged: (v) => setState(() {
                          _selectedFundingId = v;
                          _ggNumberCtrl.clear();
                          _amtSanctionedCtrl.clear();
                          _amtReceivedCtrl.clear();
                          _amtSpentCtrl.clear();
                          _hostCtrl.clear();
                          _partnerCtrl.clear();
                          _csrCompanyCtrl.clear();
                        }),
                      ),
                      const SizedBox(height: 8),
                      ..._buildFundingConditional(),
                    ]));
                  }

                  // (Joint Project is rendered inside the Project Type section
                  // above — web parity. showJointProject coincides with
                  // showOngoingType, so no standalone card is needed.)

                  // Photos (all modules) + legacy agenda document
                  specs.add(_Section(Icons.photo_library_outlined, 'Photos', [
                    Text('Photos * (1 mandatory, up to $_maxPhotos)', style: AppTextStyles.label),
                    const SizedBox(height: 6),
                    _PhotoGallery(
                      photos: _photos,
                      uploading: _uploadingPhoto,
                      onAdd: _photos.length >= _maxPhotos ? null : _pickAndUploadPhoto,
                      onSetPrimary: _markPrimary,
                      onRemove: _removePhoto,
                    ),
                    if (!_caps.showMeetingFields && _caps.showAgendaDocument) ...[
                      const SizedBox(height: 16),
                      Text('Agenda Document', style: AppTextStyles.label),
                      const SizedBox(height: 6),
                      OutlinedButton.icon(
                        icon: _uploadingDoc
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.description_outlined, size: 18),
                        label: Text(_uploadingDoc
                            ? 'Uploading...'
                            : (_agendaDocName ?? 'Pick Agenda Document (optional)')),
                        onPressed: _uploadingDoc ? null : _pickAndUploadAgendaDoc,
                      ),
                    ],
                  ]));

                  // Notification (all modules)
                  specs.add(_Section(Icons.notifications_outlined, 'Notification', [
                    SwitchListTile.adaptive(
                      value: _sendEmail,
                      onChanged: (v) => setState(() => _sendEmail = v),
                      title: Text('Send Email notification', style: AppTextStyles.bodyMedium),
                      activeColor: AppColors.primary,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                  ]));

                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Info banner (web parity).
                      Container(
                        margin: const EdgeInsets.only(bottom: 16),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.lightBorder),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.info_outline, size: 16, color: AppColors.primary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Fill in the details below. Fields marked * are required.',
                                style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                              ),
                            ),
                          ],
                        ),
                      ),
                      for (var i = 0; i < specs.length; i++)
                        _SectionCard(
                          number: i + 1,
                          icon: specs[i].icon,
                          title: specs[i].title,
                          accent: _kSectionAccents[i % _kSectionAccents.length],
                          children: specs[i].children,
                        ),
                    ],
                  );
                }),
              ),
            ),
      bottomNavigationBar: _loadingDropdowns
          ? null
          : Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: AppColors.lightBorder)),
              ),
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _saving ? null : () => Navigator.of(context).maybePop(),
                      icon: const Icon(Icons.close, size: 18),
                      label: const Text('Cancel'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.textSecondary,
                        side: const BorderSide(color: AppColors.lightBorder),
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.save_outlined, size: 18),
                      label: Text(_saving ? 'Saving…' : (_isEditing ? 'Update' : 'Create')),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _fundingAmountField(String label, TextEditingController ctrl) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: CustomTextField(
        label: label,
        controller: ctrl,
        hint: '0',
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      ),
    );
  }

  Widget _fundingTextField(String label, TextEditingController ctrl, String hint) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: CustomTextField(label: label, controller: ctrl, hint: hint),
    );
  }

  /// Global Grant / CSR conditional fields, shown based on the selected funding.
  List<Widget> _buildFundingConditional() {
    final sym = _currencySymbol(_currency);
    if (_showGlobalGrant) {
      return [
        _fundingAmountField('Global Grant Number *', _ggNumberCtrl),
        _fundingAmountField('Amount Sanctioned ($sym) *', _amtSanctionedCtrl),
        _fundingAmountField('Amount Received ($sym) *', _amtReceivedCtrl),
        _fundingAmountField('Amount spent till date ($sym) *', _amtSpentCtrl),
        _fundingTextField('Host Clubs/Districts *', _hostCtrl, 'e.g., RC Pune, RC Mumbai'),
        _fundingTextField('Global Partner Clubs/Districts *', _partnerCtrl, 'e.g., RC Tokyo'),
      ];
    }
    if (_showCsr) {
      return [
        _fundingTextField('Name of the CSR Company *', _csrCompanyCtrl, 'e.g., ABC Industries Pvt Ltd'),
        _fundingAmountField('Amount Sanctioned ($sym) *', _amtSanctionedCtrl),
        _fundingAmountField('Amount Received ($sym) *', _amtReceivedCtrl),
      ];
    }
    return const [];
  }

  // ── Classification AI-assist widget (web parity: ClassificationAssist) ─────
  static const Color _kViolet = AppColors.accentBlue;
  static const Color _kVioletBg = AppColors.muted;
  static const Color _kVioletBorder = AppColors.chart5;

  Widget _buildClassificationAssist() {
    final loading = _aiStatus == 'loading';
    final searchText = _classSearchCtrl.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Auto-Suggest button: prominent dashed card while locked, compact once unlocked.
        if (!_classUnlocked)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _kVioletBg,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _kVioletBorder),
            ),
            child: Column(
              children: [
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: loading ? null : _handleAutoSuggest,
                    icon: loading
                        ? const SizedBox(
                            width: 16, height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.auto_awesome, size: 18),
                    label: const Text('Auto-Suggest Area of Focus'),
                    style: ElevatedButton.styleFrom(
                        backgroundColor: _kViolet, foregroundColor: Colors.white),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.lock_outline, size: 12, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        'Click to get AI suggestions and unlock the search & dropdown below.',
                        style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
                if (_aiNeedText) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Add a title and a longer description first for AI suggestions: the fields below are now unlocked.',
                    style: AppTextStyles.caption.copyWith(color: AppColors.warning),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          )
        else
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: loading ? null : _handleAutoSuggest,
                  icon: loading
                      ? const SizedBox(
                          width: 14, height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: _kViolet))
                      : const Icon(Icons.auto_awesome, size: 16),
                  label: const Text('Auto-Suggest Area of Focus'),
                  style: OutlinedButton.styleFrom(
                      foregroundColor: _kViolet,
                      side: const BorderSide(color: _kVioletBorder),
                      visualDensity: VisualDensity.compact),
                ),
              ),
              // Hint on its own full-width line below the button (a Row squeezed it
              // into a narrow column that wrapped mid-word).
              if (_aiStatus == 'error') ...[
                const SizedBox(height: 6),
                Text('AI unavailable: use the search or dropdown.',
                    style: AppTextStyles.caption.copyWith(color: AppColors.error)),
              ] else if (_aiNeedText) ...[
                const SizedBox(height: 6),
                Text('Add a longer description for AI suggestions.',
                    style: AppTextStyles.caption.copyWith(color: AppColors.warning)),
              ],
            ],
          ),

        // Smart search — disabled/greyed until unlocked.
        const SizedBox(height: 10),
        Opacity(
          opacity: _classUnlocked ? 1.0 : 0.5,
          child: IgnorePointer(
            ignoring: !_classUnlocked,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // No label — web parity (just a search icon + placeholder).
                TextField(
                  controller: _classSearchCtrl,
                  enabled: _classUnlocked,
                  textInputAction: TextInputAction.search,
                  onChanged: _onClassSearchChanged,
                  style: AppTextStyles.body,
                  decoration: InputDecoration(
                    isDense: true,
                    prefixIcon: const Icon(Icons.search,
                        size: 18, color: AppColors.textSecondary),
                    hintText: _classUnlocked
                        ? 'Type to search areas of focus…'
                        : 'Locked: use Auto-Suggest above first',
                    hintStyle: AppTextStyles.body.copyWith(color: AppColors.textMuted),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                if (_classUnlocked && _showClassSearchResults && searchText.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 4),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: _classSearching
                        ? Padding(
                            padding: const EdgeInsets.all(10),
                            child: Text('Searching…',
                                style: AppTextStyles.caption.copyWith(color: AppColors.textMuted)))
                        : _classSearchResults.isEmpty
                            ? Padding(
                                padding: const EdgeInsets.all(10),
                                child: Text('No matches.',
                                    style: AppTextStyles.caption.copyWith(color: AppColors.textMuted)))
                            : Column(
                                children: _classSearchResults
                                    .map((r) => _classSearchTile(r))
                                    .toList()),
                  ),
              ],
            ),
          ),
        ),

        // AI in-module suggestions — user selects; never auto-applied.
        if (_aiMatches.isNotEmpty) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: _kVioletBg,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _kVioletBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.auto_awesome, size: 14, color: _kViolet),
                    const SizedBox(width: 6),
                    Text(
                      'AI suggestion${_aiMatches.length > 1 ? "s" : ""}: review & select',
                      style: AppTextStyles.caption
                          .copyWith(color: _kViolet, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                ..._aiMatches.map(_aiSuggestionTile),
              ],
            ),
          ),
        ],

        // Cross-module "Better fit" hint — a different avenue suits this project
        // better; tap to switch and carry everything over (web parity).
        if (_showBetter) ...[
          const SizedBox(height: 8),
          InkWell(
            onTap: _switchToBetterModule,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.swap_horiz_rounded,
                      size: 15, color: AppColors.warning),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.warning),
                        children: [
                          const TextSpan(text: 'Better fit: '),
                          TextSpan(
                            text: _aiBetter!.moduleName ?? 'another avenue',
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          if (_aiBetter!.areaOfFocusName.isNotEmpty)
                            TextSpan(text: ' › ${_aiBetter!.areaOfFocusName}'),
                          const TextSpan(
                              text: ': switch & carry over',
                              style: TextStyle(fontWeight: FontWeight.w700)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }

  /// A tappable smart-search result row (applies its Area of Focus on tap).
  Widget _classSearchTile(_ClassificationResult r) {
    return InkWell(
      onTap: () => _applyClassificationResult(r),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: _kVioletBg,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text('AREA',
                  style: AppTextStyles.caption.copyWith(
                      color: _kViolet, fontWeight: FontWeight.w700, fontSize: 10)),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(r.areaOfFocusName, style: AppTextStyles.body)),
          ],
        ),
      ),
    );
  }

  /// One AI suggestion row with a Select / Selected action.
  Widget _aiSuggestionTile(_ClassificationResult r) {
    final selected = _selectedAreaOfFocusId != null &&
        _selectedAreaOfFocusId == r.areaOfFocusId;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Expanded(child: Text(r.areaOfFocusName, style: AppTextStyles.caption)),
          const SizedBox(width: 8),
          if (selected)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.muted,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.check, size: 12, color: AppColors.success),
                const SizedBox(width: 3),
                Text('Selected',
                    style: AppTextStyles.caption.copyWith(color: AppColors.success)),
              ]),
            )
          else
            GestureDetector(
              onTap: () => _applyClassificationResult(r),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: _kViolet,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text('Select',
                    style: AppTextStyles.caption.copyWith(color: Colors.white)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDropdown({
    required String label,
    required int? value,
    required List<_DropdownItem> items,
    required ValueChanged<int?> onChanged,
    bool includeOthers = false,
    bool isRequired = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.label),
        const SizedBox(height: 6),
        DropdownButtonFormField<int>(
          value: value,
          hint: Text('Select $label', style: AppTextStyles.body.copyWith(color: AppColors.textMuted)),
          decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
          style: AppTextStyles.body,
          isExpanded: true,
          items: [
            DropdownMenuItem<int>(value: null, child: Text('None', style: AppTextStyles.body.copyWith(color: AppColors.textSecondary))),
            ...items.map((item) => DropdownMenuItem<int>(value: item.id, child: Text(item.name))),
            if (includeOthers)
              DropdownMenuItem<int>(
                value: _kOthersSentinel,
                child: Text('Others', style: AppTextStyles.body.copyWith(fontStyle: FontStyle.italic)),
              ),
          ],
          onChanged: onChanged,
          validator: isRequired ? (v) => v == null ? 'Please select $label' : null : null,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Section-card design (web-parity): numbered badge + icon + accent header on a
// white card. Accent cycles blue → emerald → violet → amber → rose per section.
// ---------------------------------------------------------------------------
const List<Color> _kSectionAccents = [
  AppColors.accentBlue, // blue-600
  AppColors.success, // emerald-600
  AppColors.accentBlue, // violet-600
  AppColors.warningDark, // amber-600
  AppColors.error, // rose-600
];

/// A single form section: its header icon/title plus the field widgets inside.
class _Section {
  final IconData icon;
  final String title;
  final List<Widget> children;
  const _Section(this.icon, this.title, this.children);
}

/// Renders a [_Section] as a numbered, accented card matching the web design.
class _SectionCard extends StatelessWidget {
  final int number;
  final IconData icon;
  final String title;
  final Color accent;
  final List<Widget> children;
  const _SectionCard({
    required this.number,
    required this.icon,
    required this.title,
    required this.accent,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.lightBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header strip — slate-50 bg, number badge in the section accent.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            decoration: const BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(14),
                topRight: Radius.circular(14),
              ),
              border: Border(bottom: BorderSide(color: AppColors.muted)),
            ),
            child: Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
                  child: Text(
                    '$number',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Icon(icon, size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

/// Web-parity selectable "pill" used for radio-style choices (Project Type,
/// Create New / Select Existing, Joint Yes/No). Selected = primary border +
/// tinted fill + a filled radio dot.
class _RadioPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _RadioPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    const accent = AppColors.primary;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? accent.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? accent : AppColors.lightBorder,
            width: selected ? 1.6 : 1.2,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: selected ? accent : AppColors.textMuted,
                  width: 2,
                ),
              ),
              child: selected
                  ? Center(
                      child: Container(
                        width: 7,
                        height: 7,
                        decoration: const BoxDecoration(color: accent, shape: BoxShape.circle),
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: AppTextStyles.body.copyWith(
                color: selected ? accent : AppColors.textSecondary,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Multi-photo gallery (form)
//
// Vertical list of compact media cards, one per photo: square thumbnail +
// inline description + a slim action footer (Primary / delete). Follows the
// app's clean/compact language — Jakarta Sans, flat white card, r12, thin
// border, tinted pills — instead of the tall boxy card the first pass used.
// The description rides along in the `photos[]` payload the form already sends
// (`ProjectPhotoInput.Description`).
// ---------------------------------------------------------------------------

/// Max characters for a per-photo description (web project form uses 500).
const int _kProjPhotoDescMaxChars = 500;

class _PhotoGallery extends StatelessWidget {
  final List<_ProjectPhoto> photos;
  final bool uploading;
  final VoidCallback? onAdd;
  final ValueChanged<int> onSetPrimary;
  final ValueChanged<int> onRemove;

  const _PhotoGallery({
    required this.photos,
    required this.uploading,
    required this.onAdd,
    required this.onSetPrimary,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = onAdd == null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < photos.length; i++) ...[
          _PhotoCard(
            key: ValueKey('club_project_photo_${photos[i].path}'),
            photo: photos[i],
            index: i,
            isPrimary: photos[i].isPrimary,
            onSetPrimary: () => onSetPrimary(i),
            onRemove: () => onRemove(i),
          ),
          const SizedBox(height: 8),
        ],
        InkWell(
          onTap: uploading || disabled ? null : onAdd,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            height: 46,
            decoration: BoxDecoration(
              color: disabled ? AppColors.background : AppColors.primaryLight,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: disabled
                    ? AppColors.border
                    : AppColors.primary.withValues(alpha: 0.25),
              ),
            ),
            alignment: Alignment.center,
            child: uploading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        disabled
                            ? Icons.photo_library_outlined
                            : Icons.add_photo_alternate_outlined,
                        size: 18,
                        color: disabled
                            ? AppColors.textMuted
                            : AppColors.primary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        disabled ? 'Maximum photos reached' : 'Add photo',
                        style: AppFonts.body(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: disabled
                              ? AppColors.textMuted
                              : AppColors.primary,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }
}

class _PhotoCard extends StatefulWidget {
  final _ProjectPhoto photo;
  final int index;
  final bool isPrimary;
  final VoidCallback onSetPrimary;
  final VoidCallback onRemove;

  const _PhotoCard({
    super.key,
    required this.photo,
    required this.index,
    required this.isPrimary,
    required this.onSetPrimary,
    required this.onRemove,
  });

  @override
  State<_PhotoCard> createState() => _PhotoCardState();
}

class _PhotoCardState extends State<_PhotoCard> {
  late final TextEditingController _descCtrl;
  late int _len;

  @override
  void initState() {
    super.initState();
    _descCtrl = TextEditingController(text: widget.photo.description);
    _len = _descCtrl.text.characters.length;
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final photo = widget.photo;
    final isPrimary = widget.isPrimary;
    // Only surface the counter when the cap is actually in sight — a permanent
    // "14/500" under every photo was the noisiest part of the old card.
    final showCount = _len >= _kProjPhotoDescMaxChars - 100;

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isPrimary
              ? AppColors.primary.withValues(alpha: 0.55)
              : AppColors.border,
          width: isPrimary ? 1.4 : 1,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Thumbnail (square, with a star badge on the primary photo) ──
          Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  width: 64,
                  height: 64,
                  color: AppColors.background,
                  child: photo.path.isNotEmpty
                      ? Image.network(
                          ApiConstants.mediaUrl(photo.path),
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(
                            Icons.broken_image_outlined,
                            color: AppColors.textMuted,
                            size: 22,
                          ),
                        )
                      : const Icon(Icons.image_outlined,
                          color: AppColors.textMuted, size: 22),
                ),
              ),
              if (isPrimary)
                Positioned(
                  top: 4,
                  left: 4,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: const BoxDecoration(
                      color: Colors.black54,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.star_rounded,
                        size: 12, color: Colors.amber),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 10),
          // ── Description + actions ──
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _descCtrl,
                  // Grows with the text so multi-line captions are actually
                  // usable — the return key inserts a line break, it does not
                  // dismiss the keyboard.
                  minLines: 2,
                  maxLines: 5,
                  maxLength: _kProjPhotoDescMaxChars,
                  keyboardType: TextInputType.multiline,
                  textInputAction: TextInputAction.newline,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    color: AppColors.textPrimary,
                  ),
                  onChanged: (v) {
                    widget.photo.description = v;
                    final n = v.characters.length;
                    if (n != _len) setState(() => _len = n);
                  },
                  // The default counter is a full-width "n/500" line under every
                  // field; we render our own only when it matters.
                  buildCounter: (_,
                          {required int currentLength,
                          required bool isFocused,
                          int? maxLength}) =>
                      null,
                  decoration: InputDecoration(
                    isDense: true,
                    filled: true,
                    fillColor: AppColors.background,
                    hintText: 'Add a description (optional)',
                    hintStyle: AppFonts.body(
                      fontSize: 12,
                      color: AppColors.textMuted,
                    ),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide:
                          const BorderSide(color: AppColors.primary, width: 1.2),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    if (isPrimary)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.warning.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.star_rounded,
                                size: 12, color: Colors.amber),
                            const SizedBox(width: 4),
                            Text(
                              'PRIMARY',
                              style: AppFonts.body(
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.4,
                                color: AppColors.warning,
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      InkWell(
                        onTap: widget.onSetPrimary,
                        borderRadius: BorderRadius.circular(999),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 4),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.star_border_rounded,
                                  size: 14, color: AppColors.textSecondary),
                              const SizedBox(width: 4),
                              Text(
                                'Set as primary',
                                style: AppFonts.body(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    const Spacer(),
                    if (showCount)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Text(
                          '$_len/$_kProjPhotoDescMaxChars',
                          style: AppFonts.body(
                            fontSize: 10,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ),
                    InkWell(
                      onTap: widget.onRemove,
                      borderRadius: BorderRadius.circular(999),
                      child: const Padding(
                        padding: EdgeInsets.all(5),
                        child: Icon(Icons.delete_outline_rounded,
                            size: 18, color: AppColors.error),
                      ),
                    ),
                  ],
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
// Parent project picker (ongoing/repeat parent selector)
// ---------------------------------------------------------------------------
class _ParentProjectPicker extends StatefulWidget {
  final ApiClient api;
  final int clubId;
  final int moduleId;
  // When set (>0), limits the results to ongoing/repeat projects of this Rotary
  // year (the year the new project is being filed under).
  final int? yearId;
  const _ParentProjectPicker({
    required this.api,
    required this.clubId,
    required this.moduleId,
    this.yearId,
  });

  @override
  State<_ParentProjectPicker> createState() => _ParentProjectPickerState();
}

class _ParentProjectPickerState extends State<_ParentProjectPicker> {
  final _searchCtrl = TextEditingController();
  List<_ParentProjectOption> _results = [];
  bool _loading = false;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _search(String q) async {
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final resp = await widget.api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/projects/ongoing',
        queryParams: {
          'moduleId': widget.moduleId,
          'search': q,
          // Only send yearId when we have a real one — 0/null means "all years"
          // server-side (the DTO param is nullable).
          if ((widget.yearId ?? 0) > 0) 'yearId': widget.yearId,
        },
        fromJson: (j) => j as List<dynamic>,
      );
      setState(() {
        _results = (resp.data ?? [])
            .map((e) => _ParentProjectOption.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (_) {
      // The ongoing-search endpoint currently 500s server-side ("Illegal mix of
      // collations for operation 'UNION'") — flag it rather than implying there
      // are simply no projects.
      setState(() {
        _results = [];
        _error = true;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20, right: 20, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Select Parent Project', style: AppTextStyles.h3),
          const SizedBox(height: 12),
          TextField(
            controller: _searchCtrl,
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Search ongoing projects',
              border: OutlineInputBorder(),
            ),
            onChanged: _search,
          ),
          const SizedBox(height: 12),
          Flexible(
            child: SizedBox(
              height: 320,
              child: _loading
                  ? const LoadingWidget()
                  : _results.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(
                              _error
                                  ? 'Couldn\'t load projects: the server returned an '
                                      'error. Please try again later or use "Create New".'
                                  : 'No ongoing projects found',
                              textAlign: TextAlign.center,
                              style: AppTextStyles.caption,
                            ),
                          ),
                        )
                      : ListView.separated(
                          itemCount: _results.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final p = _results[i];
                            return ListTile(
                              dense: true,
                              title: Text(p.title, style: AppTextStyles.bodyMedium),
                              subtitle: p.ongoingGroupTitle != null && p.ongoingGroupTitle!.isNotEmpty
                                  ? Text(p.ongoingGroupTitle!, style: AppTextStyles.caption)
                                  : null,
                              onTap: () => Navigator.pop(context, p),
                            );
                          },
                        ),
            ),
          ),
        ],
      ),
    );
  }
}
