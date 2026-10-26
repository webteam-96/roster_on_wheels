import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../../core/constants/api_constants.dart';
import '../../../../../../core/network/api_client.dart';
import '../../../../../../core/routing/route_names.dart';
import '../../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../../core/theme/app_colors.dart';
import '../../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../../../data/models/club_overview_models.dart';
import '../../../../../providers/auth_provider.dart';
import '../../../../../widgets/common/dashboard_refresh.dart';
import '../club_dashboard_async.dart';
import '../membership_summary_card.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Directory" sub-tab of the Club Dashboard — wired to the live
/// `dashboard-directory` endpoint.
///
/// Mirrors the React "Member Directory" view: a 4-card KPI strip
/// (Total / Full / Honorary members + Club Admins) over a searchable,
/// read-only member directory (avatar + name + designation, mobile, email).
/// No edit / delete actions — this is a read-only dashboard surface.
class DashboardDirectorySubtab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const DashboardDirectorySubtab({super.key, required this.clubId, this.yearId});

  @override
  State<DashboardDirectorySubtab> createState() =>
      _DashboardDirectorySubtabState();
}

/// Stable avatar palette (mirrors the BOD / dues mock palette).
const List<int> _avatarPalette = [
  0xFF003DA5, 0xFF16A34A, 0xFFCA8A04, 0xFF9333EA, 0xFF0891B2,
  0xFFE11D48, 0xFFF59E0B, 0xFF64748B, 0xFFB45309, 0xFF0F172A, 0xFF7C3AED,
];

String _initialsOf(String name) {
  final parts =
      name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  final letters = parts.map((p) => p[0]).join();
  return letters
      .substring(0, letters.length > 2 ? 2 : letters.length)
      .toUpperCase();
}

class _DashboardDirectorySubtabState extends State<DashboardDirectorySubtab>
    with AutomaticKeepAliveClientMixin<DashboardDirectorySubtab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminDirectory> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getDirectory(widget.clubId, yearId: widget.yearId);
  }

  void _reload() =>
      setState(() => _future = _api.getDirectory(widget.clubId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getDirectory(widget.clubId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<ClubAdminDirectory>(
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
          child: _DirectoryView(
            dir: snap.data!,
            clubId: widget.clubId,
            onRolesChanged: _reload,
          ),
        );
      },
    );
  }
}

// ── Body ─────────────────────────────────────────────────────────────────────

class _DirectoryView extends StatefulWidget {
  final ClubAdminDirectory dir;
  final int clubId;
  final VoidCallback onRolesChanged;
  const _DirectoryView({
    required this.dir,
    required this.clubId,
    required this.onRolesChanged,
  });

  @override
  State<_DirectoryView> createState() => _DirectoryViewState();
}

class _DirectoryViewState extends State<_DirectoryView> {
  final TextEditingController _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Search-filter, then sort. For a CLUB ADMIN viewer we tier-sort like the
  /// web (club admins first, then members with no mobile, then the rest —
  /// alphabetical within each tier). For a plain CLUB MEMBER viewer we do NOT
  /// float admins to the top — just a flat alphabetical list.
  List<ClubMember> get _filtered {
    final q = _query.trim().toLowerCase();
    final base = q.isEmpty
        ? widget.dir.members
        : widget.dir.members.where((m) {
            return m.name.toLowerCase().contains(q) ||
                m.email.toLowerCase().contains(q) ||
                m.mobile.toLowerCase().contains(q);
          });
    final isClubAdmin =
        context.read<AuthProvider>().isClubAdminOf(widget.clubId);
    final list = base.toList();
    if (isClubAdmin) {
      int groupKey(ClubMember m) =>
          m.isAdmin ? 0 : (m.mobile.trim().isEmpty ? 1 : 2);
      list.sort((a, b) {
        final g = groupKey(a) - groupKey(b);
        return g != 0
            ? g
            : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    } else {
      // Club member view: pure alphabetical, no admins-at-top.
      list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final dir = widget.dir;
    // Edit rights: the acting user is a club admin of this dashboard's club.
    final canManage =
        context.watch<AuthProvider>().isClubAdminOf(widget.clubId);

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Membership KPIs matching the web Directory: Total + Paid / Male /
          // Female / Honorary. "Paid" is the non-honorary count.
          MembershipSummaryCard(
            total: dir.totalMembers,
            paid: dir.fullMembers,
            male: dir.maleMembers,
            female: dir.femaleMembers,
            honorary: dir.honoraryMembers,
          ),
          const SizedBox(height: 14),
          _DirectoryCard(
            clubName: dir.clubName,
            totalMembers: dir.members.length,
            filtered: _filtered,
            searchCtrl: _searchCtrl,
            onSearch: (v) => setState(() => _query = v),
            clubId: widget.clubId,
            canManage: canManage,
            onRolesChanged: widget.onRolesChanged,
          ),
        ],
      ),
    );
  }
}

// ── Member Directory card ────────────────────────────────────────────────────

class _DirectoryCard extends StatelessWidget {
  final String clubName;
  final int totalMembers;
  final List<ClubMember> filtered;
  final TextEditingController searchCtrl;
  final ValueChanged<String> onSearch;
  final int clubId;
  final bool canManage;
  final VoidCallback onRolesChanged;
  const _DirectoryCard({
    required this.clubName,
    required this.totalMembers,
    required this.filtered,
    required this.searchCtrl,
    required this.onSearch,
    required this.clubId,
    required this.canManage,
    required this.onRolesChanged,
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
          Text(
            'Member Directory',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          if (clubName.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                clubName,
                style: AppFonts.body(
                  fontSize: 11,
                  color: AppColors.slate500,
                ),
              ),
            ),
          const SizedBox(height: 12),
          _SearchField(controller: searchCtrl, onChanged: onSearch),
          const SizedBox(height: 12),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Column(
                  children: [
                    const Icon(Icons.people_outline_rounded,
                        size: 34, color: AppColors.slate400),
                    const SizedBox(height: 8),
                    Text(
                      totalMembers == 0
                          ? 'No members found'
                          : 'No members match your search',
                      style: AppFonts.body(
                          fontSize: 12, color: AppColors.slate400),
                    ),
                  ],
                ),
              ),
            )
          else ...[
            for (var i = 0; i < filtered.length; i++) ...[
              _MemberRow(
                member: filtered[i],
                index: i,
                clubId: clubId,
                canManage: canManage,
                onRolesChanged: onRolesChanged,
              ),
              if (i != filtered.length - 1)
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 10),
                  height: 1,
                  color: AppColors.slate100,
                ),
            ],
            const SizedBox(height: 12),
            Text(
              'Showing ${filtered.length} of $totalMembers members',
              style: AppFonts.body(
                fontSize: 10.5,
                color: AppColors.slate400,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  const _SearchField({required this.controller, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      style: AppFonts.body(
        fontSize: 12.5,
        color: AppColors.textPrimary,
      ),
      decoration: InputDecoration(
        isDense: true,
        hintText: 'Search members by name, email or mobile…',
        hintStyle: AppFonts.body(
          fontSize: 12.5,
          color: AppColors.slate400,
        ),
        prefixIcon: const Icon(Icons.search_rounded,
            size: 18, color: AppColors.slate400),
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

class _MemberRow extends StatefulWidget {
  final ClubMember member;
  final int index;
  final int clubId;
  final bool canManage;
  final VoidCallback onRolesChanged;
  const _MemberRow({
    required this.member,
    required this.index,
    required this.clubId,
    required this.canManage,
    required this.onRolesChanged,
  });

  @override
  State<_MemberRow> createState() => _MemberRowState();
}

class _MemberRowState extends State<_MemberRow> {
  final ApiClient _api = ApiClient();
  bool _busy = false;

  Future<void> _toggleAdmin() async {
    final member = widget.member;
    final makeAdmin = !member.isAdmin;
    final who = member.name.isEmpty ? 'this member' : member.name;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(makeAdmin ? 'Make Admin' : 'Remove Admin'),
        content: Text(makeAdmin
            ? 'Give $who club-admin access for this club?'
            : 'Remove club-admin access from $who? '
                'This only affects this club.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              makeAdmin ? 'Make Admin' : 'Remove',
              style: TextStyle(
                  color: makeAdmin ? AppColors.rotaryBlue : AppColors.error),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await _api.post(
        makeAdmin
            ? ApiConstants.adminAssignRole
            : ApiConstants.adminRemoveRole,
        body: {
          'memberId': member.id,
          'roleId': 2, // club admin
          'clubId': widget.clubId,
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(makeAdmin ? 'Admin role granted' : 'Admin role removed'),
        backgroundColor: AppColors.success,
      ));
      // The list refetches (badges + sort update); this row is rebuilt.
      widget.onRolesChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Failed: $e'),
        backgroundColor: AppColors.error,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final member = widget.member;
    final color = Color(_avatarPalette[widget.index % _avatarPalette.length]);
    final isHonorary = member.type == 'Honorary';
    return InkWell(
      onTap: () => context.push(RouteNames.directoryMemberDetail(member.id,
          fromDirectory: true, clubId: widget.clubId)),
      borderRadius: BorderRadius.circular(8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Avatar with initials
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Text(
              _initialsOf(member.name),
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 6,
                  runSpacing: 2,
                  children: [
                    Text(
                      member.name.isEmpty ? 'Unnamed member' : member.name,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (member.isAdmin)
                      const _RolePill(
                        label: 'Admin',
                        bg: AppColors.muted,
                        fg: AppColors.accentBlue,
                      ),
                    if (isHonorary)
                      const _RolePill(
                        label: 'Honorary',
                        bg: AppColors.muted,
                        fg: AppColors.accentBlue,
                      ),
                  ],
                ),
                if (member.designation.isNotEmpty) ...[
                  const SizedBox(height: 1),
                  Text(
                    member.designation,
                    style: AppFonts.body(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.slate400,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: 5),
                if (member.mobile.isNotEmpty)
                  _ContactLine(icon: Icons.phone_rounded, text: member.mobile),
                if (member.email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  _ContactLine(
                      icon: Icons.mail_outline_rounded, text: member.email),
                ],
              ],
            ),
          ),
          if (widget.canManage) _buildAction(member),
        ],
      ),
    );
  }

  Widget _buildAction(ClubMember member) {
    if (_busy) {
      return const Padding(
        padding: EdgeInsets.all(9),
        child: SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }
    final makeAdmin = !member.isAdmin;
    return IconButton(
      tooltip: makeAdmin ? 'Make Admin' : 'Remove Admin (this club)',
      visualDensity: VisualDensity.compact,
      onPressed: _toggleAdmin,
      icon: Icon(
        makeAdmin
            ? Icons.add_moderator_outlined
            : Icons.remove_moderator_outlined,
        size: 19,
        color: makeAdmin ? AppColors.rotaryBlue : AppColors.error,
      ),
    );
  }
}

/// Small lowercase role badge next to a member's name (Admin / Honorary).
class _RolePill extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;
  const _RolePill({required this.label, required this.bg, required this.fg});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          color: fg,
        ),
      ),
    );
  }
}

class _ContactLine extends StatelessWidget {
  final IconData icon;
  final String text;
  const _ContactLine({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Icon(icon, size: 12, color: AppColors.slate400),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            text,
            style: AppFonts.body(
              fontSize: 11.5,
              color: AppColors.slate500,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
