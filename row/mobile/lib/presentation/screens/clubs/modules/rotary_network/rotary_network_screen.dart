import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../../core/routing/route_names.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';

class RotaryNetworkScreen extends StatelessWidget {
  final int clubId;
  final bool embedded;
  const RotaryNetworkScreen({super.key, required this.clubId, this.embedded = false});

  @override
  Widget build(BuildContext context) {
    final tiles = [
      _Tile(
        label: 'Potential Members',
        icon: Icons.person_add_alt_1_outlined,
        color: AppColors.accentBlue,
        bgColor: AppColors.muted,
        onTap: () => context.push(RouteNames.potentialMembers(clubId)),
      ),
      _Tile(
        label: 'Terminated Members',
        icon: Icons.person_remove_outlined,
        color: AppColors.errorDark,
        bgColor: AppColors.muted,
        onTap: () => context.push(RouteNames.terminatedMembers(clubId)),
      ),
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: embedded ? null : const CustomAppBar(title: 'Rotary Network'),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: GridView.builder(
          shrinkWrap: true,
          itemCount: tiles.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 14,
            mainAxisSpacing: 14,
            childAspectRatio: 1.1,
          ),
          itemBuilder: (_, i) => _TileCard(tile: tiles[i]),
        ),
      ),
    );
  }
}

class _Tile {
  final String label;
  final IconData icon;
  final Color color;
  final Color bgColor;
  final VoidCallback onTap;
  const _Tile({required this.label, required this.icon, required this.color, required this.bgColor, required this.onTap});
}

class _TileCard extends StatelessWidget {
  final _Tile tile;
  const _TileCard({required this.tile});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: tile.onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 60, height: 60,
              decoration: BoxDecoration(color: tile.bgColor, borderRadius: BorderRadius.circular(14)),
              child: Icon(tile.icon, size: 32, color: tile.color),
            ),
            const SizedBox(height: 10),
            Text(tile.label, style: AppTextStyles.bodySemiBold, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
