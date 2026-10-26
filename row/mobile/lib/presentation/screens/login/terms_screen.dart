import 'package:flutter/material.dart' hide Text;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

String get _termsUrl => Brand.current.webUrl(Brand.current.termsUrl);

class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: false),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  Future<void> _accept(BuildContext context) async {
    await _storage.write(key: AppConstants.termsAcceptedKey, value: 'true');
    if (!context.mounted) return;
    context.go(RouteNames.mobileLogin);
  }

  Future<void> _openTerms(BuildContext context) async {
    final uri = Uri.parse(_termsUrl);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open Terms and Conditions.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // ── Full gradient background ───────────────────────────────
          Positioned.fill(
            child: Container(
              decoration: const BoxDecoration(gradient: AppGradients.royalSweep),
            ),
          ),

          // ── Main content ───────────────────────────────────────────
          SafeArea(
            child: Column(
              children: [
                // Top branding
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // ROW lockup (white, on the azure field)
                        Image.asset(
                          'assets/images/row-logo-inverse.png',
                          width: 240,
                          semanticLabel: Brand.current.productName,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'CONNECTING MEMBERS',
                          style: AppFonts.body(
                            color: Colors.white.withOpacity(0.55),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 3,
                          ),
                        ),

                        const SizedBox(height: 48),

                        // Terms link box
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: Colors.white.withOpacity(0.15)),
                          ),
                          child: Column(
                            children: [
                              Text(
                                'Before continuing, please read and accept our',
                                textAlign: TextAlign.center,
                                style: AppFonts.body(
                                  color: Colors.white.withOpacity(0.7),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                  height: 1.5,
                                ),
                              ),
                              const SizedBox(height: 12),
                              GestureDetector(
                                key: const Key('terms_view_link'),
                                onTap: () => _openTerms(context),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(Icons.description_outlined,
                                        color: AppColors.goldPrime, size: 18),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Terms and Conditions',
                                      style: AppFonts.body(
                                        color: AppColors.goldPrime,
                                        fontSize: 14,
                                        fontWeight: FontWeight.w800,
                                        decoration: TextDecoration.underline,
                                        decorationColor: AppColors.goldPrime,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // ── Buttons ────────────────────────────────────────────
                Container(
                  margin: const EdgeInsets.fromLTRB(24, 0, 24, 32),
                  child: Column(
                    children: [
                      // Accept button — gradient white
                      SizedBox(
                        width: double.infinity,
                        height: 56,
                        child: ElevatedButton(
                          key: const Key('terms_accept_button'),
                          onPressed: () => _accept(context),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.white,
                            foregroundColor: AppColors.primaryPrime,
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: Text(
                            'Accept & Continue',
                            style: AppFonts.body(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                              color: AppColors.primaryPrime,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

}
