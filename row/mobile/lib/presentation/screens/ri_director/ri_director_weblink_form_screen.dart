import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class RiDirectorWeblinkFormScreen extends StatefulWidget {
  final int? weblinkId;
  const RiDirectorWeblinkFormScreen({super.key, this.weblinkId});

  @override
  State<RiDirectorWeblinkFormScreen> createState() => _RiDirectorWeblinkFormScreenState();
}

class _RiDirectorWeblinkFormScreenState extends State<RiDirectorWeblinkFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _writeupCtrl = TextEditingController();
  final _linkUrlCtrl = TextEditingController();
  final _youtubeUrlCtrl = TextEditingController();
  final _buttonTextCtrl = TextEditingController();
  final _sortOrderCtrl = TextEditingController(text: '0');

  String _linkType = 'url';
  bool _isActive = true;
  bool _loading = false;
  bool _saving = false;
  String? _loadError;

  bool get _isEdit => widget.weblinkId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) _load();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _writeupCtrl.dispose();
    _linkUrlCtrl.dispose();
    _youtubeUrlCtrl.dispose();
    _buttonTextCtrl.dispose();
    _sortOrderCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _loadError = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/weblinks/${widget.weblinkId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final d = resp.data ?? const {};
      if (!mounted) return;
      setState(() {
        _titleCtrl.text = d['title']?.toString() ?? '';
        _writeupCtrl.text = d['writeup']?.toString() ?? '';
        _linkType = (d['linkType']?.toString() ?? 'url');
        if (_linkType != 'url' && _linkType != 'youtube') _linkType = 'url';
        _linkUrlCtrl.text = d['linkUrl']?.toString() ?? '';
        _youtubeUrlCtrl.text = d['youtubeUrl']?.toString() ?? '';
        _buttonTextCtrl.text = d['buttonText']?.toString() ?? '';
        _sortOrderCtrl.text = (d['sortOrder'] as int? ?? 0).toString();
        _isActive = d['isActive'] as bool? ?? true;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _loadError = e.toString(); _loading = false; });
    }
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'writeup': _writeupCtrl.text.trim().isEmpty ? null : _writeupCtrl.text.trim(),
        'linkType': _linkType,
        'linkUrl': _linkType == 'url' && _linkUrlCtrl.text.trim().isNotEmpty
            ? _linkUrlCtrl.text.trim()
            : null,
        'youtubeUrl': _linkType == 'youtube' && _youtubeUrlCtrl.text.trim().isNotEmpty
            ? _youtubeUrlCtrl.text.trim()
            : null,
        'buttonText': _buttonTextCtrl.text.trim().isEmpty ? null : _buttonTextCtrl.text.trim(),
        'sortOrder': int.tryParse(_sortOrderCtrl.text.trim()) ?? 0,
        'isActive': _isActive,
      };
      if (_isEdit) {
        await _api.put('/api/ri-director/weblinks/${widget.weblinkId}', body: payload);
      } else {
        await _api.post('/api/ri-director/weblinks', body: payload);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Web link updated' : 'Web link created'),
          backgroundColor: AppColors.success,
        ),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEdit ? 'Edit Web Link' : 'Add Web Link'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _loadError != null
              ? Center(child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text(_loadError!, style: AppTextStyles.body),
                ))
              : _buildForm(),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
            16, 16, 16, 100),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
          CustomTextField(
            label: 'Title *',
            controller: _titleCtrl,
            maxLength: 300,
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
          ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Writeup',
            controller: _writeupCtrl,
            maxLines: 4,
          ),
          const SizedBox(height: 14),
          _buildLinkTypeSelector(),
          const SizedBox(height: 14),
          if (_linkType == 'url')
            CustomTextField(
              label: 'URL *',
              controller: _linkUrlCtrl,
              hint: 'https://example.com',
              keyboardType: TextInputType.url,
              validator: (v) => _linkType == 'url' && (v == null || v.trim().isEmpty)
                  ? 'URL is required'
                  : null,
            )
          else
            CustomTextField(
              label: 'YouTube URL *',
              controller: _youtubeUrlCtrl,
              hint: 'https://youtube.com/watch?v=...',
              keyboardType: TextInputType.url,
              validator: (v) => _linkType == 'youtube' && (v == null || v.trim().isEmpty)
                  ? 'YouTube URL is required'
                  : null,
            ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Button Text',
            controller: _buttonTextCtrl,
            hint: 'e.g., Learn More',
            maxLength: 100,
          ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Sort Order',
            controller: _sortOrderCtrl,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          ),
          const SizedBox(height: 14),
          _buildActiveToggle(),
          const SizedBox(height: 24),
          _buildSaveButton(),
        ],
        ),
      ),
    );
  }

  Widget _buildLinkTypeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Link Type *', style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: _buildTypeChip('url', 'URL', Icons.link)),
          const SizedBox(width: 8),
          Expanded(child: _buildTypeChip('youtube', 'YouTube', Icons.play_circle_outline)),
        ]),
      ],
    );
  }

  Widget _buildTypeChip(String value, String label, IconData icon) {
    final selected = _linkType == value;
    return InkWell(
      onTap: () => setState(() => _linkType = value),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryLight : AppColors.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.border,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 18, color: selected ? AppColors.primary : AppColors.textSecondary),
          const SizedBox(width: 6),
          Text(label, style: AppFonts.body(
            fontSize: 14,
            color: selected ? AppColors.primary : AppColors.textSecondary,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          )),
        ]),
      ),
    );
  }

  Widget _buildActiveToggle() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: SwitchListTile(
        title: Text('Active', style: AppTextStyles.bodyMedium),
        subtitle: Text(
          _isActive ? 'Link is visible to users' : 'Link is hidden from users',
          style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
        ),
        value: _isActive,
        onChanged: (v) => setState(() => _isActive = v),
        contentPadding: EdgeInsets.zero,
        activeThumbColor: AppColors.primary,
      ),
    );
  }

  Widget _buildSaveButton() {
    return ElevatedButton.icon(
      onPressed: _saving ? null : _save,
      icon: _saving
          ? const SizedBox(
              width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(Colors.white)),
            )
          : Icon(_isEdit ? Icons.save : Icons.add),
      label: Text(_isEdit ? 'Update' : 'Create'),
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(48),
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }
}
