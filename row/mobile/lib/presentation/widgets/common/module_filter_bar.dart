import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Clean, compact "search + status filter" row used at the top of the district
/// communication module screens (Events / Announcements / Newsletters /
/// Documents). Matches the app's rounded-field design language instead of the
/// plain Material dropdown + "Apply" button.
///
/// Search fires on keyboard submit; a clear (✕) button shows while there's
/// text. The status filter is a compact pill (popup menu) that applies
/// immediately on selection.
class ModuleFilterBar extends StatefulWidget {
  final TextEditingController searchController;
  final String searchHint;
  final String status;
  final List<String> statuses;
  final ValueChanged<String> onStatusChanged;
  final VoidCallback onSubmit;
  final VoidCallback onClear;

  /// When false, the status-filter pill is hidden (the search field still
  /// shows). Used to keep the status filter admin-only.
  final bool showStatusFilter;

  const ModuleFilterBar({
    super.key,
    required this.searchController,
    this.searchHint = 'Search',
    required this.status,
    required this.statuses,
    required this.onStatusChanged,
    required this.onSubmit,
    required this.onClear,
    this.showStatusFilter = true,
  });

  @override
  State<ModuleFilterBar> createState() => _ModuleFilterBarState();
}

class _ModuleFilterBarState extends State<ModuleFilterBar> {
  @override
  void initState() {
    super.initState();
    widget.searchController.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.searchController.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final hasText = widget.searchController.text.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Row(
        children: [
          Expanded(
            child: SizedBox(
              height: 44,
              child: TextField(
                controller: widget.searchController,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => widget.onSubmit(),
                style: AppFonts.body(fontSize: 13),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: widget.searchHint,
                  hintStyle: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400),
                  prefixIcon: const Icon(Icons.search_rounded,
                      size: 19, color: AppColors.slate400),
                  suffixIcon: hasText
                      ? IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          color: AppColors.slate400,
                          splashRadius: 18,
                          onPressed: widget.onClear,
                        )
                      : null,
                  contentPadding:
                      const EdgeInsets.symmetric(vertical: 0, horizontal: 4),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.slate200),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.slate200),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide:
                        const BorderSide(color: AppColors.rotaryBlue, width: 1.4),
                  ),
                ),
              ),
            ),
          ),
          if (widget.showStatusFilter) ...[
            const SizedBox(width: 8),
            _StatusPill(
              status: widget.status,
              statuses: widget.statuses,
              onChanged: widget.onStatusChanged,
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  final List<String> statuses;
  final ValueChanged<String> onChanged;
  const _StatusPill({
    required this.status,
    required this.statuses,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final isDefault = status.toLowerCase() == 'all';
    return PopupMenuButton<String>(
      onSelected: onChanged,
      position: PopupMenuPosition.under,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      itemBuilder: (_) => [
        for (final s in statuses)
          PopupMenuItem<String>(
            value: s,
            height: 40,
            child: Row(
              children: [
                Icon(
                  s == status
                      ? Icons.radio_button_checked_rounded
                      : Icons.radio_button_unchecked_rounded,
                  size: 16,
                  color: s == status ? AppColors.rotaryBlue : AppColors.slate400,
                ),
                const SizedBox(width: 8),
                Text(
                  s,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight:
                        s == status ? FontWeight.w700 : FontWeight.w500,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
      ],
      child: Container(
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: isDefault ? Colors.white : AppColors.rotaryBlue.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isDefault ? AppColors.slate200 : AppColors.rotaryBlue.withValues(alpha: 0.4),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.filter_list_rounded,
                size: 17,
                color: isDefault ? AppColors.slate500 : AppColors.rotaryBlue),
            const SizedBox(width: 6),
            Text(
              status,
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: isDefault ? AppColors.slate700 : AppColors.rotaryBlue,
              ),
            ),
            const SizedBox(width: 2),
            Icon(Icons.expand_more_rounded,
                size: 18,
                color: isDefault ? AppColors.slate400 : AppColors.rotaryBlue),
          ],
        ),
      ),
    );
  }
}
