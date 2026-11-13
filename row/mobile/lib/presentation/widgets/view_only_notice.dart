import 'package:flutter/material.dart' hide Text;

import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Year-wise Admin Rights: shown to an admin of this club or district who does not hold the current
/// Rotary year, so the missing Add / Edit / Delete buttons do not look like a fault.
class ViewOnlyNotice extends StatelessWidget {
  const ViewOnlyNotice({super.key});

  static const message =
      'View only: you are not an admin for the current Rotary year, so you cannot add, edit or delete records here.';

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.warningTint,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.warningLight),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.visibility_outlined, size: 18, color: AppColors.warningInk),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: AppFonts.body(fontSize: 13, color: AppColors.warningInk),
            ),
          ),
        ],
      ),
    );
  }
}
