import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class MyClubsListScreen extends StatelessWidget {
  final List<({int id, String name})> clubs;
  const MyClubsListScreen({super.key, required this.clubs});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: const CustomAppBar(title: 'My Clubs'),
      body: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: clubs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (ctx, i) => _ClubCard(club: clubs[i], index: i),
      ),
    );
  }
}

class _ClubCard extends StatelessWidget {
  final ({int id, String name}) club;
  final int index;
  const _ClubCard({required this.club, required this.index});

  static const _gradients = [
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.accentBlue, AppColors.chart5],
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.errorDark, AppColors.error],
    [AppColors.successDark, AppColors.success],
    [AppColors.warningInk, AppColors.warningDark],
  ];

  @override
  Widget build(BuildContext context) {
    final grad = _gradients[index % _gradients.length];
    return GestureDetector(
      onTap: () => context.push(RouteNames.clubDashboard(club.id)),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.primaryPrime,
          borderRadius: BorderRadius.circular(18),

        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.groups_rounded, color: Colors.white, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                club.name,
                style: AppFonts.body(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Icon(Icons.arrow_forward_ios_rounded, color: Colors.white.withValues(alpha: 0.7), size: 16),
          ],
        ),
      ),
    );
  }
}
