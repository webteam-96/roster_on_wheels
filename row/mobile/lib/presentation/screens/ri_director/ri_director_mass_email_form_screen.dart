import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_text_field.dart';
import 'widgets/ri_recipient_picker.dart';

class RiDirectorMassEmailFormScreen extends StatefulWidget {
  final int? emailId;
  const RiDirectorMassEmailFormScreen({super.key, this.emailId});

  @override
  State<RiDirectorMassEmailFormScreen> createState() =>
      _RiDirectorMassEmailFormScreenState();
}

class _RiDirectorMassEmailFormScreenState extends State<RiDirectorMassEmailFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _subjectCtrl = TextEditingController();
  final _fromNameCtrl = TextEditingController();
  final _replyNameCtrl = TextEditingController();
  final _replyEmailCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();

  RiRecipientValue _recipient = const RiRecipientValue();
  bool _loading = false;
  bool _saving = false;
  String? _loadError;

  bool get _isEdit => widget.emailId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) _load();
  }

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _fromNameCtrl.dispose();
    _replyNameCtrl.dispose();
    _replyEmailCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _loadError = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/mass-emails/${widget.emailId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final d = resp.data ?? const {};
      if (!mounted) return;
      List<int> parseIds(dynamic v) {
        if (v == null) return const [];
        if (v is List) return v.map((x) => x is int ? x : int.tryParse(x.toString()) ?? 0).where((x) => x > 0).toList();
        return const [];
      }
      // recipientType: 1=all, 2=zones, 3=districts, 4=subgroups
      final rt = d['recipientType'] as int? ?? 1;
      final target = rt == 2 ? 'zones' : rt == 3 ? 'districts' : rt == 4 ? 'subgroups' : 'all';
      setState(() {
        _subjectCtrl.text = d['subject']?.toString() ?? '';
        _fromNameCtrl.text = d['fromName']?.toString() ?? '';
        _replyNameCtrl.text = d['replyName']?.toString() ?? '';
        _replyEmailCtrl.text = d['replyEmail']?.toString() ?? '';
        _bodyCtrl.text = d['emailBody']?.toString() ?? '';
        _recipient = RiRecipientValue(
          target: target,
          zoneIds: parseIds(d['zoneIds']),
          districtIds: parseIds(d['districtIds']),
          subgroupIds: parseIds(d['subgroupIds']),
        );
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
    if (_recipient.target == 'zones' && _recipient.zoneIds.isEmpty) { _snack('Select at least one zone.'); return; }
    if (_recipient.target == 'districts' && _recipient.districtIds.isEmpty) { _snack('Select at least one district.'); return; }
    if (_recipient.target == 'subgroups' && _recipient.subgroupIds.isEmpty) { _snack('Select at least one sub group.'); return; }

    setState(() => _saving = true);
    try {
      final recipientType = _recipient.target == 'zones'
          ? 2
          : _recipient.target == 'districts'
              ? 3
              : _recipient.target == 'subgroups'
                  ? 4
                  : 1;
      final payload = <String, dynamic>{
        'recipientType': recipientType,
        'zoneIds': _recipient.target == 'zones' ? _recipient.zoneIds : <int>[],
        'districtIds': _recipient.target == 'districts' ? _recipient.districtIds : <int>[],
        'subgroupIds': _recipient.target == 'subgroups' ? _recipient.subgroupIds : <int>[],
        'memberIds': <int>[],
        'fromName': _fromNameCtrl.text.trim(),
        'replyName': _replyNameCtrl.text.trim().isEmpty ? null : _replyNameCtrl.text.trim(),
        'replyEmail': _replyEmailCtrl.text.trim().isEmpty ? null : _replyEmailCtrl.text.trim(),
        'subject': _subjectCtrl.text.trim(),
        'emailBody': _bodyCtrl.text.trim().isEmpty ? null : _bodyCtrl.text.trim(),
        'saveAsDraft': true,
      };
      if (_isEdit) {
        await _api.put('/api/ri-director/mass-emails/${widget.emailId}', body: payload);
      } else {
        await _api.post('/api/ri-director/mass-emails', body: payload);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Mass email updated' : 'Mass email saved as draft'),
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

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEdit ? 'Edit Draft' : 'Compose Email'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _loadError != null
              ? Center(child: Padding(padding: const EdgeInsets.all(20),
                  child: Text(_loadError!, style: AppTextStyles.body)))
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
            label: 'From Name *',
            controller: _fromNameCtrl,
            maxLength: 200,
            validator: (v) => (v == null || v.trim().isEmpty) ? 'From name is required' : null,
          ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Reply Name',
            controller: _replyNameCtrl,
            maxLength: 200,
          ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Reply Email',
            controller: _replyEmailCtrl,
            keyboardType: TextInputType.emailAddress,
            maxLength: 200,
          ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Subject *',
            controller: _subjectCtrl,
            maxLength: 300,
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Subject is required' : null,
          ),
          const SizedBox(height: 14),
          CustomTextField(
            label: 'Email Body',
            controller: _bodyCtrl,
            hint: 'Plain text or HTML',
            maxLines: 10,
            keyboardType: TextInputType.multiline,
            textInputAction: TextInputAction.newline,
          ),
          const SizedBox(height: 16),
          Text('Recipients', style: AppTextStyles.h4),
          const SizedBox(height: 8),
          RiRecipientPicker(
            value: _recipient,
            onChanged: (v) => setState(() => _recipient = v),
            channel: 'email',
            checkCredits: true,
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.primaryLight.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(children: [
              const Icon(Icons.info_outline, size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Saved as Draft. Open the detail screen to send.',
                  style: AppTextStyles.caption.copyWith(color: AppColors.primary),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          _buildSaveButton(),
        ],
        ),
      ),
    );
  }

  Widget _buildSaveButton() {
    return ElevatedButton.icon(
      onPressed: _saving ? null : _save,
      icon: _saving
          ? const SizedBox(width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(Colors.white)))
          : Icon(_isEdit ? Icons.save : Icons.save_outlined),
      label: Text(_isEdit ? 'Update Draft' : 'Save as Draft'),
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
