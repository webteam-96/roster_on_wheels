import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../modules/projects/projects_screen.dart';
import '../../../districts/overview/widgets/stat_card.dart';
import 'club_dashboard_async.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../widgets/common/labeled_stat.dart';
import '../../../../widgets/common/expandable_record_card.dart';
import '../../../../widgets/common/ry_context_chip.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Service Projects" tab — wired to the live avenue endpoints
/// (`service-projects-overview` + `service-projects-avenue?avenueKey=`).
///
/// "All" shows club-wide KPIs + a per-avenue summary; selecting an avenue shows
/// that avenue's KPIs and detail (Club Service → meeting records; the rest →
/// one-time / ongoing project records). The React reference's goal-setter,
/// completion-frequency and promo banner are dropped — the club-admin API
/// exposes none of them.
class ClubAvenueTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubAvenueTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubAvenueTab> createState() => _ClubAvenueTabState();
}

/// The 6 fixed avenues (key → label/colour), matching the API's avenue keys.
const List<({String key, String label, int color})> _kAvenues = [
  (key: 'club_service', label: 'Club Service', color: 0xFF003DA5),
  (key: 'community_service', label: 'Community Service', color: 0xFF16A34A),
  (key: 'vocational_service', label: 'Vocational Service', color: 0xFF0891B2),
  (key: 'international_service', label: 'International Service', color: 0xFF9333EA),
  (key: 'new_generation_service', label: 'New Generation', color: 0xFFF59E0B),
  (key: 'public_image_initiative', label: 'Public Image', color: 0xFFE11D48),
];

int _avenueColor(String key) => _kAvenues
    .firstWhere((a) => a.key == key,
        orElse: () => (key: key, label: key, color: 0xFF64748B))
    .color;

/// Avenues that map to a real project module (`ProjectsScreen.moduleType`) and
/// therefore support Add / Edit / Delete in the projects list. Club Service is
/// handled separately (it shows meetings, with Add Meeting + per-row Edit
/// wired to the `club_service` module — see `_MeetingsList`).
const Set<String> _kProjectAvenueKeys = {
  'community_service',
  'vocational_service',
  'international_service',
  'new_generation_service',
  'public_image_initiative',
};

class _ClubAvenueTabState extends State<ClubAvenueTab>
    with AutomaticKeepAliveClientMixin<ClubAvenueTab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  String _activeKey = 'ALL';
  int? _yearId;
  String _filter = 'all'; // all | one | ongoing
  late Future<Object> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _yearId = widget.yearId; // seed from the global selector
    _future = _load();
  }

  Future<Object> _load() => _activeKey == 'ALL'
      ? _api.getServiceProjectsOverview(widget.clubId, yearId: _yearId)
      : _api.getServiceProjectsAvenue(widget.clubId, _activeKey,
          yearId: _yearId);

  void _selectAvenue(String key) => setState(() {
        _activeKey = key;
        _filter = 'all';
        _future = _load();
      });

  void _setFilter(String f) => setState(() => _filter = f);

  void _reload() => setState(() => _future = _load());

  /// Open the existing per-avenue management screen — for Add (auto-opens the
  /// form) or Edit (deep-links to that project's form). Refreshes on return.
  Future<void> _openProjects(String avenueKey,
      {bool add = false, int? editProjectId, int? editYearId}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProjectsScreen(
          clubId: widget.clubId,
          moduleType: avenueKey,
          autoOpenAdd: add,
          autoOpenEditProjectId: editProjectId,
          autoOpenEditYearId: editYearId,
        ),
      ),
    );
    if (mounted) _reload();
  }

  Future<void> _deleteProject(int? yearId, SpProject p) async {
    if (yearId == null) {
      SnackbarUtils.showError(context, 'Cannot delete: missing project year');
      return;
    }
    final ok = await ConfirmationDialog.show(
      context,
      title: 'Delete Project',
      message: 'Delete "${p.title}"? This cannot be undone.',
    );
    if (ok != true) return;
    try {
      await ApiClient()
          .delete('/api/clubs/${widget.clubId}/projects/$yearId/${p.id}');
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Project deleted');
      _reload();
    } catch (_) {
      if (!mounted) return;
      SnackbarUtils.showError(context, 'Failed to delete project');
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _AvenuePillBar(active: _activeKey, onSelect: _selectAvenue),
          const SizedBox(height: 14),
          FutureBuilder<Object>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const ClubDashboardLoading();
              }
              if (snap.hasError) {
                return ClubDashboardError(error: snap.error!, onRetry: _reload);
              }
              final data = snap.data;
              if (data is ServiceProjectsOverview) {
                return _AllView(
                    ov: data,
                    onOpenAvenue: _selectAvenue);
              }
              if (data is ServiceProjectsAvenueDetail) {
                return _AvenueView(
                  av: data,
                  filter: _filter,
                  onFilter: _setFilter,
                  onAddProject: () => _openProjects(data.avenueKey, add: true),
                  onEditProject: (p) => _openProjects(
                    data.avenueKey,
                    editProjectId: p.id,
                    editYearId: data.selectedYearId,
                  ),
                  onDeleteProject: (p) =>
                      _deleteProject(data.selectedYearId, p),
                  // Club Service "meetings" reuse the same club_service module
                  // (ProjectsScreen with showMeetingFields) for Add / Edit.
                  onEditMeeting: (id) => _openProjects(
                    data.avenueKey,
                    editProjectId: id,
                    editYearId: data.selectedYearId,
                  ),
                );
              }
              return const SizedBox.shrink();
            },
          ),
        ],
      ),
    );
  }
}

// ── Avenue pill bar ──────────────────────────────────────────────────────────

class _AvenuePillBar extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _AvenuePillBar({required this.active, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    Widget pill(String key, String label, Color bgWhenActive) {
      final isActive = key == active;
      return Padding(
        padding: const EdgeInsets.only(right: 4),
        child: Material(
          color: isActive ? bgWhenActive : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          child: InkWell(
            onTap: () => onSelect(key),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(
                label,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
                  color: isActive ? Colors.white : AppColors.slate500,
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.all(6),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            pill('ALL', 'All', AppColors.primaryDeep),
            for (final a in _kAvenues) pill(a.key, a.label, Color(a.color)),
          ],
        ),
      ),
    );
  }
}

// ── KPI grid (2-col, last spans if odd) ──────────────────────────────────────

class _KpiGrid extends StatelessWidget {
  final List<StatCard> cards;
  const _KpiGrid({required this.cards});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += 2) {
      if (i + 1 < cards.length) {
        rows.add(Row(children: [
          Expanded(child: cards[i]),
          const SizedBox(width: 10),
          Expanded(child: cards[i + 1]),
        ]));
      } else {
        rows.add(cards[i]);
      }
      if (i + 2 < cards.length) rows.add(const SizedBox(height: 10));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }
}

// ── shared bits ──────────────────────────────────────────────────────────────

class _CardShell extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget child;
  const _CardShell({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: AppFonts.body(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              if (subtitle.isNotEmpty)
                Text(subtitle,
                    style: AppFonts.body(
                        fontSize: 11, color: AppColors.slate500)),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

// ── All view ─────────────────────────────────────────────────────────────────

class _AllView extends StatelessWidget {
  final ServiceProjectsOverview ov;
  final ValueChanged<String> onOpenAvenue;
  const _AllView({required this.ov, required this.onOpenAvenue});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SpHeader(yearLabel: ov.selectedYearLabel),
        const SizedBox(height: 12),
        _KpiGrid(cards: [
          StatCard(
            label: 'Total Projects',
            value: fmtInt(ov.totalProjects),
            sub: 'Across all avenues',
            accent: AppColors.primaryDeep,
          ),
          StatCard(
            label: 'Total Beneficiaries',
            value: fmtInt(ov.totalBeneficiaries),
            sub: 'Lives impacted',
            accent: AppColors.avenueVocational,
          ),
          StatCard(
            label: 'Total Project Cost',
            value: shortMoney(ov.totalCost, ov.targetCurrency),
            sub: 'Amount invested',
            accent: AppColors.avenuePublicImage,
          ),
          StatCard(
            label: 'Man Hours',
            value: fmtInt(ov.totalManHours),
            sub: 'Volunteer time',
            accent: AppColors.avenueNewGen,
          ),
          StatCard(
            label: 'Meetings Held',
            value: fmtInt(ov.meetingsHeld),
            sub: 'Club service',
            accent: AppColors.avenueInternational,
          ),
        ]),
        const SizedBox(height: 14),
        _CardShell(
          title: 'All Avenues',
          subtitle: 'Summary by avenue · RY ${ov.selectedYearLabel}',
          child: Column(
            children: [
              if (ov.avenues.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('No project data for this year',
                      style: AppFonts.body(
                          fontSize: 12, color: AppColors.slate400)),
                ),
              for (var i = 0; i < ov.avenues.length; i++) ...[
                _AvenueSummaryCard(
                    key: ValueKey(ov.avenues[i].avenueKey),
                    row: ov.avenues[i],
                    targetCurrency: ov.targetCurrency,
                    onOpenAvenue: onOpenAvenue),
                if (i != ov.avenues.length - 1)
                  Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    height: 1,
                    color: AppColors.slate100,
                  ),
              ],
              if (ov.avenues.isNotEmpty) const CurrencyLegend(),
            ],
          ),
        ),
      ],
    );
  }
}

/// Compact page header shown at the top of each Service Projects view.
class _SpHeader extends StatelessWidget {
  final String yearLabel;
  const _SpHeader({required this.yearLabel});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            'Service Projects & Public Image',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary),
          ),
        ),
        const SizedBox(width: 8),
        RyContextChip(yearLabel: yearLabel),
      ],
    );
  }
}

/// One avenue row in the "All Avenues" summary — collapsed shows name + count;
/// expanding reveals a labeled Beneficiaries / Cost / Man-Hours grid and a
/// "View all" jump to that avenue's tab. (Club Service shows a meetings note.)
class _AvenueSummaryCard extends StatelessWidget {
  final SpAvenueSummary row;
  // Currency for the per-avenue Cost subtotal (converted into the district
  // default by the backend). Per-project rows keep their own currency.
  final String targetCurrency;
  final ValueChanged<String> onOpenAvenue;
  const _AvenueSummaryCard(
      {super.key,
      required this.row,
      required this.targetCurrency,
      required this.onOpenAvenue});

  @override
  Widget build(BuildContext context) {
    final color = Color(_avenueColor(row.avenueKey));
    final isClubService = row.avenueKey == 'club_service';
    final countLabel =
        isClubService ? '${row.projects} meetings' : '${row.projects} projects';

    final title = Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(row.avenueName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              Text(countLabel,
                  style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.slate500)),
            ],
          ),
        ),
      ],
    );

    final Widget expanded = isClubService
        ? Padding(
            padding: const EdgeInsets.only(left: 18),
            child: Text(
              'Club Service tracks meetings, not project metrics.',
              style: AppFonts.body(
                  fontSize: 11, color: AppColors.slate400),
            ),
          )
        : Padding(
            padding: const EdgeInsets.only(left: 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                StatGrid(stats: [
                  LabeledStat(
                      label: 'Beneficiaries',
                      value:
                          row.beneficiaries > 0 ? fmtInt(row.beneficiaries) : '',
                      valueColor: color),
                  LabeledStat(
                      label: 'Cost',
                      value:
                          row.cost > 0 ? shortMoney(row.cost, targetCurrency) : '',
                      valueColor: color),
                  LabeledStat(
                      label: 'Man-Hours',
                      value: row.manHours > 0 ? fmtInt(row.manHours) : '',
                      valueColor: color),
                ]),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () => onOpenAvenue(row.avenueKey),
                    style: TextButton.styleFrom(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      minimumSize: const Size(0, 0),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text('View all ${row.avenueName} →',
                        style: AppFonts.body(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w800,
                            color: color)),
                  ),
                ),
              ],
            ),
          );

    return ExpandableRecordCard(collapsedTitle: title, expandedChild: expanded);
  }
}

// ── Avenue view ──────────────────────────────────────────────────────────────

class _AvenueView extends StatelessWidget {
  final ServiceProjectsAvenueDetail av;
  final String filter;
  final ValueChanged<String> onFilter;
  final VoidCallback onAddProject;
  final ValueChanged<SpProject> onEditProject;
  final ValueChanged<SpProject> onDeleteProject;
  final ValueChanged<int> onEditMeeting;
  const _AvenueView({
    required this.av,
    required this.filter,
    required this.onFilter,
    required this.onAddProject,
    required this.onEditProject,
    required this.onDeleteProject,
    required this.onEditMeeting,
  });

  @override
  Widget build(BuildContext context) {
    final color = Color(_avenueColor(av.avenueKey));
    final canManage = _kProjectAvenueKeys.contains(av.avenueKey);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SpHeader(yearLabel: av.selectedYearLabel),
        const SizedBox(height: 12),
        if (av.isClubService)
          _clubServiceKpis(color)
        else
          _projectKpis(color),
        const SizedBox(height: 14),
        _CardShell(
          title: av.avenueName,
          subtitle:
              '${av.isClubService ? 'Meeting records' : 'Project records'} · RY ${av.selectedYearLabel}',
          child: av.isClubService
              ? _MeetingsList(
                  meetings: av.meetings,
                  onAdd: onAddProject,
                  onEdit: onEditMeeting,
                )
              : _ProjectsSection(
                  av: av,
                  filter: filter,
                  onFilter: onFilter,
                  color: color,
                  canManage: canManage,
                  onAdd: onAddProject,
                  onEdit: onEditProject,
                  onDelete: onDeleteProject,
                ),
        ),
      ],
    );
  }

  Widget _clubServiceKpis(Color color) {
    final k = av.kpis;
    // Club Service shows only Meetings Held + Avg Attendance (matches web).
    return _KpiGrid(cards: [
      StatCard(
          label: 'Meetings Held',
          value: '${k.meetingsHeld ?? av.meetings.length}',
          sub: 'RY ${av.selectedYearLabel}',
          accent: color),
      StatCard(
          label: 'Avg Attendance',
          value: '${(k.avgAttendancePercent ?? 0).round()}%',
          sub: 'Across meetings',
          accent: color),
    ]);
  }

  Widget _projectKpis(Color color) {
    final k = av.kpis;
    return _KpiGrid(cards: [
      StatCard(
          label: 'Projects',
          value: fmtInt(k.projects ??
              (av.oneTimeProjects.length + av.ongoingProjects.length)),
          sub: av.avenueName,
          accent: color),
      StatCard(
          label: 'Beneficiaries',
          value: fmtInt(k.beneficiaries ?? 0),
          sub: 'Lives impacted',
          accent: color),
      StatCard(
          label: 'Amount Spent',
          value: shortMoney(k.amountSpent ?? 0, av.targetCurrency),
          sub: 'Project investment',
          accent: color),
      StatCard(
          label: 'Man Hours',
          value: fmtInt(k.manHours ?? 0),
          sub: 'Volunteer time',
          accent: color),
    ]);
  }
}

// ── Meetings list (Club Service) ─────────────────────────────────────────────

/// Reusable search field for the meeting / project lists.
class _SearchField extends StatelessWidget {
  final String hint;
  final ValueChanged<String> onChanged;
  const _SearchField({required this.hint, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      style: AppFonts.body(fontSize: 13),
      decoration: InputDecoration(
        hintText: hint,
        isDense: true,
        prefixIcon: const Icon(Icons.search_rounded, size: 18),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        border:
            OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }
}

class _MeetingsList extends StatefulWidget {
  final List<SpMeeting> meetings;
  final VoidCallback? onAdd;
  final ValueChanged<int>? onEdit;
  const _MeetingsList({required this.meetings, this.onAdd, this.onEdit});

  @override
  State<_MeetingsList> createState() => _MeetingsListState();
}

class _MeetingsListState extends State<_MeetingsList> {
  String _q = '';
  int _shown = 20;

  List<SpMeeting> get _filtered {
    final q = _q.trim().toLowerCase();
    if (q.isEmpty) return widget.meetings;
    return widget.meetings
        .where((m) =>
            m.title.toLowerCase().contains(q) ||
            m.meetingType.toLowerCase().contains(q) ||
            m.date.toLowerCase().contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final visible = filtered.take(_shown).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.onAdd != null) ...[
          ElevatedButton.icon(
            onPressed: widget.onAdd,
            icon: const Icon(Icons.add_rounded, size: 16),
            label: Text('Add Meeting',
                style: AppFonts.body(
                    fontSize: 12, fontWeight: FontWeight.w700)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusDone,
              foregroundColor: Colors.white,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8)),
            ),
          ),
          const SizedBox(height: 10),
        ],
        if (widget.meetings.isNotEmpty) ...[
          _SearchField(
            hint: 'Search meetings…',
            onChanged: (v) => setState(() {
              _q = v;
              _shown = 20;
            }),
          ),
          const SizedBox(height: 8),
        ],
        if (filtered.isEmpty)
          Text(_q.isEmpty ? 'No meetings recorded' : 'No meetings match "$_q"',
              style: AppFonts.body(
                  fontSize: 12, color: AppColors.slate400))
        else ...[
          for (var i = 0; i < visible.length; i++) ...[
            _MeetingCard(
              key: ValueKey(visible[i].id),
              m: visible[i],
              onEdit: widget.onEdit == null
                  ? null
                  : () => widget.onEdit!(visible[i].id),
            ),
            if (i != visible.length - 1)
              Container(
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  height: 1,
                  color: AppColors.slate100),
          ],
          if (_shown < filtered.length)
            Center(
              child: TextButton(
                onPressed: () => setState(() => _shown += 20),
                child: Text('Show more',
                    style: AppFonts.body(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.rotaryBlue)),
              ),
            ),
          const SizedBox(height: 6),
          Text('Showing ${visible.length} of ${filtered.length} meetings',
              style: AppFonts.body(
                  fontSize: 10.5, color: AppColors.slate400)),
        ],
      ],
    );
  }
}

class _MeetingCard extends StatelessWidget {
  final SpMeeting m;
  final VoidCallback? onEdit;
  const _MeetingCard({super.key, required this.m, this.onEdit});

  Color _att(double pct) {
    if (pct >= 75) return AppColors.statusDone;
    if (pct >= 65) return AppColors.statusPart;
    return AppColors.statusNone;
  }

  @override
  Widget build(BuildContext context) {
    final attColor = _att(m.attendancePercent);
    final title = Text(
      m.title.isEmpty ? (m.meetingType.isEmpty ? 'Meeting' : m.meetingType) : m.title,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: AppFonts.body(
          fontSize: 12.5,
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary),
    );
    final trailing = Text('${m.attendancePercent.round()}%',
        style: AppFonts.body(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: attColor,
            fontFeatures: const [FontFeature.tabularFigures()]));
    final expanded = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        StatGrid(stats: [
          LabeledStat(label: 'Date', value: m.date),
          LabeledStat(label: 'Meeting Type', value: m.meetingType),
          LabeledStat(
              label: 'Attendance',
              value: '${m.attendance}/${m.membersOnRoll}'),
        ]),
        if (onEdit != null) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: onEdit,
              icon: const Icon(Icons.edit_outlined, size: 15),
              label: Text('Edit',
                  style: AppFonts.body(
                      fontSize: 11.5, fontWeight: FontWeight.w700)),
              style: TextButton.styleFrom(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  minimumSize: const Size(0, 0),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap),
            ),
          ),
        ],
      ],
    );
    return ExpandableRecordCard(
        collapsedTitle: title,
        collapsedTrailing: trailing,
        expandedChild: expanded);
  }
}

// ── Projects section (other avenues) ─────────────────────────────────────────

/// Avenues that collect a One-time vs Ongoing/Repeat distinction (web shows the
/// toggle + Type column only for these); others merge the lists.
const Set<String> _kTypeToggleAvenues = {
  'community_service',
  'public_image_initiative',
};

class _ProjectsSection extends StatefulWidget {
  final ServiceProjectsAvenueDetail av;
  final String filter; // all | one | ongoing
  final ValueChanged<String> onFilter;
  final Color color;
  final bool canManage;
  final VoidCallback onAdd;
  final ValueChanged<SpProject> onEdit;
  final ValueChanged<SpProject> onDelete;
  const _ProjectsSection({
    required this.av,
    required this.filter,
    required this.onFilter,
    required this.color,
    required this.canManage,
    required this.onAdd,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<_ProjectsSection> createState() => _ProjectsSectionState();
}

class _ProjectsSectionState extends State<_ProjectsSection> {
  String _q = '';
  int _shown = 20;

  @override
  Widget build(BuildContext context) {
    final av = widget.av;
    final showToggle = _kTypeToggleAvenues.contains(av.avenueKey);
    final base = !showToggle
        ? <SpProject>[...av.oneTimeProjects, ...av.ongoingProjects]
        : switch (widget.filter) {
            'one' => av.oneTimeProjects,
            'ongoing' => av.ongoingProjects,
            _ => <SpProject>[...av.oneTimeProjects, ...av.ongoingProjects],
          };
    final q = _q.trim().toLowerCase();
    final filtered = q.isEmpty
        ? base
        : base
            .where((p) =>
                p.title.toLowerCase().contains(q) ||
                p.type.toLowerCase().contains(q))
            .toList();
    final visible = filtered.take(_shown).toList();

    const filters = [
      (id: 'all', label: 'All'),
      (id: 'one', label: 'One-time'),
      (id: 'ongoing', label: 'Ongoing / Recurring'),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.canManage) ...[
          ElevatedButton.icon(
            onPressed: widget.onAdd,
            icon: const Icon(Icons.add_rounded, size: 16),
            label: Text('Add Project',
                style: AppFonts.body(
                    fontSize: 12, fontWeight: FontWeight.w700)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusDone,
              foregroundColor: Colors.white,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8)),
            ),
          ),
          const SizedBox(height: 10),
        ],
        if (showToggle) ...[
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              for (final f in filters)
                Material(
                  color: f.id == widget.filter
                      ? AppColors.slate700
                      : AppColors.slate100,
                  borderRadius: BorderRadius.circular(6),
                  child: InkWell(
                    onTap: () => widget.onFilter(f.id),
                    borderRadius: BorderRadius.circular(6),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      child: Text(f.label,
                          style: AppFonts.body(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: f.id == widget.filter
                                  ? Colors.white
                                  : AppColors.slate500)),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
        ],
        _SearchField(
          hint: 'Search projects…',
          onChanged: (v) => setState(() {
            _q = v;
            _shown = 20;
          }),
        ),
        const SizedBox(height: 12),
        if (filtered.isEmpty)
          Text(_q.isEmpty ? 'No projects recorded' : 'No projects match "$_q"',
              style: AppFonts.body(
                  fontSize: 12, color: AppColors.slate400))
        else ...[
          for (var i = 0; i < visible.length; i++) ...[
            _ProjectCard(
              key: ValueKey(visible[i].id),
              p: visible[i],
              sr: i + 1,
              color: widget.color,
              canManage: widget.canManage,
              onEdit: () => widget.onEdit(visible[i]),
              onDelete: () => widget.onDelete(visible[i]),
            ),
            if (i != visible.length - 1)
              Container(
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  height: 1,
                  color: AppColors.slate100),
          ],
          if (_shown < filtered.length)
            Center(
              child: TextButton(
                onPressed: () => setState(() => _shown += 20),
                child: Text('Show more',
                    style: AppFonts.body(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.rotaryBlue)),
              ),
            ),
          const SizedBox(height: 6),
          Text('Showing ${visible.length} of ${filtered.length} projects',
              style: AppFonts.body(
                  fontSize: 10.5, color: AppColors.slate400)),
        ],
      ],
    );
  }
}

class _ProjectCard extends StatelessWidget {
  final SpProject p;
  final int sr;
  final Color color;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _ProjectCard({
    super.key,
    required this.p,
    required this.sr,
    required this.color,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final title = Row(
      children: [
        SizedBox(
          width: 22,
          child: Text('$sr',
              style: AppFonts.body(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate400,
                  fontFeatures: const [FontFeature.tabularFigures()])),
        ),
        Expanded(
          child: Text(p.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
        ),
      ],
    );
    final expanded = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        StatGrid(stats: [
          LabeledStat(
              label: 'Cost',
              value: p.cost > 0 ? shortMoney(p.cost, p.currency) : '',
              valueColor: color),
          LabeledStat(
              label: 'Direct Benf',
              value: p.beneficiaries > 0 ? fmtInt(p.beneficiaries) : ''),
          LabeledStat(
              label: 'Man-Hours',
              value: p.manHours > 0 ? fmtInt(p.manHours) : ''),
        ]),
        const SizedBox(height: 8),
        StatGrid(stats: [
          LabeledStat(label: 'Date', value: p.date),
          LabeledStat(label: 'Type', value: p.type),
          LabeledStat(
              label: 'Joint',
              value: p.isJoint
                  ? (p.coHostName != null && p.coHostName!.isNotEmpty
                      ? p.coHostName!
                      : 'Yes')
                  : ''),
        ]),
        if (canManage) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: Text('Edit',
                      style: AppFonts.body(
                          fontSize: 12, fontWeight: FontWeight.w700)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.rotaryBlue,
                    side: const BorderSide(color: AppColors.slate200),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onDelete,
                  icon: const Icon(Icons.delete_outline_rounded, size: 16),
                  label: Text('Delete',
                      style: AppFonts.body(
                          fontSize: 12, fontWeight: FontWeight.w700)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.error,
                    side: BorderSide(
                        color: AppColors.error.withValues(alpha: 0.4)),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
    return ExpandableRecordCard(
      collapsedTitle: title,
      expandedChild: expanded,
    );
  }
}
