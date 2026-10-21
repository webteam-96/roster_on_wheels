import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// A clearly tappable, button-styled location control that opens an address in
/// Google Maps. Deliberately reads as a *button* (a soft tonal blue rounded
/// tile with a blue location pin, sized as a proper tap target) rather than a
/// small decorative icon, so older users immediately understand it can be
/// pressed.
class MapsActionButton extends StatelessWidget {
  final VoidCallback onTap;
  const MapsActionButton({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    const blue = AppColors.primaryPrime;
    return Material(
      color: blue.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: blue.withValues(alpha: 0.22)),
          ),
          child: const Icon(Icons.location_on_rounded, size: 26, color: blue),
        ),
      ),
    );
  }
}
