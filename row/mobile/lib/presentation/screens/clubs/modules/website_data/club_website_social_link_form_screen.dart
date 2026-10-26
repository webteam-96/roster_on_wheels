import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

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

class ClubSocialLinkFormInitial {
  final int id;
  final String platform;
  final String linkUrl;
  final int sortOrder;
  final bool isActive;
  const ClubSocialLinkFormInitial({
    required this.id,
    required this.platform,
    required this.linkUrl,
    required this.sortOrder,
    required this.isActive,
  });
}

class ClubWebsiteSocialLinkFormScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final ClubSocialLinkFormInitial? initial;

  const ClubWebsiteSocialLinkFormScreen({
    super.key,
    required this.clubId,
    required this.yearId,
    this.initial,
  });

  @override
  State<ClubWebsiteSocialLinkFormScreen> createState() =>
      _ClubWebsiteSocialLinkFormScreenState();
}

class _ClubWebsiteSocialLinkFormScreenState
    extends State<ClubWebsiteSocialLinkFormScreen> {
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
          '/api/clubs/${widget.clubId}/website-data/social_media_links/${widget.initial!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/website-data/social_media_links',
          body: body,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      _showError('Save failed: $e');
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
              hint: 'https://...',
              keyboardType: TextInputType.url,
              prefixIcon: Icons.link,
              validator: (v) {
                if (v == null || v.trim().isEmpty) return 'URL is required';
                if (!v.trim().startsWith('http')) {
                  return 'URL must start with http or https';
                }
                return null;
              },
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
