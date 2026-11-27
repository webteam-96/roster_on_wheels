import 'package:flutter/material.dart' hide Text;

import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// Year-wise Admin Rights — the "which years may this new admin manage?" picker.
///
/// Mobile twin of the web's `AdminYearsDialog`, with one deliberate difference:
/// the fallback tick NEVER lands on a year the caller cannot grant. See
/// `_initialSelection` for why — that exact bug made Make Admin impossible to
/// complete on web for a past-year admin (ported from the RIZones app,
/// 2026-11-27; ROW's AdminController clamps and refuses the same way).
///
/// ⚠️ The server clamps whatever we send to the years the caller actually
/// holds and refuses the rest. This dialog is a COURTESY, never the guard:
/// greying a checkbox explains the limit, it does not create it.
///
/// Marker: YWAR-MOBILE-MAKE-ADMIN-YEARS

/// What the picker came back with. `allYears` wins over `yearIds` — the server
/// reads it the same way, and only a SuperAdmin may send it.
class AdminYearsResult {
  final List<int> yearIds;
  final bool allYears;

  const AdminYearsResult({required this.yearIds, required this.allYears});

  /// The request body fragment the admin endpoints expect. An all-years grant
  /// sends an EMPTY year list on purpose — the server ignores `yearIds` when
  /// `allYears` is true, and sending both invites them to disagree.
  Map<String, dynamic> toBody() => {
        'yearIds': allYears ? <int>[] : yearIds,
        'allYears': allYears,
      };
}

/// One row of the picker.
class _YearOption {
  final int id;
  final String label;
  final bool isCurrent;

  const _YearOption({
    required this.id,
    required this.label,
    required this.isCurrent,
  });

  /// `isCurrent` arrives from MySQL as a tinyint, which lands here as `1`/`0`
  /// on some drivers and `true`/`false` on others. Treat both as the truth.
  static bool _truthy(dynamic v) => v == true || v == 1 || v == '1';

  factory _YearOption.fromJson(Map<String, dynamic> j) => _YearOption(
        id: (j['id'] as num?)?.toInt() ?? 0,
        label: (j['label'] ?? '').toString(),
        isCurrent: _truthy(j['isCurrent']),
      );
}

/// Everything `GET /api/admin/club-admin-years` tells us.
class _YearOptions {
  final List<_YearOption> years;

  /// Years the CALLER may hand on. `null` means "every year" (a SuperAdmin).
  final List<int>? grantableYearIds;
  final bool canGrantAllYears;

  /// Years the TARGET already holds, so they can be pre-ticked.
  final List<int> heldYearIds;
  final bool heldAllYears;

  /// "Club President", "Club Executive Secretary" … — why they hold what they
  /// hold. Wording only; never a permission.
  final List<String> heldSources;

  const _YearOptions({
    required this.years,
    required this.grantableYearIds,
    required this.canGrantAllYears,
    required this.heldYearIds,
    required this.heldAllYears,
    required this.heldSources,
  });

  bool canGrant(int yearId) =>
      grantableYearIds == null || grantableYearIds!.contains(yearId);

  static List<int> _ints(dynamic v) => v is List
      ? v.map((e) => (e as num?)?.toInt() ?? 0).where((e) => e > 0).toList()
      : const <int>[];

  factory _YearOptions.fromJson(Map<String, dynamic> j) => _YearOptions(
        years: j['years'] is List
            ? (j['years'] as List)
                .map((e) => _YearOption.fromJson(Map<String, dynamic>.from(e)))
                .where((y) => y.id > 0)
                .toList()
            : const <_YearOption>[],
        // null and "absent" both mean every year is grantable. Only an actual
        // list narrows it — reading a missing key as "nothing" would lock out
        // a SuperAdmin.
        grantableYearIds:
            j['grantableYearIds'] == null ? null : _ints(j['grantableYearIds']),
        canGrantAllYears: j['canGrantAllYears'] == true,
        heldYearIds: _ints(j['heldYearIds']),
        heldAllYears: j['heldAllYears'] == true,
        heldSources: j['heldSources'] is List
            ? (j['heldSources'] as List).map((e) => e.toString()).toList()
            : const <String>[],
      );
}

/// Opens the picker for a CLUB admin grant. Returns null when cancelled.
Future<AdminYearsResult?> showClubAdminYearsDialog({
  required BuildContext context,
  required int clubId,
  required int memberId,
  required String memberName,
  String confirmLabel = 'Make Admin',
}) {
  return showRowDialog<AdminYearsResult>(
    context: context,
    builder: (_) => _AdminYearsDialog(
      clubId: clubId,
      memberId: memberId,
      memberName: memberName,
      confirmLabel: confirmLabel,
    ),
  );
}

/// "Edit Years" on an EXISTING club admin — no Remove + Make Admin. Opens the
/// picker pre-ticked with what they hold, then saves in place. The server
/// changes only years the caller holds; any other granted years are kept.
/// Returns true when saved. Marker: YWAR-EDIT-YEARS
Future<bool> editClubAdminYears({
  required BuildContext context,
  required int clubId,
  required int memberId,
  required String memberName,
}) async {
  final years = await showClubAdminYearsDialog(
    context: context,
    clubId: clubId,
    memberId: memberId,
    memberName: memberName,
    confirmLabel: 'Save',
  );
  if (years == null || !context.mounted) return false;
  final messenger = ScaffoldMessenger.of(context);
  try {
    final res = await ApiClient().post<Map<String, dynamic>>(
      ApiConstants.adminClubAdminYears,
      body: {'memberId': memberId, 'roleId': 2, 'clubId': clubId, ...years.toBody()},
      fromJson: (j) => j is Map<String, dynamic> ? j : <String, dynamic>{},
    );
    final kept = (res.data?['keptYears'] as List?)?.map((e) => '$e').toList() ?? const [];
    messenger.showSnackBar(SnackBar(
      content: Text(kept.isEmpty
          ? 'Admin years for $memberName updated'
          : 'Admin years for $memberName updated. ${kept.join(", ")} kept: not yours to change.'),
      backgroundColor: AppColors.success,
    ));
    return true;
  } catch (e) {
    messenger.showSnackBar(SnackBar(
      content: Text(friendlyErrorMessage(e, fallback: 'Could not update admin years.')),
      backgroundColor: AppColors.error,
    ));
    return false;
  }
}

class _AdminYearsDialog extends StatefulWidget {
  final int clubId;
  final int memberId;
  final String memberName;
  final String confirmLabel;

  const _AdminYearsDialog({
    required this.clubId,
    required this.memberId,
    required this.memberName,
    this.confirmLabel = 'Make Admin',
  });

  @override
  State<_AdminYearsDialog> createState() => _AdminYearsDialogState();
}

class _AdminYearsDialogState extends State<_AdminYearsDialog> {
  final ApiClient _api = ApiClient();

  _YearOptions? _options;
  bool _loading = true;
  String? _error;
  Set<int> _selected = <int>{};
  bool _allYears = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.adminClubAdminYears,
        queryParams: {
          'clubId': widget.clubId.toString(),
          'memberId': widget.memberId.toString(),
        },
        fromJson: (d) => Map<String, dynamic>.from(d as Map),
      );
      if (!mounted) return;
      final data = res.data;
      if (!res.isSuccess || data == null) {
        setState(() {
          _loading = false;
          _error = res.error ?? 'Could not load the Rotary years.';
        });
        return;
      }
      final options = _YearOptions.fromJson(data);
      setState(() {
        _options = options;
        _allYears = options.heldAllYears;
        _selected = _initialSelection(options);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = friendlyErrorMessage(e);
      });
    }
  }

  /// Which years open ticked.
  ///
  /// ⚠️ The whole point of this method. Web ticks the current year whenever the
  /// target holds nothing — WITHOUT checking the caller can grant it. The row
  /// then renders locked (not grantable) AND ticked (the default), the submit
  /// carries it anyway, and the server answers "You can only grant Rotary years
  /// you hold yourself." There is no sequence of taps that saves. A past-year
  /// admin can never appoint anyone, including for their own year — which is
  /// precisely what AssignDistrictAdmin's comment says must stay possible.
  ///
  /// So: prefer the current year, but only when it is actually grantable. Then
  /// fall back to the newest year the caller holds. Then tick nothing and let
  /// the empty-submit guard say so honestly.
  Set<int> _initialSelection(_YearOptions o) => initialAdminYearSelection(
        heldYearIds: o.heldYearIds,
        heldAllYears: o.heldAllYears,
        yearIdsNewestFirst: o.years.map((y) => y.id).toList(),
        currentYearId: o.years.where((y) => y.isCurrent).firstOrNull?.id,
        grantableYearIds: o.grantableYearIds,
      );

  void _toggle(int yearId) {
    setState(() {
      if (_selected.contains(yearId)) {
        _selected.remove(yearId);
      } else {
        _selected.add(yearId);
      }
      _error = null;
    });
  }

  void _confirm() {
    final o = _options;
    if (o == null) return;

    if (!_allYears && _selected.isEmpty) {
      setState(() => _error =
          'Pick at least one Rotary year, or the new admin will not be able to open anything.');
      return;
    }

    // Belt and braces: never submit a year the caller cannot grant, even if one
    // slipped into the set. The server would refuse the whole request for it.
    final years = _selected.where(o.canGrant).toList()..sort();
    if (!_allYears && years.isEmpty) {
      setState(() => _error =
          'None of the selected years are yours to grant. Pick one that is not locked.');
      return;
    }

    Navigator.of(context).pop(
      AdminYearsResult(yearIds: years, allYears: _allYears),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        'Admin years for ${widget.memberName}',
        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      ),
      content: SizedBox(width: 420, child: _buildContent()),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: (_loading || _options == null) ? null : _confirm,
          child: Text(
            widget.confirmLabel,
            style: const TextStyle(
                color: AppColors.primary, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Widget _buildContent() {
    if (_loading) {
      return const SizedBox(height: 160, child: RowSkeletonList(rows: 3));
    }

    final o = _options;
    if (o == null) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_error ?? 'Could not load the Rotary years.',
              style: const TextStyle(color: AppColors.error, fontSize: 13)),
          const SizedBox(height: 10),
          TextButton(onPressed: _load, child: const Text('Try again')),
        ],
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Choose which Rotary years ${widget.memberName} may manage in this '
          'club. They will only be able to add, edit or delete data belonging '
          'to those years.',
          style: const TextStyle(
              fontSize: 13, color: AppColors.textSecondary, height: 1.4),
        ),
        const SizedBox(height: 14),
        Flexible(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (o.canGrantAllYears) _buildAllYearsRow(),
                ...o.years.map((y) => _buildYearRow(o, y)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'You can only grant years you hold yourself.',
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
        if (o.heldSources.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            'Already held from: ${o.heldSources.join(", ")}',
            style:
                const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.error.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(_error!,
                style: const TextStyle(color: AppColors.error, fontSize: 12.5)),
          ),
        ],
      ],
    );
  }

  Widget _buildAllYearsRow() {
    return InkWell(
      onTap: () => setState(() {
        _allYears = !_allYears;
        _error = null;
      }),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          children: [
            Checkbox(
              value: _allYears,
              onChanged: (_) => setState(() {
                _allYears = !_allYears;
                _error = null;
              }),
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            const SizedBox(width: 6),
            const Text('All Years',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }

  Widget _buildYearRow(_YearOptions o, _YearOption y) {
    final grantable = o.canGrant(y.id);
    // All Years swallows the individual picks, so grey them while it is on.
    final disabled = _allYears || !grantable;
    final checked = _allYears || _selected.contains(y.id);

    return Opacity(
      opacity: disabled ? 0.5 : 1,
      child: InkWell(
        onTap: disabled ? null : () => _toggle(y.id),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            children: [
              Checkbox(
                value: checked,
                onChanged: disabled ? null : (_) => _toggle(y.id),
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              const SizedBox(width: 6),
              Text(y.label, style: const TextStyle(fontSize: 14)),
              if (y.isCurrent) ...[
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text('Current',
                      style:
                          TextStyle(fontSize: 11, color: AppColors.success)),
                ),
              ],
              const Spacer(),
              // The padlock says WHY the row is dead: this year is not yours to
              // give. Never shown for the All-Years grey-out, which is the
              // user's own doing and needs no explanation.
              if (!grantable)
                const Icon(Icons.lock_outline,
                    size: 15, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

/// The pre-tick rule, kept pure so it can be tested without a widget tree.
///
/// [yearIdsNewestFirst] is the full year list in the order the options endpoint
/// returns it (StartDate DESC). [grantableYearIds] null means every year is
/// grantable — a SuperAdmin.
///
/// ⚠️ Covered by test/admin_years_default_test.dart. The web twin omits the
/// grantable check and is unusable because of it; do not "simplify" this back.
/// Marker: YWAR-MOBILE-MAKE-ADMIN-YEARS
@visibleForTesting
Set<int> initialAdminYearSelection({
  required List<int> heldYearIds,
  required bool heldAllYears,
  required List<int> yearIdsNewestFirst,
  required int? currentYearId,
  required List<int>? grantableYearIds,
}) {
  // Whatever the target already holds wins — those are facts, not defaults,
  // and some of them (a club office) cannot be granted or taken here at all.
  final held = heldYearIds.toSet();
  if (held.isNotEmpty || heldAllYears) return held;

  bool canGrant(int id) =>
      grantableYearIds == null || grantableYearIds.contains(id);

  // Prefer the current year — but ONLY when it is the caller's to give.
  if (currentYearId != null && canGrant(currentYearId)) return {currentYearId};

  // Otherwise the most recent year the caller does hold, so the dialog opens
  // in a state that can actually be saved.
  for (final id in yearIdsNewestFirst) {
    if (canGrant(id)) return {id};
  }

  // Nothing grantable at all: tick nothing and let the empty-submit guard say
  // so plainly, rather than offering a button that always fails.
  return <int>{};
}
