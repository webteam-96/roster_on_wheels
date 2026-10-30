import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import '../../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import 'district_dashboard_async.dart';
import 'stat_card.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// District-admin **Rotary Network** tab — read-only.
///
/// Mirrors the web `district-admin-dashboard/rotary-network` page: terminated +
/// prospective members across every club in the district, a club filter, and a
/// "Refresh from Rotary.org" action that warms the server-side terminated cache
/// (background job, polled for progress). Wired to the NON-mobile
/// `/api/district-admin-dashboard/rotary-network*` endpoints.
///
/// Fast path: when the Terminated view has ONE club selected, a live Rotary.org
/// fetch for that club replaces the cached list.
class RotaryNetworkTab extends StatefulWidget {
  final int districtId;
  final int? yearId;
  const RotaryNetworkTab({super.key, required this.districtId, this.yearId});

  @override
  State<RotaryNetworkTab> createState() => _RotaryNetworkTabState();
}

class _RotaryNetworkTabState extends State<RotaryNetworkTab> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();
  late Future<DaRotaryNetwork> _future;

  int? _clubId; // null = all clubs
  bool _showTerminated = true;
  String _query = '';

  // Per-club live Rotary.org terminated fast path (Terminated + one club).
  List<DaNetworkRow>? _live;
  bool _liveLoading = false;
  String? _liveWarning;

  // Background terminated-cache refresh job.
  DaRefreshStatus? _job;
  bool _polling = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
    _checkRefreshStatus();
  }

  Future<DaRotaryNetwork> _fetch() =>
      _api.getRotaryNetwork(widget.districtId, yearId: widget.yearId, clubId: _clubId);

  void _reload() => setState(() => _future = _fetch());

  Future<void> _refresh() async {
    final f = _fetch();
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  void _onClubChanged(int? id) {
    setState(() {
      _clubId = id;
      _future = _fetch();
      _live = null;
      _liveWarning = null;
    });
    _loadLive();
  }

  void _onToggle(bool terminated) {
    setState(() => _showTerminated = terminated);
    _loadLive();
  }

  /// Live fetch only makes sense on the Terminated view with one club selected.
  Future<void> _loadLive() async {
    final clubId = _clubId;
    if (!_showTerminated || clubId == null) {
      if (mounted) {
        setState(() {
          _live = null;
          _liveWarning = null;
          _liveLoading = false;
        });
      }
      return;
    }
    setState(() {
      _live = null;
      _liveWarning = null;
      _liveLoading = true;
    });
    try {
      final res = await _api.getLiveTerminated(widget.districtId, clubId);
      if (!mounted) return;
      setState(() {
        _live = res.members;
        _liveWarning = (res.warning ?? '').trim().isEmpty ? null : res.warning;
        _liveLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _liveWarning =
            'Could not fetch live data from Rotary.org. Showing stored records.';
        _liveLoading = false;
      });
    }
  }

  // ── Refresh-from-Rotary.org background job ────────────────────────────────
  Future<void> _checkRefreshStatus() async {
    try {
      final s = await _api.getTerminatedRefreshStatus(widget.districtId);
      if (!mounted) return;
      setState(() => _job = s);
      if (s.isRunning) _startPolling();
    } catch (_) {/* silent — the button still works */}
  }

  Future<void> _startRefresh() async {
    try {
      final s = await _api.startTerminatedRefresh(widget.districtId);
      if (!mounted) return;
      setState(() => _job = s);
      if (s.isRunning) {
        _startPolling();
      } else {
        _reload();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _job = const DaRefreshStatus(
            jobId: 0,
            districtId: 0,
            status: 'Failed',
            totalLinkedClubs: 0,
            clubsDone: 0,
            warning: 'Could not start the refresh. Please try again.',
          ));
    }
  }

  void _startPolling() {
    if (_polling) return;
    _polling = true;
    _poll();
  }

  Future<void> _poll() async {
    while (mounted && (_job?.isRunning ?? false)) {
      await Future<void>.delayed(const Duration(seconds: 2));
      if (!mounted) break;
      try {
        final s = await _api.getTerminatedRefreshStatus(widget.districtId);
        if (!mounted) break;
        setState(() => _job = s);
        if (!s.isRunning) {
          _reload(); // cache warmed — reload with fresh data
          break;
        }
      } catch (_) {
        break; // stop quietly; the last known status stays on screen
      }
    }
    _polling = false;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<DaRotaryNetwork>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const DaLoading();
        }
        if (snap.hasError) {
          return DaError(error: snap.error!, onRetry: _reload);
        }
        return DashboardRefresh.around(
          onRefresh: _refresh,
          child: _body(snap.data!),
        );
      },
    );
  }

  Widget _body(DaRotaryNetwork data) {
    final liveActive = _showTerminated && _live != null;
    final terminatedCount = liveActive ? _live!.length : data.totalTerminated;

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Expanded(
              child: StatCard(
                label: 'Total Terminated',
                value: '$terminatedCount',
                sub: liveActive ? 'Live from Rotary.org' : 'All clubs',
                accent: AppColors.avenueClubService,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatCard(
                label: 'Total Prospective',
                value: '${data.totalPotential}',
                sub: 'All clubs',
                accent: AppColors.rotaryBlue,
              ),
            ),
          ]),
          if (_job?.isRunning ?? false) ...[
            const SizedBox(height: 12),
            _RefreshProgress(job: _job!),
          ],
          if (!(_job?.isRunning ?? false) &&
              (_job?.warning ?? '').trim().isNotEmpty &&
              (_job?.status == 'Done' || _job?.status == 'Failed')) ...[
            const SizedBox(height: 12),
            _Banner(text: _job!.warning!, isError: _job!.status == 'Failed'),
          ],
          const SizedBox(height: 14),
          _card(data),
        ],
      ),
    );
  }

  Widget _card(DaRotaryNetwork data) {
    final isTerm = _showTerminated;
    final showClubSummary = isTerm && _clubId == null;

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
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Rotary Network',
                        style: AppFonts.body(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary)),
                    Text('Terminated and prospective members across the district',
                        style: AppFonts.body(
                            fontSize: 13, color: AppColors.slate500)),
                  ],
                ),
              ),
              _refreshButton(),
            ],
          ),
          const SizedBox(height: 12),
          _ToggleBar(
            showTerminated: isTerm,
            terminatedCount: data.terminated.length,
            potentialCount: data.potential.length,
            onSelect: _onToggle,
          ),
          const SizedBox(height: 10),
          _clubDropdown(data.clubs),
          const SizedBox(height: 10),
          _SearchField(onChanged: (v) => setState(() => _query = v)),
          const SizedBox(height: 4),
          if (_showTerminated && _liveWarning != null) ...[
            const SizedBox(height: 8),
            _Banner(text: _liveWarning!, isError: false),
          ],
          const SizedBox(height: 10),
          if (_showTerminated && _liveLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 22),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else if (showClubSummary)
            _clubSummary(data)
          else
            _memberList(data),
        ],
      ),
    );
  }

  Widget _refreshButton() {
    final running = _job?.isRunning ?? false;
    return TextButton.icon(
      onPressed: running ? null : _startRefresh,
      style: TextButton.styleFrom(
        foregroundColor: AppColors.rotaryBlue,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        minimumSize: const Size(0, 32),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      icon: running
          ? const SizedBox(
              width: 13,
              height: 13,
              child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.refresh_rounded, size: 16),
      label: Text(
        running ? 'Refreshing…' : 'Refresh',
        style: AppFonts.body(
            fontSize: 13, fontWeight: FontWeight.w700),
      ),
    );
  }

  Widget _clubDropdown(List<DaNetworkClub> clubs) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int?>(
          isExpanded: true,
          value: _clubId,
          icon: const Icon(Icons.arrow_drop_down_rounded, color: AppColors.slate400),
          hint: Text('All Clubs',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
          style: AppFonts.body(
              fontSize: 13, color: AppColors.textPrimary),
          items: [
            DropdownMenuItem<int?>(
              value: null,
              child: Text('All Clubs',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.textPrimary)),
            ),
            for (final c in clubs)
              DropdownMenuItem<int?>(
                value: c.clubId,
                child: Text(c.clubName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.textPrimary)),
              ),
          ],
          onChanged: _onClubChanged,
        ),
      ),
    );
  }

  // Terminated + all clubs → per-club counts; tap a club to drill into it.
  Widget _clubSummary(DaRotaryNetwork data) {
    final counts = <int, int>{};
    for (final r in data.terminated) {
      counts[r.clubId] = (counts[r.clubId] ?? 0) + 1;
    }
    final q = _query.trim().toLowerCase();
    final rows = data.clubs
        .map((c) => (club: c, count: counts[c.clubId] ?? 0))
        .where((e) => e.count > 0)
        .where((e) => q.isEmpty || e.club.clubName.toLowerCase().contains(q))
        .toList()
      ..sort((a, b) => b.count.compareTo(a.count));

    if (rows.isEmpty) {
      return _empty('No terminated members.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => _onClubChanged(rows[i].club.clubId),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(rows[i].club.clubName,
                        style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.errorLight,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text('${rows[i].count}',
                        style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: AppColors.error)),
                  ),
                  const SizedBox(width: 6),
                  const Icon(Icons.chevron_right_rounded,
                      size: 18, color: AppColors.slate400),
                ],
              ),
            ),
          ),
          if (i != rows.length - 1)
            Container(height: 1, color: AppColors.slate100),
        ],
        const SizedBox(height: 8),
        Text(
          'Tap a club to view its terminated members',
          style: AppFonts.body(
              fontSize: 13, color: AppColors.slate400),
        ),
      ],
    );
  }

  Widget _memberList(DaRotaryNetwork data) {
    final isTerm = _showTerminated;
    final source = isTerm ? (_live ?? data.terminated) : data.potential;
    final q = _query.trim().toLowerCase();
    final rows = q.isEmpty
        ? source
        : source.where((r) {
            return r.fullName.toLowerCase().contains(q) ||
                r.memberId.toLowerCase().contains(q) ||
                r.clubName.toLowerCase().contains(q) ||
                (r.terminationReason ?? '').toLowerCase().contains(q) ||
                r.memberType.toLowerCase().contains(q);
          }).toList();

    if (rows.isEmpty) {
      return _empty(isTerm ? 'No terminated members.' : 'No prospective members.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          _MemberRow(row: rows[i], isTerminated: isTerm),
          if (i != rows.length - 1)
            Container(
              margin: const EdgeInsets.symmetric(vertical: 8),
              height: 1,
              color: AppColors.slate100,
            ),
        ],
        const SizedBox(height: 10),
        Text(
          '${rows.length} '
          '${isTerm ? 'terminated' : 'prospective'} member'
          '${rows.length == 1 ? '' : 's'}'
          '${q.isEmpty ? '' : ' (filtered)'}',
          style: AppFonts.body(
              fontSize: 13, color: AppColors.slate400),
        ),
      ],
    );
  }

  Widget _empty(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 22),
        child: Center(
          child: Text(text,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate400)),
        ),
      );
}

// ── Refresh progress banner ──────────────────────────────────────────────────

class _RefreshProgress extends StatelessWidget {
  final DaRefreshStatus job;
  const _RefreshProgress({required this.job});

  @override
  Widget build(BuildContext context) {
    final total = job.totalLinkedClubs;
    final done = total == 0 ? 0 : (job.clubsDone > total ? total : job.clubsDone);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.muted,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.primaryLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  total > 0
                      ? 'Refreshing from Rotary.org: $done of $total clubs (runs in the background)'
                      : 'Refreshing from Rotary.org (runs in the background)',
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.accentBlue),
                ),
              ),
            ],
          ),
          if (total > 0) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: done / total,
                minHeight: 5,
                backgroundColor: AppColors.muted,
                valueColor:
                    const AlwaysStoppedAnimation<Color>(AppColors.accentBlue),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  final String text;
  final bool isError;
  const _Banner({required this.text, required this.isError});

  @override
  Widget build(BuildContext context) {
    final bg = isError ? AppColors.errorLight : AppColors.warningLight;
    final fg = isError ? AppColors.errorDark : AppColors.warningInk;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(isError ? Icons.error_outline_rounded : Icons.info_outline_rounded,
              size: 15, color: fg),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: AppFonts.body(
                    fontSize: 13, fontWeight: FontWeight.w600, color: fg)),
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
      return InkWell(
        onTap: () => onSelect(isThis),
        borderRadius: BorderRadius.circular(8),
        child: Container(
          decoration: BoxDecoration(
            color: active ? AppColors.rotaryBlue : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
          Expanded(child: pill('Terminated', terminatedCount, true)),
          Expanded(child: pill('Prospective', potentialCount, false)),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  final ValueChanged<String> onChanged;
  const _SearchField({required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      style: AppFonts.body(fontSize: 13, color: AppColors.textPrimary),
      decoration: InputDecoration(
        isDense: true,
        hintText: 'Search name, ID, club…',
        hintStyle:
            AppFonts.body(fontSize: 13, color: AppColors.slate400),
        prefixIcon:
            const Icon(Icons.search_rounded, size: 18, color: AppColors.slate400),
        prefixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 36),
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
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
  final DaNetworkRow row;
  final bool isTerminated;
  const _MemberRow({required this.row, required this.isTerminated});

  @override
  Widget build(BuildContext context) {
    final name = row.fullName.isEmpty ? row.memberId : row.fullName;
    final adm = (row.admissionDate ?? '').trim();
    final term = (row.terminationDate ?? '').trim();
    final reason = (row.terminationReason ?? '').trim();
    final mobile = (row.mobile ?? '').trim();
    final email = (row.email ?? '').trim();
    final notes = (row.notes ?? '').trim();
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
                    child: Text(name,
                        style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary),
                        overflow: TextOverflow.ellipsis),
                  ),
                  if (row.memberId.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text(row.memberId,
                        style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.slate500)),
                  ],
                ],
              ),
              if (row.clubName.isNotEmpty)
                Text(row.clubName,
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.slate500),
                    overflow: TextOverflow.ellipsis),
              if (row.memberType.isNotEmpty) ...[
                const SizedBox(height: 4),
                _typeBadge(row.memberType),
              ],
              if (isTerminated) ...[
                if (adm.isNotEmpty) _dateLine('Admitted', adm),
                if (term.isNotEmpty) _dateLine('Terminated', term),
                if (reason.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  _reasonChip(reason),
                ],
              ] else ...[
                if (adm.isNotEmpty) _dateLine('Admitted', adm),
                if (notes.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(notes,
                      style: AppFonts.body(
                          fontSize: 13, color: AppColors.slate500)),
                ],
              ],
              if (mobile.isNotEmpty || email.isNotEmpty) ...[
                const SizedBox(height: 3),
                if (mobile.isNotEmpty) _contactLine(Icons.phone_outlined, mobile),
                if (email.isNotEmpty) _contactLine(Icons.email_outlined, email),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _dateLine(String label, String value) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text.rich(TextSpan(children: [
          TextSpan(
              text: '$label: ',
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.slate500)),
          TextSpan(
              text: value,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
        ])),
      );

  Widget _contactLine(IconData icon, String value) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(children: [
          Icon(icon, size: 12, color: AppColors.slate400),
          const SizedBox(width: 4),
          Expanded(
            child: Text(value,
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.slate500),
                overflow: TextOverflow.ellipsis),
          ),
        ]),
      );

  Widget _typeBadge(String type) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: AppColors.slate100,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppColors.slate200),
        ),
        child: Text(type,
            style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.slate700)),
      );

  Widget _reasonChip(String reason) {
    final style = _reasonStyle(reason);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration:
          BoxDecoration(color: style.bg, borderRadius: BorderRadius.circular(6)),
      child: Text(reason,
          style: AppFonts.body(
              fontSize: 13, fontWeight: FontWeight.w700, color: style.fg)),
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
      child: Text(initial,
          style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700)),
    );
  }
}
