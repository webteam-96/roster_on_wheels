import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../data/models/club_model.dart';
import '../../../data/models/district_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/loading_widget.dart';

// Wallet + club website (shared across club/district scopes)
import '../../../data/models/wallet_models.dart';
import '../wallet/wallet_topup_screen.dart';
import '../clubs/modules/website_purchase/website_purchase_screen.dart';

// Club module screens
import '../clubs/modules/members/club_members_screen.dart';
import '../clubs/modules/website_data/club_website_data_hub_screen.dart';
import '../clubs/modules/club_monthly_report/club_monthly_report_screen.dart';
import '../clubs/modules/upcoming_events/upcoming_events_screen.dart';
import '../clubs/modules/announcements/announcements_screen.dart';
import '../clubs/modules/newsletters/newsletters_screen.dart';
import '../clubs/modules/documents/documents_screen.dart';
import '../clubs/modules/greetings/greetings_screen.dart';
import '../clubs/modules/event_payment_links/event_payment_links_screen.dart';
import '../clubs/modules/weblinks/weblinks_screen.dart';
import '../clubs/modules/sub_groups/sub_groups_screen.dart';
import '../clubs/modules/mass_emails/mass_emails_screen.dart';
import '../clubs/modules/board_of_directors/board_of_directors_screen.dart';
import '../clubs/modules/past_presidents/past_presidents_screen.dart';
import '../clubs/modules/attendance/attendance_screen.dart';
import '../clubs/modules/ocv_gov/ocv_gov_screen.dart';
import '../clubs/modules/trf/trf_screen.dart';
import '../clubs/modules/membership_dues/membership_dues_screen.dart';
import '../my_dues/my_membership_dues_screen.dart';
import '../clubs/modules/rotary_network/rotary_network_screen.dart';
import '../clubs/modules/projects/projects_screen.dart';
import '../clubs/modules/citation/club_citation_screen.dart';
import '../reports/club_report_screen.dart';

// District module screens
import '../districts/modules/committee/district_committee_screen.dart';
import '../districts/modules/district_members_screen.dart';
import '../districts/modules/district_website_data_screen.dart';
import '../districts/modules/district_cmr_screen.dart';
import '../districts/modules/district_upcoming_events_screen.dart';
import '../districts/modules/district_announcements_screen.dart';
import '../districts/modules/district_newsletters_screen.dart';
import '../districts/modules/district_documents_screen.dart';
import '../districts/modules/district_greetings_screen.dart';
import '../districts/modules/district_reports_screen.dart';
import '../districts/modules/district_online_event_link_screen.dart';
import '../districts/modules/district_weblinks_screen.dart';
import '../districts/modules/district_sub_groups_screen.dart';
import '../districts/modules/district_mass_emails_screen.dart';

import '../districts/modules/district_clubs_screen.dart';
import '../districts/modules/district_projects_screen.dart';
import '../districts/modules/district_events_screen.dart';
import '../districts/modules/district_club_dues_screen.dart';
import '../districts/modules/district_citation_screen.dart';
import '../districts/modules/district_ag_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Module classification sets (normalized keys: lowercase, no separators)
// ---------------------------------------------------------------------------

const _kClubOnlyKeys = {
  'pastpresidents', 'boardofdirectors', 'rotarynetwork',
  'clubservice', 'communityservice', 'vocationalservice', 'internationalservice',
  'newgenerationservice', 'publicimageinitiative', 'publicimageinitiation',
  'attendance', 'ocvgov', 'membershipdues', 'trfcontribution',
  // Website management is a club-only page (no district equivalent), so it
  // shows only Club content in the unified detail. Wallet/email are
  // intentionally NOT listed — they exist for both scopes (Club|District tabs).
  'website',
};

const _kDistrictOnlyKeys = {
  'districtcommittee', 'clubs', 'ag',
  'districtprojects', 'districtevents', 'clubdues',
};

String _normalize(String key) =>
    key.toLowerCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '');

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

/// Opens the unified module detail page when a module tile is tapped.
///
/// - Shows [Club] | [District] tabs if the module is shared.
/// - Shows only Club content (no tabs) for club-only modules.
/// - Shows only District content (no tabs) for district-only modules.
/// - Inside each tab, a dropdown lists all accessible clubs / districts.
class UnifiedModuleDetailScreen extends StatefulWidget {
  final String moduleKey;
  final String moduleName;

  const UnifiedModuleDetailScreen({
    super.key,
    required this.moduleKey,
    required this.moduleName,
  });

  @override
  State<UnifiedModuleDetailScreen> createState() => _UnifiedModuleDetailScreenState();
}

class _UnifiedModuleDetailScreenState extends State<UnifiedModuleDetailScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiClient();

  List<ClubModel> _clubs = [];
  List<DistrictModel> _districts = [];
  bool _loadingEntities = true;
  String? _entityError;

  ClubModel? _selectedClub;
  DistrictModel? _selectedDistrict;

  late final TabController _tabController;

  bool get _isClubOnly => _kClubOnlyKeys.contains(_normalize(widget.moduleKey));
  bool get _isDistrictOnly => _kDistrictOnlyKeys.contains(_normalize(widget.moduleKey));
  bool get _isShared => !_isClubOnly && !_isDistrictOnly;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _isShared ? 2 : 1, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadEntities());
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadEntities() async {
    setState(() { _loadingEntities = true; _entityError = null; });
    try {
      final auth = context.read<AuthProvider>();
      final zoneIds = auth.accessibleZoneIds;

      final results = await Future.wait([
        _isDistrictOnly ? Future.value(<ClubModel>[]) : _fetchAllClubs(auth, zoneIds),
        _isClubOnly    ? Future.value(<DistrictModel>[]) : _fetchAllDistricts(auth, zoneIds),
      ]);

      final clubs     = results[0] as List<ClubModel>;
      final districts = results[1] as List<DistrictModel>;

      if (mounted) {
        setState(() {
          _clubs     = clubs;
          _districts = districts;
          _selectedClub     = clubs.isNotEmpty     ? clubs.first     : null;
          _selectedDistrict = districts.isNotEmpty ? districts.first : null;
          _loadingEntities  = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _entityError = e.toString(); _loadingEntities = false; });
    }
  }

  Future<List<ClubModel>> _fetchAllClubs(AuthProvider auth, List<int> zoneIds) async {
    // Everyone except SuperAdmin only ever needs their OWN clubs here —
    // this mirrors the "My Club" tile in the normal home flow. Build that list
    // straight from my-context role assignments instead of downloading the
    // entire zone's club listing and filtering it down. The zone listing is
    // paginated (page 1, pageSize 200) and a large zone (e.g. Zone 7, whose
    // district 3170 alone has 143 clubs) can push the user's own club past the
    // first page, which used to make it vanish from the selector — surfacing as
    // "No clubs available for this module" even though the module is granted.
    if (!auth.isSuperAdmin) {
      return auth.memberClubBriefs
          .map((c) => ClubModel(
                id: c.id,
                clubName: c.name,
                fkDistrictId: c.districtId,
                districtNumber: c.districtNumber,
                isActive: true,
              ))
          .toList();
    }

    // SuperAdmin intentionally sees every club in their accessible zones.
    final all = <ClubModel>[];
    for (final zoneId in zoneIds) {
      try {
        final res = await _api.get<Map<String, dynamic>>(
          ApiConstants.clubs,
          queryParams: {'page': 1, 'pageSize': 200, 'zoneId': zoneId},
        );
        final items = (res.data?['items'] as List<dynamic>? ?? [])
            .map((e) => ClubModel.fromJson(e as Map<String, dynamic>))
            .toList();
        all.addAll(items);
      } catch (_) {}
    }
    final seen = <int>{};
    return all.where((c) => seen.add(c.id)).toList();
  }

  Future<List<DistrictModel>> _fetchAllDistricts(AuthProvider auth, List<int> zoneIds) async {
    final all = <DistrictModel>[];
    for (final zoneId in zoneIds) {
      try {
        final res = await _api.get<Map<String, dynamic>>(
          ApiConstants.districts,
          queryParams: {'page': 1, 'pageSize': 200, 'zoneId': zoneId},
        );
        final items = (res.data?['items'] as List<dynamic>? ?? [])
            .map((e) => DistrictModel.fromJson(e as Map<String, dynamic>))
            .toList();
        all.addAll(items);
      } catch (_) {}
    }
    final seen = <int>{};
    final unique = all.where((d) => seen.add(d.id)).toList();
    // SuperAdmin sees everything.
    // For district admins, narrow to districts they admin (strictly — not
    // every district their member clubs happen to belong to). Mirrors the
    // "District Admin" tile in the normal home flow.
    // For non-admin members, fall back to their membership districts so the
    // existing member unified flow (type: 'unified') keeps working.
    if (auth.isSuperAdmin) return unique;
    if (auth.isDistrictAdmin) {
      final adminIds = auth.districtAdminDistrictIds;
      return unique.where((d) => adminIds.contains(d.id)).toList();
    }
    final assigned = auth.assignedDistrictIds;
    // COG is a special club; hide its district from the member's own district
    // dropdown (matches Welcome / My Connections / calendar listings).
    final cogDistrictId = auth.cogDistrictId;
    return unique
        .where((d) => assigned.contains(d.id) && d.id != cogDistrictId)
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: widget.moduleName,
        bottom: _isShared
            ? TabBar(
                controller: _tabController,
                tabs: const [Tab(text: 'Club'), Tab(text: 'District')],
                labelColor: Colors.white,
                indicatorColor: AppColors.goldPrime,
                unselectedLabelColor: Colors.white70,
                labelStyle: AppTextStyles.bodySemiBold,
              )
            : null,
      ),
      body: _loadingEntities
          ? const LoadingWidget()
          : _entityError != null
              ? _ErrorView(message: _entityError!, onRetry: _loadEntities)
              : _isShared
                  ? TabBarView(
                      controller: _tabController,
                      children: [
                        _ClubTab(
                          clubs: _clubs,
                          selected: _selectedClub,
                          onChanged: (c) => setState(() => _selectedClub = c),
                          moduleKey: widget.moduleKey,
                        ),
                        _DistrictTab(
                          districts: _districts,
                          selected: _selectedDistrict,
                          onChanged: (d) => setState(() => _selectedDistrict = d),
                          moduleKey: widget.moduleKey,
                        ),
                      ],
                    )
                  : _isClubOnly
                      ? _ClubTab(
                          clubs: _clubs,
                          selected: _selectedClub,
                          onChanged: (c) => setState(() => _selectedClub = c),
                          moduleKey: widget.moduleKey,
                        )
                      : _DistrictTab(
                          districts: _districts,
                          selected: _selectedDistrict,
                          onChanged: (d) => setState(() => _selectedDistrict = d),
                          moduleKey: widget.moduleKey,
                        ),
    );
  }
}

// ---------------------------------------------------------------------------
// Club Tab
// ---------------------------------------------------------------------------

class _ClubTab extends StatelessWidget {
  final List<ClubModel> clubs;
  final ClubModel? selected;
  final ValueChanged<ClubModel> onChanged;
  final String moduleKey;

  const _ClubTab({
    required this.clubs,
    required this.selected,
    required this.onChanged,
    required this.moduleKey,
  });

  @override
  Widget build(BuildContext context) {
    if (clubs.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('No clubs available for this module.'),
        ),
      );
    }
    return Column(
      children: [
        if (clubs.length > 1)
          _EntityDropdown<ClubModel>(
            items: clubs,
            selected: selected,
            labelOf: (c) =>
                '${c.clubName}${c.districtNumber != null ? ' (${c.districtNumber})' : ''}',
            onChanged: onChanged,
          ),
        if (selected != null)
          Expanded(
            child: _ClubModuleEmbedded(
              key: ValueKey('club_${_normalize(moduleKey)}_${selected!.id}'),
              moduleKey: _normalize(moduleKey),
              clubId: selected!.id,
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// District Tab
// ---------------------------------------------------------------------------

class _DistrictTab extends StatelessWidget {
  final List<DistrictModel> districts;
  final DistrictModel? selected;
  final ValueChanged<DistrictModel> onChanged;
  final String moduleKey;

  const _DistrictTab({
    required this.districts,
    required this.selected,
    required this.onChanged,
    required this.moduleKey,
  });

  @override
  Widget build(BuildContext context) {
    if (districts.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('No districts available for this module.'),
        ),
      );
    }
    return Column(
      children: [
        if (districts.length > 1)
          _EntityDropdown<DistrictModel>(
            items: districts,
            selected: selected,
            labelOf: (d) => d.districtNumber,
            onChanged: onChanged,
          ),
        if (selected != null)
          Expanded(
            child: _DistrictModuleEmbedded(
              key: ValueKey('district_${_normalize(moduleKey)}_${selected!.id}'),
              moduleKey: _normalize(moduleKey),
              districtId: selected!.id,
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Generic dropdown
// ---------------------------------------------------------------------------

class _EntityDropdown<T> extends StatelessWidget {
  final List<T> items;
  final T? selected;
  final String Function(T) labelOf;
  final ValueChanged<T> onChanged;

  const _EntityDropdown({
    required this.items,
    required this.selected,
    required this.labelOf,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: DropdownButtonFormField<T>(
        value: selected, // ignore: deprecated_member_use
        decoration: InputDecoration(
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
            borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
          ),
          filled: true,
          fillColor: Colors.white,
        ),
        isExpanded: true,
        items: items
            .map((item) => DropdownMenuItem<T>(
                  value: item,
                  child: Text(
                    labelOf(item),
                    style: AppTextStyles.body.copyWith(color: AppColors.textPrimary),
                    overflow: TextOverflow.ellipsis,
                  ),
                ))
            .toList(),
        onChanged: (val) { if (val != null) onChanged(val); },
        style: AppTextStyles.body.copyWith(color: AppColors.textPrimary),
        dropdownColor: Colors.white,
        icon: const Icon(Icons.expand_more, color: AppColors.primary),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 48),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Club module embedded content
// ---------------------------------------------------------------------------

class _ClubModuleEmbedded extends StatelessWidget {
  final String moduleKey;
  final int clubId;

  const _ClubModuleEmbedded({super.key, required this.moduleKey, required this.clubId});

  @override
  Widget build(BuildContext context) {
    // In the unified flow, only club admins of THIS club get manage UI.
    // Module screens that accept a viewOnly flag respect this; others
    // (not yet migrated) fall back to their normal-flow behavior.
    final viewOnly = !context.watch<AuthProvider>().isClubAdminOf(clubId);
    switch (moduleKey) {
      // Shared modules
      case 'directory':
        return ClubMembersScreen(clubId: clubId, embedded: true);
      case 'admin':
      case 'websitedata':
        return ClubWebsiteDataHubScreen(clubId: clubId, embedded: true);
      case 'clubmonthlyreport':
        return ClubMonthlyReportScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'calendar':
      case 'upcomingevents':
        return UpcomingEventsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'announcements':
        return AnnouncementsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'newsletters':
        return NewslettersScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'documents':
        return DocumentsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'greetings':
        return GreetingsScreen(clubId: clubId, embedded: true);
      case 'onlineeventlink':
      case 'eventpaymentlinks':
        return EventPaymentLinksScreen(clubId: clubId, embedded: true);
      case 'weblinks':
        return WeblinksScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'subgroups':
        return SubGroupsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'massemail':
      case 'massemails':
        return MassEmailsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'citation':
      case 'districtcitation':
        return ClubCitationScreen(clubId: clubId, embedded: true);
      case 'reports':
      case 'clubreport':
      case 'clubreports':
        return ClubReportScreen(clubId: clubId, embedded: true);
      // Club-only modules
      case 'bod':
      case 'boardofdirectors':
        return BoardOfDirectorsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'pastpresidents':
        return PastPresidentsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'attendance':
        return AttendanceScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'ocvgov':
        return OcvGovScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'trf':
      case 'trfcontribution':
        return TrfScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'membershipdues':
        // Same module, role-split: club admins manage everyone's dues; plain
        // members see only their own ("My Dues"). Admins land on the setups
        // LIST (screen 1) — from there: Members → editor, Edit → setup form,
        // mirroring the web flow.
        return viewOnly
            // Scope to this club — the member endpoint returns every club's dues.
            ? MyMembershipDuesScreen(embedded: true, clubId: clubId)
            : MembershipDuesScreen(clubId: clubId, embedded: true);
      case 'rotarynetwork':
        return RotaryNetworkScreen(clubId: clubId, embedded: true);
      case 'clubservice':
        return ProjectsScreen(clubId: clubId, moduleType: 'club-service', embedded: true, viewOnly: viewOnly);
      case 'communityservice':
        return ProjectsScreen(clubId: clubId, moduleType: 'community', embedded: true, viewOnly: viewOnly);
      case 'vocationalservice':
        return ProjectsScreen(clubId: clubId, moduleType: 'vocational', embedded: true, viewOnly: viewOnly);
      case 'internationalservice':
        return ProjectsScreen(clubId: clubId, moduleType: 'international', embedded: true, viewOnly: viewOnly);
      case 'newgenerationservice':
        return ProjectsScreen(clubId: clubId, moduleType: 'new-generation', embedded: true, viewOnly: viewOnly);
      case 'publicimageinitiative':
      case 'publicimageinitiation':
        return ProjectsScreen(clubId: clubId, moduleType: 'public-image', embedded: true, viewOnly: viewOnly);
      // Payments: combined Wallet + the split email single-type
      // views (the screen self-gates the buy button for non-admins).
      case 'wallet':
        return WalletTopupScreen(scope: 'club', clubId: clubId, embedded: true);
      case 'email':
        return WalletTopupScreen(
            scope: 'club',
            clubId: clubId,
            embedded: true,
            initialCreditType: WalletCreditType.email,
            lockType: true);
      // Website: open the self-service Buy / Renew (Razorpay) flow directly.
      case 'website':
        return WebsitePurchaseScreen(
            clubId: clubId, clubName: null, embedded: true);
      default:
        return Center(child: Text('Club module "$moduleKey" not available'));
    }
  }
}

// ---------------------------------------------------------------------------
// District module embedded content
// ---------------------------------------------------------------------------

class _DistrictModuleEmbedded extends StatelessWidget {
  final String moduleKey;
  final int districtId;

  const _DistrictModuleEmbedded({super.key, required this.moduleKey, required this.districtId});

  @override
  Widget build(BuildContext context) {
    // In the unified flow, only district admins of THIS district get
    // manage UI. Module screens that accept a viewOnly flag respect this;
    // others fall back to their normal-flow behavior.
    final viewOnly = !context.watch<AuthProvider>().isDistrictAdminOf(districtId);
    switch (moduleKey) {
      // Shared modules
      case 'directory':
        return DistrictMembersScreen(districtId: districtId, embedded: true);
      case 'websitedata':
        return DistrictWebsiteDataScreen(districtId: districtId, embedded: true);
      case 'clubmonthlyreport':
      case 'cmr':
        return DistrictCmrScreen(districtId: districtId, embedded: true);
      case 'calendar':
      case 'upcomingevents':
        return DistrictUpcomingEventsScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'announcements':
        return DistrictAnnouncementsScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'newsletter':
      case 'newsletters':
        return DistrictNewslettersScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'documents':
        return DistrictDocumentsScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'greetings':
        return DistrictGreetingsScreen(districtId: districtId, embedded: true);
      case 'reports':
        return DistrictReportsScreen(districtId: districtId, embedded: true);
      case 'onlineeventlink':
        return DistrictOnlineEventLinkScreen(districtId: districtId, embedded: true);
      case 'weblinks':
        return DistrictWeblinksScreen(districtId: districtId, embedded: true);
      case 'subgroups':
        return DistrictSubGroupsScreen(districtId: districtId, embedded: true);
      case 'massemail':
      case 'massemails':
        return DistrictMassEmailsScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'districtcitation':
        return DistrictCitationScreen(districtId: districtId, embedded: true);
      // District-only modules
      case 'districtcommittee':
        return DistrictCommitteeScreen(districtId: districtId, embedded: true);
      case 'clubs':
        return DistrictClubsScreen(districtId: districtId, embedded: true);
      case 'ag':
      case 'assistantgovernor':
        return DistrictAgScreen(districtId: districtId, embedded: true);
      case 'districtprojects':
        return DistrictProjectsScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'districtevents':
        return DistrictEventsScreen(districtId: districtId, embedded: true, viewOnly: viewOnly);
      case 'clubdues':
        return DistrictClubDuesScreen(districtId: districtId, embedded: true);
      // Payments: combined Wallet + the split email single-type
      // views (the screen self-gates the buy button for non-admins).
      case 'wallet':
        return WalletTopupScreen(
            scope: 'district', districtId: districtId, embedded: true);
      case 'email':
        return WalletTopupScreen(
            scope: 'district',
            districtId: districtId,
            embedded: true,
            initialCreditType: WalletCreditType.email,
            lockType: true);
      default:
        return Center(child: Text('District module "$moduleKey" not available'));
    }
  }
}
