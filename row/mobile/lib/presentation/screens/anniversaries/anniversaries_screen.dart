import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Years of service and anniversaries for one of the member's clubs (`GET api/clubs/{id}/anniversaries`):
/// milestones, joining anniversaries, birthdays and wedding anniversaries in a month, then everyone's years of
/// service. Any member of the club may read it; members who hide their personal details are left out of birthdays.
class AnniversariesScreen extends StatefulWidget {
  const AnniversariesScreen({super.key});

  @override
  State<AnniversariesScreen> createState() => _AnniversariesScreenState();
}

const _months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

class _AnniversariesScreenState extends State<AnniversariesScreen> {
  final _api = ApiClient();
  int? _clubId;
  int? _year;
  int? _month;
  Map<String, dynamic>? _data;
  String? _error;
  bool _allYears = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_clubId == null) {
      final clubs = context.read<AuthProvider>().memberClubIds.toSet().toList();
      if (clubs.isNotEmpty) {
        _clubId = clubs.first;
        _load();
      }
    }
  }

  Future<void> _load() async {
    final id = _clubId;
    if (id == null) return;
    setState(() {
      _data = null;
      _error = null;
    });
    try {
      final q = _year != null && _month != null ? '?year=$_year&month=$_month' : '';
      final res = await _api.get<Map<String, dynamic>>('/api/clubs/$id/anniversaries$q',
          fromJson: (j) => j as Map<String, dynamic>);
      if (!mounted) return;
      final d = res.data ?? const <String, dynamic>{};
      setState(() {
        _data = d;
        _year ??= d['year'] as int?;
        _month ??= d['month'] as int?;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the anniversaries.');
    }
  }

  void _shiftMonth(int delta) {
    if (_year == null || _month == null) return;
    final d = DateTime(_year!, _month! + delta);
    _year = d.year;
    _month = d.month;
    _load();
  }

  Future<void> _pickClub(AuthProvider auth, List<int> clubs) async {
    final picked = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: AppColors.surface,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final id in clubs)
              ListTile(
                title: Text(auth.clubNameOf(id) ?? 'Club $id',
                    style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
                trailing: id == _clubId ? const Icon(Icons.check_rounded, color: AppColors.primaryPrime) : null,
                onTap: () => Navigator.pop(sheet, id),
              ),
          ],
        ),
      ),
    );
    if (picked == null || picked == _clubId) return;
    _clubId = picked;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final clubs = auth.memberClubIds.toSet().toList();
    if (clubs.isEmpty) {
      return const Scaffold(
        appBar: CustomAppBar(title: 'Birthdays and anniversaries'),
        body: EmptyStateWidget(
            icon: Icons.cake_outlined, title: 'No club', subtitle: 'Anniversaries belong to the clubs you are a member of.'),
      );
    }
    final d = _data;
    final clubName = auth.clubNameOf(_clubId ?? clubs.first) ?? '';
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Birthdays and anniversaries'),
      body: Column(
        children: [
          // Club: a full-width selector when there is a choice, plain text otherwise.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: clubs.length > 1
                ? Material(
                    color: AppColors.surface,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: const BorderSide(color: AppColors.line),
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => _pickClub(auth, clubs),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
                        child: Row(
                          children: [
                            Expanded(child: _clubLabel(clubName)),
                            const Icon(Icons.unfold_more_rounded, color: AppColors.textSecondary),
                          ],
                        ),
                      ),
                    ),
                  )
                : Align(alignment: Alignment.centerLeft, child: _clubLabel(clubName)),
          ),
          // Month: heading on the left, arrows grouped on the right (same as the calendar day view).
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 8, 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _month == null ? '' : '${_months[_month! - 1]} $_year',
                    style: AppFonts.display(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                  ),
                ),
                IconButton(
                    tooltip: 'Previous month',
                    color: AppColors.primary,
                    icon: const Icon(Icons.chevron_left_rounded),
                    onPressed: () => _shiftMonth(-1)),
                IconButton(
                    tooltip: 'Next month',
                    color: AppColors.primary,
                    icon: const Icon(Icons.chevron_right_rounded),
                    onPressed: () => _shiftMonth(1)),
              ],
            ),
          ),
          Expanded(
            child: _error != null
                ? EmptyStateWidget(icon: Icons.cake_outlined, title: 'Not available', subtitle: _error!)
                : d == null
                    ? const LoadingWidget()
                    : RowRefresh(onRefresh: _load, child: _report(d)),
          ),
        ],
      ),
    );
  }

  Widget _clubLabel(String name) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('CLUB',
              style: AppFonts.body(
                  fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: .8, color: AppColors.textSecondary)),
          const SizedBox(height: 2),
          Text(name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        ],
      );

  Widget _report(Map<String, dynamic> d) {
    final rows = ((d['members'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final monthIdx = ((d['month'] as int?) ?? 1) - 1;
    final month = _months[monthIdx];
    final mon = month.substring(0, 3).toUpperCase();
    final milestones = rows.where((r) => r['milestone'] == true).toList()
      ..sort((a, b) => (a['joinAnniversaryDay'] as int? ?? 0).compareTo(b['joinAnniversaryDay'] as int? ?? 0));
    final joins = rows.where((r) => r['joinAnniversaryDay'] != null && r['milestone'] != true).toList()
      ..sort((a, b) => (a['joinAnniversaryDay'] as int).compareTo(b['joinAnniversaryDay'] as int));
    final births = rows.where((r) => r['birthdayDay'] != null).toList()
      ..sort((a, b) => (a['birthdayDay'] as int).compareTo(b['birthdayDay'] as int));
    final weddings = rows.where((r) => r['weddingAnniversaryDay'] != null).toList()
      ..sort((a, b) => (a['weddingAnniversaryDay'] as int).compareTo(b['weddingAnniversaryDay'] as int));
    final service = [...rows]
      ..sort((a, b) => ((b['yearsOfService'] as num?) ?? -1).compareTo((a['yearsOfService'] as num?) ?? -1));
    final shown = _allYears ? service : service.take(5).toList();

    String years(Object? n) => n == 1 ? '1 year' : '$n years';

    final sections = <Widget>[
      if (milestones.isNotEmpty)
        _section('Milestones', [
          for (final r in milestones)
            _row(r['joinAnniversaryDay'], mon, r['memberName'], '${years(r['anniversaryYears'])} in the club', gold: true),
        ]),
      if (joins.isNotEmpty)
        _section('Joining anniversaries', [
          for (final r in joins) _row(r['joinAnniversaryDay'], mon, r['memberName'], years(r['anniversaryYears'])),
        ]),
      if (births.isNotEmpty)
        _section('Birthdays', [for (final r in births) _row(r['birthdayDay'], mon, r['memberName'], 'Birthday')]),
      if (weddings.isNotEmpty)
        _section('Wedding anniversaries',
            [for (final r in weddings) _row(r['weddingAnniversaryDay'], mon, r['memberName'], 'Wedding anniversary')]),
    ];

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        if (sections.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(
              children: [
                const Icon(Icons.cake_outlined, color: AppColors.textMuted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text('No birthdays or anniversaries in $month.',
                      style: AppFonts.body(fontSize: 14, color: AppColors.textSecondary)),
                ),
              ],
            ),
          )
        else
          ...sections,
        if (service.isNotEmpty)
          _section('Years of service · ${service.length}', [
            for (final r in shown) _serviceRow(r),
            if (service.length > 5)
              TextButton(
                onPressed: () => setState(() => _allYears = !_allYears),
                child: Text(_allYears ? 'Show fewer' : 'Show all ${service.length}',
                    style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.primary)),
              ),
          ]),
      ],
    );
  }

  Widget _section(String title, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 8),
              child: Text(title.toUpperCase(),
                  style: AppFonts.body(
                      fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: AppColors.textSecondary)),
            ),
            Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.line),
              ),
              child: Column(
                children: [
                  for (var i = 0; i < children.length; i++) ...[
                    if (i > 0) const Divider(height: 1, indent: 14, endIndent: 14, color: AppColors.line),
                    children[i],
                  ],
                ],
              ),
            ),
          ],
        ),
      );

  /// One person on a day: a date badge (marigold for a milestone), the name and what it is.
  Widget _row(Object? day, String mon, Object? name, String detail, {bool gold = false}) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Container(
              width: 44,
              padding: const EdgeInsets.symmetric(vertical: 4),
              decoration: BoxDecoration(
                color: gold ? AppColors.goldPrime : AppColors.primaryLight,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  Text('$day',
                      style: AppFonts.display(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: gold ? AppColors.darkBg : AppColors.primaryPrime,
                          height: 1.1)),
                  Text(mon,
                      style: AppFonts.body(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: .6,
                          color: gold ? AppColors.darkBg : AppColors.primaryPrime)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${name ?? ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                  const SizedBox(height: 2),
                  Text(detail, style: AppFonts.body(fontSize: 13, color: AppColors.textSecondary)),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _serviceRow(Map<String, dynamic> r) {
    final y = r['yearsOfService'];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Text(r['memberName'] as String? ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
          ),
          Text(y == null ? '–' : '$y yrs',
              style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.primaryPrime)),
        ],
      ),
    );
  }
}
