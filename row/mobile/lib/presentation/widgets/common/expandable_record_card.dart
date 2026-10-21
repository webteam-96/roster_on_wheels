import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

/// Collapsed = [collapsedTitle] + optional [collapsedTrailing] + chevron.
/// Tap toggles to reveal [expandedChild]. One tap target = expand; put any
/// navigation as buttons inside [expandedChild].
class ExpandableRecordCard extends StatefulWidget {
  final Widget collapsedTitle;
  final Widget? collapsedTrailing;
  final Widget expandedChild;
  final bool initiallyExpanded;
  const ExpandableRecordCard({
    super.key,
    required this.collapsedTitle,
    required this.expandedChild,
    this.collapsedTrailing,
    this.initiallyExpanded = false,
  });

  @override
  State<ExpandableRecordCard> createState() => _ExpandableRecordCardState();
}

class _ExpandableRecordCardState extends State<ExpandableRecordCard> {
  late bool _open = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: () => setState(() => _open = !_open),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(child: widget.collapsedTitle),
                if (widget.collapsedTrailing != null) ...[
                  const SizedBox(width: 8),
                  widget.collapsedTrailing!,
                ],
                const SizedBox(width: 6),
                AnimatedRotation(
                  turns: _open ? 0.5 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: const Icon(Icons.keyboard_arrow_down_rounded,
                      size: 20, color: AppColors.slate400),
                ),
              ],
            ),
          ),
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          alignment: Alignment.topCenter,
          child: _open
              ? Padding(
                  padding: const EdgeInsets.only(top: 2, bottom: 10),
                  child: widget.expandedChild,
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}
