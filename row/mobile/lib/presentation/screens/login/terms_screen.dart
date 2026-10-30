import 'package:flutter/material.dart' hide Text;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/row_tokens.dart';
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

  // Light ROW layout (design.md 8.4): full-colour lockup on cream, terms on a cream-2 tile, azure pill.
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Image.asset(
                      'assets/images/row-logo.png',
                      width: 220,
                      semanticLabel: Brand.current.productName,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Connecting members',
                      style: AppFonts.body(
                        color: AppColors.textSecondary,
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 48),
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: RowTone.cream2.fill,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: AppColors.line),
                      ),
                      child: Column(
                        children: [
                          Text(
                            'Before continuing, please read and accept our',
                            textAlign: TextAlign.center,
                            style: AppFonts.body(
                              color: AppColors.textPrimary,
                              fontSize: 15,
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
                                const Icon(Icons.description_outlined, color: AppColors.primaryPrime, size: 20),
                                const SizedBox(width: 8),
                                Text(
                                  'Terms and Conditions',
                                  style: AppFonts.body(
                                    color: AppColors.primaryPrime,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    decoration: TextDecoration.underline,
                                    decorationColor: AppColors.primaryPrime,
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
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
              child: SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  key: const Key('terms_accept_button'),
                  onPressed: () => _accept(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryPrime,
                    foregroundColor: AppColors.lightBg,
                    elevation: 0,
                    shape: const StadiumBorder(),
                  ),
                  child: Text(
                    'Accept & Continue',
                    style: AppFonts.body(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.lightBg),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

}
