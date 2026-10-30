import 'package:flutter/material.dart' hide Text;
import '../../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../../core/theme/app_colors.dart';
import '../../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../districts/overview/widgets/stat_card.dart';
import '../../../../../widgets/common/dashboard_refresh.dart';
import '../club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Dashboard › "Rotary Network" sub-tab — read-only.
///
/// Mirrors the web "Rotary Network" panel: a 4-card KPI strip
/// (Total Terminated / This Rotary Year / Now Member / Lack of Participation)
/// over a single "Rotary Network" card holding a two-pill toggle
/// (Terminated Members / Potential Members), a search field, and the active
/// member list. Wired to `getDashboardRotaryNetwork(clubId)`.
class DashboardRotaryNetworkSubtab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const DashboardRotaryNetworkSubtab(
      {super.key, required this.clubId, this.yearId});

  @override
  State<DashboardRotaryNetworkSubtab> createState() =>
      _DashboardRotaryNetworkSubtabState();
}

class _DashboardRotaryNetworkSubtabState
    extends State<DashboardRotaryNetworkSubtab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminRotaryNetwork> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.getDashboardRotaryNetwork(widget.clubId, yearId: widget.yearId);
  }

  void _reload() => setState(
      () => _future = _api.getDashboardRotaryNetwork(widget.clubId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getDashboardRotaryNetwork(widget.clubId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ClubAdminRotaryNetwork>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        return DashboardRefresh.around(
          onRefresh: _refresh,
          child: _Body(data: snap.data!),
        );
      },
    );
  }
}

// ── Body ─────────────────────────────────────────────────────────────────────

class _Body extends StatelessWidget {
  final ClubAdminRotaryNetwork data;
  const _Body({required this.data});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _KpiGrid(cards: [
            StatCard(
              label: 'Total Terminated',
              value: '${data.totalTerminated}',
              sub: 'All records',
              accent: AppColors.avenueClubService,
            ),
            StatCard(
              label: 'This Rotary Year',
              value: '${data.thisRotaryYear}',
              sub: 'Terminated this year',
              accent: AppColors.avenuePublicImage,
            ),
            StatCard(
              label: 'Now Member',
              value: '${data.nowMember}',
              sub: 'Returned to current',
              accent: AppColors.avenueVocational,
            ),
            StatCard(
              label: 'Lack of Participation',
              value: '${data.lackOfParticipation}',
              sub: 'Engagement issue',
              accent: AppColors.avenueInternational,
            ),
          ]),
          const SizedBox(height: 14),
          _RotaryNetworkCard(data: data),
        ],
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

// ── Rotary Network card (toggle + search + list) ─────────────────────────────

class _RotaryNetworkCard extends StatefulWidget {
  final ClubAdminRotaryNetwork data;
  const _RotaryNetworkCard({required this.data});

  @override
  State<_RotaryNetworkCard> createState() => _RotaryNetworkCardState();
}

class _RotaryNetworkCardState extends State<_RotaryNetworkCard> {
  bool _showTerminated = true; // true = Terminated, false = Potential
  String _query = '';

  List<RotaryNetworkRow> get _activeList =>
      _showTerminated ? widget.data.terminated : widget.data.potential;

  List<RotaryNetworkRow> get _filtered {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return _activeList;
    return _activeList.where((r) {
      return r.fullName.toLowerCase().contains(q) ||
          r.memberId.toLowerCase().contains(q) ||
          (r.terminationReason ?? '').toLowerCase().contains(q) ||
          r.memberType.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    final isTerminated = _showTerminated;
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
          Text('Rotary Network',
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          Text('Manage terminated and prospective members',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
          const SizedBox(height: 12),
          _ToggleBar(
            showTerminated: isTerminated,
            terminatedCount: widget.data.terminated.length,
            potentialCount: widget.data.potential.length,
            onSelect: (v) => setState(() => _showTerminated = v),
          ),
          const SizedBox(height: 10),
          _SearchField(
            onChanged: (v) => setState(() => _query = v),
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 22),
              child: Center(
                child: Text(
                  isTerminated
                      ? 'No terminated members.'
                      : 'No potential members.',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400),
                ),
              ),
            )
          else
            for (var i = 0; i < rows.length; i++) ...[
              _MemberRow(row: rows[i], isTerminated: isTerminated),
              if (i != rows.length - 1)
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 8),
                  height: 1,
                  color: AppColors.slate100,
                ),
            ],
          const SizedBox(height: 10),
          Text(
            isTerminated
                ? '${rows.length} terminated member'
                    '${rows.length == 1 ? '' : 's'}'
                    '${_query.trim().isEmpty ? '' : ' (filtered)'}'
                : '${rows.length} potential member'
                    '${rows.length == 1 ? '' : 's'}'
                    '${_query.trim().isEmpty ? '' : ' (filtered)'}',
            style: AppFonts.body(
                fontSize: 13, color: AppColors.slate400),
          ),
        ],
      ),
    );
  }
}

// ── Two-pill toggle ──────────────────────────────────────────────────────────

class _ToggleBar extends StatelessWidget {
  final bool showTerminated;
  final int terminatedCount;
  final int potentialCount;
  final ValueChanged<bool> onSelect;
  const _ToggleBar({
    required this.showTerminated,
    required this.terminatedCount,
    required this.potentialCount,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    Widget pill(String label, int count, bool isThis) {
      final active = isThis == showTerminated;
      return Padding(
        padding: const EdgeInsets.only(right: 6),
        child: Material(
          color: active ? AppColors.rotaryBlue : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          child: InkWell(
            onTap: () => onSelect(isThis),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(
                '$label ($count)',
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                  color: active ? Colors.white : AppColors.slate500,
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(10),
      ),
      padding: const EdgeInsets.all(4),
      child: Row(
        children: [
          Expanded(child: pill('Terminated Members', terminatedCount, true)),
          Expanded(child: pill('Potential Members', potentialCount, false)),
        ],
      ),
    );
  }
}

// ── Search field ─────────────────────────────────────────────────────────────

class _SearchField extends StatelessWidget {
  final ValueChanged<String> onChanged;
  const _SearchField({required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      style: AppFonts.body(
          fontSize: 13, color: AppColors.textPrimary),
      decoration: InputDecoration(
        isDense: true,
        hintText: 'Search...',
        hintStyle: AppFonts.body(
            fontSize: 13, color: AppColors.slate400),
        prefixIcon: const Icon(Icons.search_rounded,
            size: 18, color: AppColors.slate400),
        prefixIconConstraints:
            const BoxConstraints(minWidth: 36, minHeight: 36),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        filled: true,
        fillColor: Colors.white,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.slate200),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.rotaryBlue),
        ),
      ),
    );
  }
}

// ── Member row ───────────────────────────────────────────────────────────────

class _MemberRow extends StatelessWidget {
  final RotaryNetworkRow row;
  final bool isTerminated;
  const _MemberRow({required this.row, required this.isTerminated});

  @override
  Widget build(BuildContext context) {
    final name = row.fullName.isEmpty ? row.memberId : row.fullName;
    final adm = (row.admissionDate ?? '').trim();
    final term = (row.terminationDate ?? '').trim();
    final reason = (row.terminationReason ?? '').trim();
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _avatar(name),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      name,
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (row.memberId.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text(
                      row.memberId,
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.slate500),
                    ),
                  ],
                ],
              ),
              if (row.memberType.isNotEmpty) ...[
                const SizedBox(height: 4),
                _typeBadge(row.memberType),
              ],
              if (isTerminated) ...[
                if (adm.isNotEmpty)
                  _dateLine('Admitted', adm),
                if (term.isNotEmpty)
                  _dateLine('Terminated', term),
              ] else if (adm.isNotEmpty)
                _dateLine('Admitted', adm),
              if (isTerminated && reason.isNotEmpty) ...[
                const SizedBox(height: 4),
                _reasonChip(reason),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _dateLine(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text.rich(
        TextSpan(children: [
          TextSpan(
            text: '$label: ',
            style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.slate500),
          ),
          TextSpan(
            text: value,
            style: AppFonts.body(
                fontSize: 13, color: AppColors.slate500),
          ),
        ]),
      ),
    );
  }

  Widget _typeBadge(String type) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Text(
        type,
        style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.slate700),
      ),
    );
  }

  Widget _reasonChip(String reason) {
    final style = _reasonStyle(reason);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: style.bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        reason,
        style: AppFonts.body(
            fontSize: 13, fontWeight: FontWeight.w700, color: style.fg),
      ),
    );
  }

  ({Color bg, Color fg}) _reasonStyle(String reason) {
    final r = reason.toLowerCase();
    if (r.contains('death') || r.contains('deceased')) {
      return (bg: AppColors.slate100, fg: AppColors.slate700);
    }
    if (r.contains('non-payment') ||
        r.contains('non payment') ||
        r.contains('dues') ||
        r.contains('lack') ||
        r.contains('participation') ||
        r.contains('attendance')) {
      return (bg: AppColors.errorLight, fg: AppColors.error);
    }
    if (r.contains('transfer') || r.contains('relocat')) {
      return (bg: AppColors.muted, fg: AppColors.accentBlue);
    }
    return (bg: AppColors.warningLight, fg: AppColors.warningInk);
  }

  Widget _avatar(String name) {
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.slate100,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.slate200),
      ),
      child: Text(
        initial,
        style: AppFonts.body(
            fontSize: 14,
            fontWeight: FontWeight.w800,
            color: AppColors.slate700),
      ),
    );
  }
}
