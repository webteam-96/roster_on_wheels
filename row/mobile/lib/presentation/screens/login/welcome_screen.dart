import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_button.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final name = auth.memberName.isNotEmpty ? auth.memberName : 'Rotarian';
    final initials = _initials(name);

    return Scaffold(
      body: Stack(
        children: [
          // ── Gradient top half ──────────────────────────────────────
          Positioned(
            top: 0, left: 0, right: 0,
            height: MediaQuery.of(context).size.height * 0.52,
            child: Container(
              decoration: const BoxDecoration(gradient: AppGradients.royalSweep),
            ),
          ),

          // ── White bottom half ──────────────────────────────────────
          Positioned(
            bottom: 0, left: 0, right: 0,
            height: MediaQuery.of(context).size.height * 0.52,
            child: Container(color: AppColors.lightBg),
          ),

          // ── Main content ───────────────────────────────────────────
          SafeArea(
            child: Column(
              children: [
                // Top area
                Expanded(
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 28),
                      child: Column(
                        children: [
                          const SizedBox(height: 32),

                          // ── Avatar circle ──────────────────────────
                          Stack(
                            alignment: Alignment.center,
                            children: [
                              // Outer ring
                              Container(
                                width: 120, height: 120,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white.withOpacity(0.12),
                                  border: Border.all(
                                    color: Colors.white.withOpacity(0.25), width: 2),
                                ),
                              ),
                              // Initials circle
                              Container(
                                width: 96, height: 96,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: AppColors.goldPrime,
                                ),
                                child: Center(
                                  child: Text(
                                    initials,
                                    style: AppFonts.body(
                                      color: AppColors.darkBg,
                                      fontSize: 34,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                              ),
                              // Checkmark badge
                              Positioned(
                                bottom: 4, right: 4,
                                child: Container(
                                  width: 28, height: 28,
                                  decoration: BoxDecoration(
                                    color: AppColors.success,
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white, width: 2),
                                  ),
                                  child: const Icon(Icons.check_rounded,
                                      color: Colors.white, size: 16),
                                ),
                              ),
                            ],
                          ),

                          const SizedBox(height: 24),

                          Text(
                            'WELCOME,',
                            style: AppFonts.body(
                              color: Colors.white.withOpacity(0.7),
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 3,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            name.toUpperCase(),
                            style: AppFonts.display(
                              color: Colors.white,
                              fontSize: 26,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.5,
                            ),
                            textAlign: TextAlign.center,
                          ),

                          const SizedBox(height: 32),

                          // ── Club info card ─────────────────────────
                          if (auth.welcomeClubs.isNotEmpty) ...[
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: AppColors.white,
                                borderRadius: BorderRadius.circular(24),
                                border: Border.all(color: AppColors.lightBorder),
                              ),
                              child: Column(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: AppColors.primaryPrime.withOpacity(0.07),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text(
                                      auth.welcomeClubs.length > 1 ? 'MEMBER OF' : 'MEMBER OF',
                                      style: AppFonts.body(
                                        color: AppColors.primaryPrime,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: 1.5,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  for (int i = 0; i < auth.welcomeClubs.length; i++) ...[
                                    if (i > 0)
                                      const Padding(
                                        padding: EdgeInsets.symmetric(vertical: 10),
                                        child: Divider(
                                            height: 1,
                                            color: AppColors.lightBorder),
                                      ),
                                    Text(
                                      auth.welcomeClubs[i].name,
                                      textAlign: TextAlign.center,
                                      style: AppFonts.body(
                                        color: AppColors.primaryPrime,
                                        fontSize: 17,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    // COG is a special club — hide its district
                                    // line. For others, show the district number
                                    // only (no "District:" prefix).
                                    if (auth.welcomeClubs[i].districtNumber.isNotEmpty &&
                                        auth.welcomeClubs[i].name.trim().toLowerCase() != 'cog') ...[
                                      const SizedBox(height: 4),
                                      Text(
                                        auth.welcomeClubs[i].districtNumber,
                                        style: AppFonts.body(
                                          color: AppColors.textMuted,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ],
                                ],
                              ),
                            ),
                            const SizedBox(height: 24),
                          ] else
                            const SizedBox(height: 12),

                          // ── Rotary Branding ────────────────────────
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Image.asset('assets/images/row-mark.png', width: 40, height: 40),
                              const SizedBox(width: 10),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    Brand.current.productName,
                                    style: AppFonts.body(
                                      color: AppColors.primaryPrime,
                                      fontSize: 15,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),

                          const SizedBox(height: 40),
                        ],
                      ),
                    ),
                  ),
                ),

                // ── Get Started button ─────────────────────────────────
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
        ],
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
