import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/row_tokens.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/row/tone_card.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Post sign-in welcome (design.md 8.4): one light surface, full-colour ROW lockup, the member's
/// name in the display face and their clubs on a sky tone tile.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final name = auth.memberName.isNotEmpty ? auth.memberName : 'Rotarian';
    final initials = _initials(name);

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Column(
                  children: [
                    const SizedBox(height: 32),
                    Image.asset(
                      'assets/images/row-logo.png',
                      width: 180,
                      semanticLabel: Brand.current.productName,
                    ),
                    const SizedBox(height: 40),

                    // Avatar: initials on a gold disc (a small accent, never a field), check badge.
                    Stack(
                      alignment: Alignment.center,
                      children: [
                        Container(
                          width: 112,
                          height: 112,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: RowTone.sky.fill),
                        ),
                        Container(
                          width: 92,
                          height: 92,
                          decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.goldPrime),
                          child: Center(
                            child: Text(
                              initials,
                              style: AppFonts.display(
                                color: AppColors.textPrimary,
                                fontSize: 32,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          bottom: 4,
                          right: 4,
                          child: Container(
                            width: 28,
                            height: 28,
                            decoration: BoxDecoration(
                              color: AppColors.success,
                              shape: BoxShape.circle,
                              border: Border.all(color: AppColors.lightBg, width: 2),
                            ),
                            child: const Icon(Icons.check_rounded, color: AppColors.lightBg, size: 16),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Welcome,',
                      style: AppFonts.body(color: AppColors.textSecondary, fontSize: 16, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      name,
                      textAlign: TextAlign.center,
                      style: AppFonts.display(
                        color: AppColors.textPrimary,
                        fontSize: 28,
                        fontWeight: FontWeight.w600,
                        height: 1.1,
                      ),
                    ),
                    const SizedBox(height: 32),

                    if (auth.welcomeClubs.isNotEmpty)
                      SizedBox(
                        width: double.infinity,
                        child: ToneCard(
                          tone: RowTone.sky,
                          child: Column(
                            children: [
                              Text(
                                'Member of',
                                style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 12),
                              for (int i = 0; i < auth.welcomeClubs.length; i++) ...[
                                if (i > 0)
                                  const Padding(
                                    padding: EdgeInsets.symmetric(vertical: 10),
                                    child: Divider(height: 1, color: AppColors.line),
                                  ),
                                Text(
                                  auth.welcomeClubs[i].name,
                                  textAlign: TextAlign.center,
                                  style: AppFonts.display(fontSize: 20, fontWeight: FontWeight.w600),
                                ),
                                // COG is a special club: hide its district line. Others show the
                                // district number only (no "District:" prefix).
                                if (auth.welcomeClubs[i].districtNumber.isNotEmpty &&
                                    auth.welcomeClubs[i].name.trim().toLowerCase() != 'cog') ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    auth.welcomeClubs[i].districtNumber,
                                    style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ],
                            ],
                          ),
                        ),
                      ),
                    const SizedBox(height: 40),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
              child: CustomButton(
                label: 'Get Started',
                onPressed: () => context.go(RouteNames.home),
                fullWidth: true,
                height: 56,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }
}
