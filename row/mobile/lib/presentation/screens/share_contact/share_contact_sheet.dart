import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _ShareContactCache {
  _ShareContactCache({
    required this.memberId,
    required this.name,
    required this.mobile,
    required this.countryCode,
    required this.email,
    required this.businessName,
  });
  final int memberId;
  final String name;
  final String mobile;
  final String countryCode;
  final String email;
  final String businessName;
}

_ShareContactCache? _cachedContact;

void invalidateShareContactCache() {
  _cachedContact = null;
}

class ShareContactSheet extends StatefulWidget {
  const ShareContactSheet({super.key});

  @override
  State<ShareContactSheet> createState() => _ShareContactSheetState();
}

class _ShareContactSheetState extends State<ShareContactSheet> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  String _name = '';
  String _mobile = '';
  String _countryCode = '';
  String _email = '';
  String _businessName = '';

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    final cached = _cachedContact;
    if (cached != null && cached.memberId == auth.memberId) {
      _name = cached.name;
      _mobile = cached.mobile;
      _countryCode = cached.countryCode;
      _email = cached.email;
      _businessName = cached.businessName;
      _loading = false;
    } else {
      _load();
    }
  }

  Future<void> _load() async {
    final auth = context.read<AuthProvider>();
    if (auth.memberId <= 0) {
      setState(() {
        _loading = false;
        _error = 'Please log in again.';
      });
      return;
    }
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/members/${auth.memberId}');
      final d = res.data ?? {};
      if (!mounted) return;
      final name = d['memberName']?.toString() ?? auth.memberName;
      final mobile = d['primaryMobileNumber']?.toString() ?? '';
      final countryCode = d['primaryCountryPhoneCode']?.toString() ?? '';
      final email = d['emailId']?.toString() ?? '';
      // Company comes from the member's Business address — only when they've
      // actually entered a business name. No business name → blank Company.
      final addresses = (d['addresses'] as List? ?? const [])
          .whereType<Map<String, dynamic>>();
      final businessAddr = addresses.firstWhere(
        (a) => (a['addressType']?.toString() ?? '').toLowerCase() == 'business',
        orElse: () => const <String, dynamic>{},
      );
      final businessName = businessAddr['businessName']?.toString().trim() ?? '';
      _cachedContact = _ShareContactCache(
        memberId: auth.memberId,
        name: name,
        mobile: mobile,
        countryCode: countryCode,
        email: email,
        businessName: businessName,
      );
      setState(() {
        _name = name;
        _mobile = mobile;
        _countryCode = countryCode;
        _email = email;
        _businessName = businessName;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load contact details.';
        _loading = false;
      });
    }
  }

  // vCard 3.0 reserves `,` `;` `\` and newlines as structural separators;
  // any of those inside a member's name would break parsing on the scanning
  // device, so they get backslash-escaped per RFC 2426.
  String _escapeVcard(String v) => v
      .replaceAll('\\', '\\\\')
      .replaceAll(';', '\\;')
      .replaceAll(',', '\\,')
      .replaceAll('\n', '\\n');

  String _buildVCard() {
    final digitsCc = _countryCode.replaceAll(RegExp(r'[^0-9]'), '');
    final digitsMob = _mobile.replaceAll(RegExp(r'[^0-9]'), '');
    final fullTel = digitsCc.isNotEmpty ? '+$digitsCc$digitsMob' : digitsMob;

    // iOS Contacts uses the structured `N:` field as the primary display name
    // and falls back to `ORG:` when `N:` is missing — which is why scans were
    // showing the app name on iOS. Android uses `FN:`, so it already worked
    // there. Splitting on the LAST whitespace puts the trailing token in the
    // family slot (matches the dominant Indian-name convention), and a
    // single-word name falls through with family empty + given = full name.
    final trimmed = _name.trim();
    String family = '';
    String given = trimmed;
    final lastSpace = trimmed.lastIndexOf(RegExp(r'\s+'));
    if (lastSpace > 0) {
      family = trimmed.substring(lastSpace).trim();
      given = trimmed.substring(0, lastSpace).trim();
    }
    final escFamily = _escapeVcard(family);
    final escGiven = _escapeVcard(given);
    final escFn = _escapeVcard(trimmed);

    // Company (ORG) is the member's own business name, and only when they've
    // set one. If it's blank we omit ORG entirely so the scanned contact has a
    // blank Company field rather than a misleading hardcoded organisation.
    final business = _businessName.trim();

    final lines = <String>[
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:$escFamily;$escGiven;;;',
      'FN:$escFn',
      if (digitsMob.isNotEmpty) 'TEL;TYPE=CELL:$fullTel',
      if (_email.isNotEmpty) 'EMAIL:${_escapeVcard(_email)}',
      if (business.isNotEmpty) 'ORG:${_escapeVcard(business)}',
      'END:VCARD',
    ];
    // RFC 2426 requires CRLF line breaks. Android tolerates bare LF, but iOS is
    // stricter and can mis-render absent fields (e.g. show a phantom "unknown"
    // company) when fed LF-only — so emit proper CRLF.
    return lines.join('\r\n');
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 20),
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Text(
                'Share My Contact',
                style: AppFonts.display(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Scan this QR to save my contact',
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 20),
              if (_loading)
                  const Padding(
                  padding: const EdgeInsets.all(40),
                  child: const CircularProgressIndicator(color: AppColors.primary),
                )
              else if (_error != null)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: AppFonts.body(color: AppColors.error),
                  ),
                )
              else if (_mobile.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'No mobile number on your profile.\nAdd one in "Edit Profile" to share your contact.',
                    textAlign: TextAlign.center,
                    style: AppFonts.body(
                      color: AppColors.textSecondary,
                      fontSize: 14,
                    ),
                  ),
                )
              else ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: QrImageView(
                    data: _buildVCard(),
                    size: 240,
                    backgroundColor: AppColors.white,
                    eyeStyle:   const QrEyeStyle(
                      eyeShape: QrEyeShape.square,
                      color: AppColors.primaryPrime,
                    ),
                    dataModuleStyle:   const QrDataModuleStyle(
                      dataModuleShape: QrDataModuleShape.square,
                      color: AppColors.primaryPrime,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  _name,
                  style: AppFonts.body(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  [if (_countryCode.replaceAll(RegExp(r'[^0-9]'), '').isNotEmpty) '+${_countryCode.replaceAll(RegExp(r'[^0-9]'), '')}', _mobile].join(' '),
                  style: AppFonts.body(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
                if (_email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    _email,
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  style: TextButton.styleFrom(
                    backgroundColor: AppColors.primaryPrime.withValues(alpha: 0.08),
                    foregroundColor: AppColors.primaryPrime,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    'Close',
                    style: AppFonts.body(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
