import 'package:flutter/material.dart';
import '../../../../../core/theme/app_colors.dart';

/// Identifies which analytical card is currently selected on the District
/// Overview screen. The selection drives the chart dataset below the cards.
enum OverviewCard { membership, trf, projects, citation }

/// Tappable card chrome with active-state outline + subtle shadow.
/// Wraps the four analytical cards on the District Overview screen.
class AnalyticalCardShell extends StatelessWidget {
  final OverviewCard id;
  final OverviewCard activeCard;
  final ValueChanged<OverviewCard> onSelect;
  final Widget child;

  const AnalyticalCardShell({
    super.key,
    required this.id,
    required this.activeCard,
    required this.onSelect,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final active = id == activeCard;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onSelect(id),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: active ? AppColors.rotaryBlue : AppColors.slate200,
            width: active ? 2 : 1,
          ),
        ),
        child: child,
      ),
    );
  }
}
