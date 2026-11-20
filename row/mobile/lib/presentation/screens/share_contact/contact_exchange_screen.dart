import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart' hide Text;
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:mobile_scanner/mobile_scanner.dart'
    show
        BarcodeFormat,
        MobileScanner,
        MobileScannerController,
        MobileScannerErrorCode;
import 'package:path_provider/path_provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/network/api_client.dart';
import 'package:rotary_flutter_app/core/network/api_exceptions.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Member-to-member contact exchange inside ROW. My code is a signed token
/// that lasts a few minutes (no personal data in the QR); scanning another
/// member's code asks the API for their card, which already leaves out what
/// their privacy settings hide.
class ContactExchangeScreen extends StatefulWidget {
  const ContactExchangeScreen({super.key});

  @override
  State<ContactExchangeScreen> createState() => _ContactExchangeScreenState();
}

class _ContactExchangeScreenState extends State<ContactExchangeScreen> {
  final _api = ApiClient();
  String? _code;
  String? _codeError;
  Timer? _refresh;

  Map<String, dynamic>? _card;
  bool _scanning = false;
  String? _scanError;

  @override
  void initState() {
    super.initState();
    _loadCode();
    // The code expires after 5 minutes; draw a fresh one before that.
    _refresh = Timer.periodic(const Duration(minutes: 4), (_) => _loadCode());
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _loadCode() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/api/contact-exchange/my-code',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _code = res.data?['code']?.toString();
        _codeError = _code == null ? 'Could not load your code.' : null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _codeError = e.message);
    }
  }

  Future<void> _scan() async {
    final raw = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _ScanPage()),
    );
    if (raw == null || !mounted) return;
    setState(() {
      _scanning = true;
      _scanError = null;
      _card = null;
    });
    try {
      final res = await _api.post<Map<String, dynamic>>(
        '/api/contact-exchange/scan',
        body: {'code': raw},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _card = res.data;
        _scanning = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _scanError = e.message;
        _scanning = false;
      });
    }
  }

  Future<void> _saveToContacts(Map<String, dynamic> card) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final status =
          await FlutterContacts.permissions.request(PermissionType.write);
      if (status != PermissionStatus.granted &&
          status != PermissionStatus.limited) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Contacts permission denied.')));
        return;
      }
      final name = card['name']?.toString().trim() ?? '';
      final cut = name.lastIndexOf(' ');
      final phone = card['phone']?.toString() ?? '';
      final email = card['email']?.toString() ?? '';
      final clubs = (card['clubs'] as List? ?? const []).map((c) => '$c');
      await FlutterContacts.create(Contact(
        name: cut > 0
            ? Name(first: name.substring(0, cut), last: name.substring(cut + 1))
            : Name(first: name),
        phones: [if (phone.isNotEmpty) Phone(number: phone.replaceAll(' ', ''))],
        emails: [if (email.isNotEmpty) Email(address: email)],
        organizations: [
          if (clubs.isNotEmpty) Organization(name: clubs.first),
        ],
      ));
      messenger.showSnackBar(
          const SnackBar(content: Text('Saved to contacts.')));
    } on Exception {
      messenger.showSnackBar(
          const SnackBar(content: Text('Could not save contact.')));
    }
  }

  Future<void> _shareVCard(Map<String, dynamic> card) async {
    final messenger = ScaffoldMessenger.of(context);
    final box = context.findRenderObject() as RenderBox?;
    try {
      final dir = await getTemporaryDirectory();
      final safe = (card['name']?.toString() ?? '')
          .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
      final file = File('${dir.path}/${safe.isEmpty ? 'contact' : safe}.vcf');
      await file.writeAsString(card['vcard']?.toString() ?? '');
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'text/vcard')],
        subject: card['name']?.toString(),
        sharePositionOrigin: (box != null && box.hasSize)
            ? box.localToGlobal(Offset.zero) & box.size
            : const Rect.fromLTWH(0, 0, 1, 1),
      );
    } on Exception {
      messenger.showSnackBar(
          const SnackBar(content: Text('Could not share contact.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        title: Text('Exchange contacts',
            style: AppFonts.display(fontSize: 20, fontWeight: FontWeight.w600)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          Text('My code',
              style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 4),
          Text(
              'Another ROW member scans this in the app to get your contact. It changes every few minutes, and your privacy settings decide what they see.',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          Center(child: _myCode()),
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primaryPrime,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: const StadiumBorder(),
              ),
              onPressed: _scanning ? null : _scan,
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text("Scan a member's code"),
            ),
          ),
          const SizedBox(height: 20),
          if (_scanning)
            const Center(
                child: Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(color: AppColors.primary),
            ))
          else if (_scanError != null)
            Text(_scanError!,
                textAlign: TextAlign.center,
                style: AppFonts.body(color: AppColors.error))
          else if (_card != null)
            _cardView(_card!),
        ],
      ),
    );
  }

  Widget _myCode() {
    final code = _code;
    if (code != null) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
        ),
        child: QrImageView(
          data: code,
          size: 220,
          backgroundColor: AppColors.white,
          eyeStyle: const QrEyeStyle(
              eyeShape: QrEyeShape.square, color: AppColors.primaryPrime),
          dataModuleStyle: const QrDataModuleStyle(
              dataModuleShape: QrDataModuleShape.square,
              color: AppColors.primaryPrime),
        ),
      );
    }
    if (_codeError != null) {
      return Column(children: [
        Text(_codeError!,
            textAlign: TextAlign.center,
            style: AppFonts.body(color: AppColors.error)),
        TextButton(onPressed: _loadCode, child: const Text('Try again')),
      ]);
    }
    return const Padding(
      padding: EdgeInsets.all(40),
      child: CircularProgressIndicator(color: AppColors.primary),
    );
  }

  Widget _cardView(Map<String, dynamic> card) {
    final clubs = (card['clubs'] as List? ?? const []).map((c) => '$c').toList();
    final hidden = (card['hidden'] as List? ?? const []).map((h) => '$h');
    final phone = card['phone']?.toString();
    final email = card['email']?.toString();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(card['name']?.toString() ?? '',
              style: AppFonts.body(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          if (clubs.isNotEmpty)
            Text(clubs.join(', '),
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 10),
          if (phone != null && phone.isNotEmpty)
            Text(phone, style: AppFonts.body(fontSize: 15)),
          if (email != null && email.isNotEmpty)
            Text(email, style: AppFonts.body(fontSize: 15)),
          if (hidden.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
                hidden.contains('phone') && hidden.contains('email')
                    ? 'This member keeps their phone and email private.'
                    : hidden.contains('phone')
                        ? 'This member keeps their phone private.'
                        : 'This member keeps their email private.',
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 14),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => _saveToContacts(card),
                child: const Text('Save to contacts'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton(
                onPressed: () => _shareVCard(card),
                child: const Text('Share vCard'),
              ),
            ),
          ]),
        ],
      ),
    );
  }
}

/// Full-screen camera that returns the first QR value it reads.
class _ScanPage extends StatefulWidget {
  const _ScanPage();

  @override
  State<_ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<_ScanPage> {
  final _controller =
      MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Scan a member's code")),
      body: MobileScanner(
        controller: _controller,
        onDetect: (capture) {
          final value = capture.barcodes
              .map((b) => b.rawValue)
              .firstWhere((v) => v != null && v.isNotEmpty, orElse: () => null);
          if (_done || value == null) return;
          _done = true;
          Navigator.of(context).pop(value);
        },
        errorBuilder: (context, error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              error.errorCode == MobileScannerErrorCode.permissionDenied
                  ? 'Camera permission is off. Turn it on in Settings to scan.'
                  : 'The camera could not start.',
              textAlign: TextAlign.center,
              style: AppFonts.body(color: AppColors.textPrimary),
            ),
          ),
        ),
      ),
    );
  }
}
