import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// A "Projects by Module" card used in the Club / District report screens.
/// Shows the first [_collapsedCount] projects with an expandable
/// "Show all / Show less" toggle so the remaining projects are reachable
/// (replaces the old dead "...and N more" label).
class ProjectsModuleCard extends StatefulWidget {
  final String moduleKey;
  final List<Map<String, dynamic>> projects;

  /// District report lists projects across clubs, so it shows the club name
  /// under each project; the club report omits it.
  final bool showClubName;

  const ProjectsModuleCard({
    super.key,
    required this.moduleKey,
    required this.projects,
    this.showClubName = false,
  });

  @override
  State<ProjectsModuleCard> createState() => _ProjectsModuleCardState();
}

class _ProjectsModuleCardState extends State<ProjectsModuleCard> {
  static const int _collapsedCount = 10;
  bool _expanded = false;

  String get _moduleName => widget.projects.isEmpty
      ? _humanize(widget.moduleKey)
      : (widget.projects.first['moduleName']?.toString() ??
          _humanize(widget.moduleKey));

  @override
  Widget build(BuildContext context) {
    final projects = widget.projects;
    final totalCost = projects.fold<double>(
        0, (s, p) => s + ((p['projectCost'] as num?)?.toDouble() ?? 0));
    final totalBen = projects.fold<int>(
        0, (s, p) => s + ((p['directBeneficiaries'] as num?)?.toInt() ?? 0));
    final visible =
        _expanded ? projects : projects.take(_collapsedCount).toList();
    final hiddenCount = projects.length - visible.length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _moduleName,
                    style: AppFonts.body(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryPrime,
                    ),
                  ),
                ),
                _chip(
                    '${projects.length} project${projects.length == 1 ? '' : 's'}'),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                if (totalCost > 0) _chip('Cost \$${_fmtMoney(totalCost)}'),
                if (totalBen > 0) _chip('Beneficiaries $totalBen'),
              ],
            ),
            if (projects.isNotEmpty) const Divider(height: 20),
            ...visible.map(_projectRow),
            if (projects.length > _collapsedCount) ...[
              const SizedBox(height: 4),
              InkWell(
                onTap: () => setState(() => _expanded = !_expanded),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Icon(
                        _expanded
                            ? Icons.expand_less_rounded
                            : Icons.expand_more_rounded,
                        size: 18,
                        color: AppColors.primaryPrime,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _expanded ? 'Show less' : 'Show all $hiddenCount more',
                        style: AppFonts.body(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryPrime,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _projectRow(Map<String, dynamic> p) {
    final title = p['title']?.toString() ?? '';
    final date = _parseDate(p['projectDate']?.toString());
    final clubName = p['clubName']?.toString() ?? '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 5,
            height: 5,
            margin: const EdgeInsets.only(top: 8, right: 8),
            decoration: const BoxDecoration(
              color: AppColors.primaryPrime,
              shape: BoxShape.circle,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (widget.showClubName && clubName.isNotEmpty)
                  Text(
                    clubName,
                    style: AppFonts.body(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
              ],
            ),
          ),
          if (date != null) ...[
            const SizedBox(width: 6),
            Text(
              DateFormat('dd MMM').format(date),
              style: AppFonts.body(
                fontSize: 11,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          fontSize: 11,
          color: AppColors.primaryPrime,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  String _fmtMoney(dynamic v) {
    if (v == null) return '0';
    final n = v is num ? v.toDouble() : double.tryParse(v.toString()) ?? 0;
    return NumberFormat('#,##0.##').format(n);
  }

  String _humanize(String key) {
    return key
        .split(RegExp(r'[_-]'))
        .where((s) => s.isNotEmpty)
        .map((s) => s[0].toUpperCase() + s.substring(1))
        .join(' ');
  }

  DateTime? _parseDate(String? v) {
    if (v == null || v.isEmpty) return null;
    final d = DateTime.tryParse(v);
    // Backend zero dates (`0001-01-01`) mean "no value" — surface as null.
    return (d == null || d.year <= 1) ? null : d;
  }
}
