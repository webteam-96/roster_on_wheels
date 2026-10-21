import 'package:flutter/material.dart';

import '../../../../core/network/api_exceptions.dart';
import '../../../../core/services/goal_setting_api.dart';
import '../../../../core/theme/app_colors.dart';
import 'goal_messages_feed.dart';
import 'goal_zone_messages.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// The zone messaging popup, opened from the Messages button on the oversight
/// screen. Mobile twin of web's messages dialog.
///
/// The two roles get genuinely different views, as on web:
///   • RI Director / Super Admin → a FILTER BAR (category + district) over a
///     read-only ROSTER of every Zone Co-ordinator and District Assistant, plus
///     an Excel of every matching message. They read; they never reply.
///   • ZC / DA → their ONE conversation with their RI Director, with a
///     composer. No filters, no roster — they have exactly one thread.
///
/// ⚠️ The direction of messaging is deliberate and confirmed with the user: a
/// ZC/DA writes UP to their RI Director; the RI Director (and SuperAdmin) can
/// read every thread but cannot reply. The server enforces it, and the
/// composer simply doesn't appear where `canPost` is false. Do not "fix" it.
Future<void> showGoalMessagesSheet(
  BuildContext context, {
  required int zoneId,
  required int yearId,
  required String zoneName,

  /// The caller's overseen categories, in order.
  required List<({int id, String name})> categories,

  /// True for an RI Director / Super Admin — the roster + filters + report.
  /// False for a ZC/DA, who gets their single conversation instead.
  required bool isDirector,

  /// Districts of the zone, for the RI filter. Ignored otherwise.
  List<({int id, String number})> districts = const [],
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, controller) => _GoalMessagesSheet(
        zoneId: zoneId,
        yearId: yearId,
        zoneName: zoneName,
        categories: categories,
        isDirector: isDirector,
        districts: districts,
        scrollController: controller,
      ),
    ),
  );
}

class _GoalMessagesSheet extends StatefulWidget {
  final int zoneId;
  final int yearId;
  final String zoneName;
  final List<({int id, String name})> categories;
  final bool isDirector;
  final List<({int id, String number})> districts;
  final ScrollController scrollController;

  const _GoalMessagesSheet({
    required this.zoneId,
    required this.yearId,
    required this.zoneName,
    required this.categories,
    required this.isDirector,
    required this.districts,
    required this.scrollController,
  });

  @override
  State<_GoalMessagesSheet> createState() => _GoalMessagesSheetState();
}

class _GoalMessagesSheetState extends State<_GoalMessagesSheet> {
  final GoalSettingApi _api = GoalSettingApi();

  /// RI filters — 0 means "all", matching the server.
  int _filterCategory = 0;
  int _filterDistrict = 0;
  bool _downloading = false;

  Future<void> _downloadReport() async {
    if (_downloading) return;
    setState(() => _downloading = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _api.downloadMessagesReport(
        widget.zoneId,
        widget.yearId,
        categoryId: _filterCategory,
        districtId: _filterDistrict,
      );
      if (!mounted) return;
      messenger.showSnackBar(
          const SnackBar(content: Text('Report ready: check your downloads.')));
    } catch (e) {
      if (!mounted) return;
      final msg = (e is ApiException && e.statusCode == 404)
          ? 'No messages match these filters.'
          : friendlyErrorMessage(e, fallback: 'Could not download the report.');
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.error,
        content: Text(msg, style: const TextStyle(color: Colors.white)),
      ));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      child: Column(
        children: [
          _header(),
          if (widget.isDirector) _filterBar(),
          const Divider(height: 1, color: AppColors.slate100),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (widget.categories.isEmpty) return _empty();

    if (widget.isDirector) {
      return SingleChildScrollView(
        controller: widget.scrollController,
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
        child: GoalMessagesFeed(
          // Rebuild on a filter change so the roster reloads from scratch.
          key: ValueKey('feed-$_filterCategory-$_filterDistrict'),
          zoneId: widget.zoneId,
          yearId: widget.yearId,
          categoryId: _filterCategory,
          districtId: _filterDistrict,
        ),
      );
    }

    // A ZC/DA has exactly ONE category and ONE conversation in it — their
    // private thread with the RI Director, with a composer.
    return SingleChildScrollView(
      controller: widget.scrollController,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
      child: GoalZoneMessages(
        key: ValueKey(
            'gzm-${widget.categories.first.id}-${widget.zoneId}-${widget.yearId}'),
        categoryId: widget.categories.first.id,
        zoneId: widget.zoneId,
        yearId: widget.yearId,
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
      child: Row(
        children: [
          const Icon(Icons.forum_rounded, size: 19, color: AppColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Messages',
                  style: AppFonts.body(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (widget.zoneName.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    widget.zoneName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (widget.isDirector)
            IconButton(
              tooltip: 'Download messages report (Excel)',
              onPressed: _downloading ? null : _downloadReport,
              icon: _downloading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.download_rounded),
              color: AppColors.primary,
            ),
          IconButton(
            icon: const Icon(Icons.close_rounded),
            color: AppColors.textSecondary,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  /// Category + district, both defaulting to "All" — the same two filters that
  /// scope the roster AND the downloaded report, so what you see is what you
  /// get in the file.
  Widget _filterBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: Row(
        children: [
          Expanded(
            child: _picker<int>(
              label: 'Category',
              value: _filterCategory,
              options: [
                (value: 0, label: 'All categories'),
                for (final c in widget.categories) (value: c.id, label: c.name),
              ],
              onChanged: (v) => setState(() => _filterCategory = v),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _picker<int>(
              label: 'District',
              value: _filterDistrict,
              options: [
                (value: 0, label: 'All districts'),
                for (final d in widget.districts)
                  (value: d.id, label: d.number),
              ],
              onChanged: (v) => setState(() => _filterDistrict = v),
            ),
          ),
        ],
      ),
    );
  }

  Widget _picker<T>({
    required String label,
    required T value,
    required List<({T value, String label})> options,
    required ValueChanged<T> onChanged,
  }) {
    final selected = options.firstWhere((o) => o.value == value,
        orElse: () => options.first);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppFonts.body(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: 4),
        PopupMenuButton<T>(
          onSelected: onChanged,
          constraints: const BoxConstraints(maxWidth: 320, maxHeight: 420),
          itemBuilder: (_) => [
            for (final o in options)
              PopupMenuItem<T>(
                value: o.value,
                child: Text(o.label,
                    style: AppFonts.body(fontSize: 13)),
              ),
          ],
          child: Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    selected.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
                const Icon(Icons.arrow_drop_down_rounded,
                    size: 18, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _empty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Text(
          'No goal categories in your scope for this zone.',
          textAlign: TextAlign.center,
          style: AppFonts.body(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
          ),
        ),
      ),
    );
  }
}

/// The "Messages" button with its unread dot, shown on the oversight screen.
class GoalMessagesButton extends StatelessWidget {
  final bool hasUnread;
  final VoidCallback? onTap;
  final String label;

  const GoalMessagesButton({
    super.key,
    required this.hasUnread,
    required this.onTap,
    this.label = 'Messages',
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              // The dot rides the icon so it reads as "unread mail", not as a
              // decoration next to the label.
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Icon(Icons.forum_outlined,
                      size: 19,
                      color: enabled ? AppColors.primary : AppColors.slate400),
                  if (hasUnread)
                    Positioned(
                      right: -2,
                      top: -2,
                      child: Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          color: AppColors.error,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.5),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: enabled
                        ? AppColors.textPrimary
                        : AppColors.textMuted,
                  ),
                ),
              ),
              if (hasUnread)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Text(
                    'New',
                    style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: AppColors.error,
                    ),
                  ),
                ),
              const Icon(Icons.chevron_right_rounded,
                  size: 20, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}
