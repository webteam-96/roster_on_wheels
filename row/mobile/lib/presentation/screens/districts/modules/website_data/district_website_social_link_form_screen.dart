import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Validates an absolute external URL. Catches the common "httpgood" /
/// "http://httpgood" mistakes by requiring an explicit scheme, a host that
/// parses as absolute, contains at least one dot, and no whitespace.
String? _validateExternalUrl(String? raw) {
  final v = (raw ?? '').trim();
  if (v.isEmpty) return 'URL is required';
  if (v.contains(RegExp(r'\s'))) return 'URL must not contain spaces';
  if (!v.startsWith('http://') && !v.startsWith('https://')) {
    return 'URL must start with http:// or https://';
  }
  final uri = Uri.tryParse(v);
  if (uri == null || !uri.isAbsolute) return 'Enter a valid URL';
  final host = uri.host;
  if (host.isEmpty) return 'Enter a valid URL';
  if (!host.contains('.')) {
    return 'URL must have a valid domain (e.g. example.com)';
  }
  return null;
}

const _socialPlatforms = <(String, String)>[
  ('facebook', 'Facebook'),
  ('instagram', 'Instagram'),
  ('twitter', 'Twitter / X'),
  ('linkedin', 'LinkedIn'),
  ('youtube', 'YouTube'),
  ('telegram', 'Telegram'),
  ('pinterest', 'Pinterest'),
  ('threads', 'Threads'),
  ('website', 'Website'),
];

class SocialLinkFormInitial {
  final int id;
  final String platform;
  final String linkUrl;
  final int sortOrder;
  final bool isActive;
  const SocialLinkFormInitial({
    required this.id,
    required this.platform,
    required this.linkUrl,
    required this.sortOrder,
    required this.isActive,
  });
}

class DistrictWebsiteSocialLinkFormScreen extends StatefulWidget {
  final int districtId;
  final int yearId;
  final SocialLinkFormInitial? initial;

  const DistrictWebsiteSocialLinkFormScreen({
    super.key,
    required this.districtId,
    required this.yearId,
    this.initial,
  });

  @override
  State<DistrictWebsiteSocialLinkFormScreen> createState() =>
      _DistrictWebsiteSocialLinkFormScreenState();
}

class _DistrictWebsiteSocialLinkFormScreenState
    extends State<DistrictWebsiteSocialLinkFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _urlCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();

  late String _platform;
  bool _isActive = true;
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _platform = init.platform;
      _urlCtrl.text = init.linkUrl;
      _sortCtrl.text = init.sortOrder.toString();
      _isActive = init.isActive;
    } else {
      _platform = _socialPlatforms.first.$1;
      _sortCtrl.text = '0';
    }
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = {
      'platform': _platform,
      'linkUrl': _urlCtrl.text.trim(),
      'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 0,
      'isActive': _isActive,
      if (!_isEdit) 'yearId': widget.yearId,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/website-data/social-links/${widget.initial!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/website-data/social-links',
          body: body,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      // Surface the backend's precise 400 message (e.g. "Facebook is already
      // added for this district…") instead of a wrapped "Save failed:".
      _showError(e is ApiException ? e.message : 'Save failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Social Link' : 'Add Social Link',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _saving ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.goldPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.black54,
                      ),
                    )
                  : Text(
                      'Save',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            DropdownButtonFormField<String>(
              initialValue: _platform,
              decoration: InputDecoration(
                labelText: 'Platform',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
              items: _socialPlatforms
                  .map((p) =>
                      DropdownMenuItem(value: p.$1, child: Text(p.$2)))
                  .toList(),
              onChanged: _saving
                  ? null
                  : (v) => setState(
                      () => _platform = v ?? _socialPlatforms.first.$1),
            ),
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Link URL',
              controller: _urlCtrl,
              hint: 'https://example.com',
              keyboardType: TextInputType.url,
              prefixIcon: Icons.link,
              validator: _validateExternalUrl,
            ),
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Sort Order',
              controller: _sortCtrl,
              hint: '0',
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(10),
                color: AppColors.surface,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Status', style: AppTextStyles.bodyMedium),
                        const SizedBox(height: 2),
                        Text(
                          _isActive ? 'Active' : 'Inactive',
                          style: AppTextStyles.caption.copyWith(
                            color: _isActive
                                ? AppColors.success
                                : AppColors.textMuted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Switch.adaptive(
                    value: _isActive,
                    activeThumbColor: AppColors.primary,
                    onChanged:
                        _saving ? null : (v) => setState(() => _isActive = v),
                  ),
                ],
              ),
            ),
          ],
          ),
        ),
      ),
    );
  }
}
