import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../../../../../core/network/api_client.dart';
import '../../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../../core/services/report_xlsx_export.dart';
import '../../../../../../core/theme/app_colors.dart';
import '../../../../../../core/utils/snackbar_utils.dart';
import '../../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../../widgets/common/confirmation_dialog.dart';
import '../../../../districts/overview/widgets/stat_card.dart';
import '../../../modules/board_of_directors/board_of_directors_screen.dart';
import '../../../../../widgets/common/dashboard_refresh.dart';
import '../club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Dashboard › Board of Directors sub-tab. Lists the board (from
/// `/dashboard-bod`) with KPIs + a year filter + search, and full Add / Edit /
/// Delete reusing the existing BOD form + endpoints
/// (`/api/clubs/{clubId}/board-of-directors`).
class DashboardBodSubtab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const DashboardBodSubtab({super.key, required this.clubId, this.yearId});

  @override
  State<DashboardBodSubtab> createState() => _DashboardBodSubtabState();
}

class _DashboardBodSubtabState extends State<DashboardBodSubtab> {
  final ClubAdminDashboardApi _dash = ClubAdminDashboardApi();
  final ApiClient _api = ApiClient();

  late Future<ClubAdminBod> _future;
  int? _yearId;
  String _search = '';
  final TextEditingController _searchCtrl = TextEditingController();

  // Reference data for the Add/Edit form (fetched once).
  List<BodRotaryYear> _years = [];
  List<dynamic> _designations = [];

  @override
  void initState() {
    super.initState();
    _yearId = widget.yearId; // seed from the global selector
    _future = _dash.getBod(widget.clubId, yearId: _yearId);
    _loadRefs();
  }

  Future<void> _loadRefs() async {
    try {
      final yearsResp = await _api.get<List<dynamic>>('/api/rotary-years',
          fromJson: (j) => j as List<dynamic>);
      final desigResp = await _api.get<List<dynamic>>('/api/designations',
          fromJson: (j) => j as List<dynamic>);
      if (!mounted) return;
      setState(() {
        _years = (yearsResp.data ?? [])
            .map((e) => BodRotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
        _designations = desigResp.data ?? [];
      });
    } catch (_) {
      // Form can still open; dropdowns just won't be pre-populated.
    }
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  void _reload() => setState(() => _future = _dash.getBod(widget.clubId, yearId: _yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _dash.getBod(widget.clubId, yearId: _yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  Future<void> _openForm({BodDirectorRow? director, required int? yearId}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BodDirectorFormScreen(
          clubId: widget.clubId,
          allRotaryYears: _years,
          designations: _designations,
          director: director == null
              ? null
              : {
                  'id': director.id,
                  'memberId': director.isMember ? director.memberId : null,
                  'isMember': director.isMember,
                  'memberName': director.name,
                  // For a non-member row, the resolved name/mobile/email ARE the
                  // non-member details — thread them so the edit form pre-fills.
                  'nonMemberName': director.isMember ? null : director.name,
                  'nonMemberMobile': director.isMember ? null : director.mobile,
                  'nonMemberEmail': director.isMember ? null : director.email,
                  'designationId': director.designationId,
                  'yearId': yearId,
                  'profilePhotoPath': director.photoPath,
                },
          onSaved: () async {},
        ),
      ),
    );
    _reload();
  }

  Future<void> _delete(BodDirectorRow d) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Board Director',
      message: 'Remove ${d.name}${d.designation.isNotEmpty ? ' (${d.designation})' : ''} from the board?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/board-of-directors/${d.id}');
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Board member removed');
      _reload();
    } catch (_) {
      if (!mounted) return;
      SnackbarUtils.showError(context, 'Failed to remove board member');
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ClubAdminBod>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        final bod = snap.data!;
        final q = _search.toLowerCase().trim();
        final filtered = q.isEmpty
            ? bod.directors
            : bod.directors
                .where((d) =>
                    d.name.toLowerCase().contains(q) ||
                    d.designation.toLowerCase().contains(q) ||
                    d.email.toLowerCase().contains(q))
                .toList();
        return DashboardRefresh(
          onRefresh: _refresh,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _kpis(bod),
              const SizedBox(height: 14),
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.slate200),
                ),
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Board of Directors',
                                  style: AppFonts.body(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.textPrimary)),
                              Text(
                                  '${bod.clubName.isEmpty ? 'This club' : bod.clubName} · RY ${bod.selectedYearLabel}',
                                  style: AppFonts.body(
                                      fontSize: 11.5,
                                      color: AppColors.slate500)),
                            ],
                          ),
                        ),
                        _exportButton(bod),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: _searchField(),
                        ),
                        const SizedBox(width: 8),
                        _addButton(bod),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (filtered.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: Text('No board members found',
                              style: AppFonts.body(
                                  fontSize: 12, color: AppColors.slate400)),
                        ),
                      )
                    else
                      Column(
                        children: [
                          for (var i = 0; i < filtered.length; i++)
                            _DirectorRow(
                              director: filtered[i],
                              index: i,
                              onEdit: () => _openForm(
                                  director: filtered[i],
                                  yearId: bod.selectedYearId),
                              onDelete: () => _delete(filtered[i]),
                            ),
                          const SizedBox(height: 4),
                          Text(
                              q.isEmpty
                                  ? '${bod.directors.length} board positions · RY ${bod.selectedYearLabel}'
                                  : 'Showing ${filtered.length} of ${bod.directors.length} board positions · RY ${bod.selectedYearLabel}',
                              style: AppFonts.body(
                                  fontSize: 10.5, color: AppColors.slate400)),
                        ],
                      ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // Single KPI matching the web Board of Directors page: Board Members only.
  Widget _kpis(ClubAdminBod bod) {
    return StatCard(
        label: 'Board Members',
        value: '${bod.boardMembers}',
        sub: 'RY ${bod.selectedYearLabel}',
        accent: AppColors.rotaryBlue);
  }

  Widget _searchField() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Row(
        children: [
          const Icon(Icons.search_rounded, size: 16, color: AppColors.slate400),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _search = v),
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              decoration: InputDecoration(
                hintText: 'Search name, designation or email…',
                hintStyle: AppFonts.body(
                    fontSize: 13, color: AppColors.slate400),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _addButton(ClubAdminBod bod) {
    return ElevatedButton.icon(
      onPressed: () => _openForm(yearId: bod.selectedYearId),
      icon: const Icon(Icons.add_rounded, size: 16),
      label: Text('Add',
          style: AppFonts.body(
              fontSize: 12, fontWeight: FontWeight.w700)),
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.rotaryBlue,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  Widget _exportButton(ClubAdminBod bod) {
    return OutlinedButton.icon(
      onPressed: () => _exportExcel(bod),
      icon: const Icon(Icons.file_download_outlined, size: 16),
      label: Text('Excel',
          style: AppFonts.body(
              fontSize: 12, fontWeight: FontWeight.w700)),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.success,
        side: BorderSide(color: AppColors.success.withValues(alpha: 0.45)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  /// Builds an .xlsx of the board roster (client-side, mirrors the web
  /// "Export to Excel") and opens the OS share sheet.
  Future<void> _exportExcel(ClubAdminBod bod) async {
    if (bod.directors.isEmpty) {
      SnackbarUtils.showError(context, 'No board members to export');
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(const SnackBar(
      content: Text('Generating Excel…'),
      duration: Duration(seconds: 1),
    ));
    try {
      final rows = <Map<String, dynamic>>[
        for (var i = 0; i < bod.directors.length; i++)
          {
            'sr': i + 1,
            'name': bod.directors[i].name,
            'designation': bod.directors[i].designation,
            'mobile': bod.directors[i].mobile,
            'email': bod.directors[i].email,
          },
      ];
      final result = await buildReportXlsx(
        fileName: 'Board_of_Directors',
        subtitle:
            '${bod.clubName.isEmpty ? 'Club' : bod.clubName} · RY ${bod.selectedYearLabel}',
        sheets: [
          ReportSheet(
            name: 'Board of Directors',
            columns: const [
              ReportColumn('sr', 'Sr No', width: 8),
              ReportColumn('name', 'Name', width: 26),
              ReportColumn('designation', 'Designation', width: 26),
              ReportColumn('mobile', 'Mobile', width: 16),
              ReportColumn('email', 'Email', width: 30),
            ],
            rows: rows,
          ),
        ],
      );
      if (!mounted) return;
      await shareReportXlsx(context, result, 'Board of Directors');
    } catch (e) {
      if (!mounted) return;
      SnackbarUtils.showError(context, 'Export failed: $e');
    }
  }
}

class _DirectorRow extends StatelessWidget {
  final BodDirectorRow director;
  final int index;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _DirectorRow({
    required this.director,
    required this.index,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final color = Color(director.colorArgb);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(10, 10, 6, 10),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 20,
            child: Text('${index + 1}',
                style: AppFonts.body(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate400)),
          ),
          Container(
            width: 36,
            height: 36,
            decoration:
                BoxDecoration(color: color, borderRadius: BorderRadius.circular(8)),
            alignment: Alignment.center,
            child: Text(director.initials,
                style: AppFonts.body(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                    color: Colors.white)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(director.name,
                          style: AppFonts.body(
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                              color: AppColors.textPrimary)),
                    ),
                    if (!director.isMember) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppColors.slate200,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text('Non-Member',
                            style: AppFonts.body(
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                                color: AppColors.slate500)),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: director.designation.isNotEmpty
                        ? color.withValues(alpha: 0.09)
                        : AppColors.slate100,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                      director.designation.isNotEmpty
                          ? director.designation
                          : 'No designation',
                      style: AppFonts.body(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: director.designation.isNotEmpty
                              ? color
                              : AppColors.slate500)),
                ),
                const SizedBox(height: 4),
                if (director.mobile.isNotEmpty)
                  InkWell(
                    onTap: () => launchUrl(
                        Uri(scheme: 'tel', path: director.mobile.trim())),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(children: [
                        const Icon(Icons.phone_rounded,
                            size: 11, color: AppColors.slate400),
                        const SizedBox(width: 3),
                        Text(director.mobile,
                            style: AppFonts.body(
                                fontSize: 11,
                                color: AppColors.rotaryBlue,
                                fontWeight: FontWeight.w600)),
                      ]),
                    ),
                  ),
                if (director.email.isNotEmpty)
                  InkWell(
                    onTap: () => launchUrl(
                        Uri(scheme: 'mailto', path: director.email.trim())),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(children: [
                        const Icon(Icons.email_outlined,
                            size: 11, color: AppColors.slate400),
                        const SizedBox(width: 3),
                        Expanded(
                          child: Text(director.email,
                              style: AppFonts.body(
                                  fontSize: 11, color: AppColors.rotaryBlue),
                              overflow: TextOverflow.ellipsis),
                        ),
                      ]),
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            onPressed: onEdit,
            icon: const Icon(Icons.edit_outlined, size: 18),
            color: AppColors.rotaryBlue,
            visualDensity: VisualDensity.compact,
            tooltip: 'Edit',
          ),
          IconButton(
            onPressed: onDelete,
            icon: const Icon(Icons.delete_outline_rounded, size: 18),
            color: AppColors.error,
            visualDensity: VisualDensity.compact,
            tooltip: 'Delete',
          ),
        ],
      ),
    );
  }
}
