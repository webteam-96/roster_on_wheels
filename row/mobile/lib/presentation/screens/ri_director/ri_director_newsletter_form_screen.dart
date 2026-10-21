import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_text_field.dart';
import 'widgets/ri_recipient_picker.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class RiDirectorNewsletterFormScreen extends StatefulWidget {
  final int? newsletterId;
  const RiDirectorNewsletterFormScreen({super.key, this.newsletterId});

  @override
  State<RiDirectorNewsletterFormScreen> createState() =>
      _RiDirectorNewsletterFormScreenState();
}

class _RiDirectorNewsletterFormScreenState extends State<RiDirectorNewsletterFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _linkUrlCtrl = TextEditingController();

  String _attachmentType = 'link';
  String? _filePath;
  DateTime? _publishDateTime;
  DateTime? _expiryDateTime;
  bool _isSendEmail = false;
  RiRecipientValue _recipient = const RiRecipientValue();

  bool _loading = false;
  bool _uploading = false;
  bool _saving = false;
  String? _loadError;

  bool get _isEdit => widget.newsletterId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) _load();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _linkUrlCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _loadError = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/newsletters/${widget.newsletterId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final d = resp.data ?? const {};
      if (!mounted) return;
      List<int> parseIds(dynamic v) {
        if (v == null) return const [];
        if (v is String) {
          return v.split(',').map((s) => int.tryParse(s.trim()) ?? 0).where((x) => x > 0).toList();
        }
        if (v is List) {
          return v.map((x) => x is int ? x : int.tryParse(x.toString()) ?? 0).where((x) => x > 0).toList();
        }
        return const [];
      }
      setState(() {
        _titleCtrl.text = d['title']?.toString() ?? '';
        _attachmentType = (d['attachmentType']?.toString() ?? 'link');
        _linkUrlCtrl.text = d['linkUrl']?.toString() ?? '';
        _filePath = d['filePath']?.toString();
        _publishDateTime = d['publishDateTime'] != null
            ? DateTime.tryParse(d['publishDateTime'].toString()) : null;
        _expiryDateTime = d['expiryDateTime'] != null
            ? DateTime.tryParse(d['expiryDateTime'].toString()) : null;
        _isSendEmail = d['isSendEmail'] as bool? ?? false;
        _recipient = RiRecipientValue(
          target: d['recipientTarget']?.toString() ?? 'all',
          zoneIds: parseIds(d['recipientZoneIds']),
          districtIds: parseIds(d['recipientDistrictIds']),
          subgroupIds: parseIds(d['recipientSubgroupIds']),
        );
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _loadError = e.toString(); _loading = false; });
    }
  }

  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf']);
      if (result == null || result.files.isEmpty) return;
      final file = result.files.first;
      if (file.path == null) return;
      setState(() => _uploading = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/ri-director/newsletters/upload',
        filePath: file.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _uploading = false;
        final path = resp.data?['path'] as String?;
        if (path != null && path.isNotEmpty) _filePath = path;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Upload failed: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);
  DateTime _local(DateTime d) => d.isUtc ? d.toLocal() : d;

  /// Picks a date + time.
  /// - [allowPast]=false (default): calendar floor is today.
  /// - [allowPast]=true: floor opens 1 year back (use for "publish date").
  /// - [minDateTime] / [maxDateTime]: cross-field clamps (date-only).
  /// Edit-mode fallback: an existing earlier date is always selectable.
  Future<DateTime?> _pickDateTime(
    DateTime? initial, {
    DateTime? minDateTime,
    DateTime? maxDateTime,
    String? minLabel,
    String? maxLabel,
    bool allowPast = false,
  }) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final initialLocal = initial == null ? now : _local(initial);
    final minLocal = minDateTime == null ? null : _local(minDateTime);
    final maxLocal = maxDateTime == null ? null : _local(maxDateTime);

    DateTime firstDate = allowPast ? DateTime(now.year - 1) : today;
    if (initial != null) {
      final initDate = _dateOnly(initialLocal);
      if (initDate.isBefore(firstDate)) firstDate = initDate;
    }
    if (minLocal != null) {
      final minDate = _dateOnly(minLocal);
      if (minDate.isAfter(firstDate)) firstDate = minDate;
    }

    DateTime lastDate = DateTime(now.year + 5);
    if (maxLocal != null) {
      final maxDate = _dateOnly(maxLocal);
      if (maxDate.isBefore(lastDate)) lastDate = maxDate;
    }
    if (firstDate.isAfter(lastDate)) firstDate = lastDate;

    DateTime initialPick = initialLocal;
    if (initialPick.isBefore(firstDate)) initialPick = firstDate;
    if (initialPick.isAfter(lastDate)) initialPick = lastDate;

    final date = await showDatePicker(
      context: context,
      firstDate: firstDate,
      lastDate: lastDate,
      initialDate: initialPick,
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initialPick),
    );
    if (time == null) return null;
    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);

    if (minLocal != null && _dateOnly(picked).isBefore(_dateOnly(minLocal))) {
      _snack(minLabel ?? 'Date must be on or after the minimum date.');
      return null;
    }
    if (maxLocal != null && _dateOnly(picked).isAfter(_dateOnly(maxLocal))) {
      _snack(maxLabel ?? 'Date must be on or before the maximum date.');
      return null;
    }
    return picked;
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_publishDateTime == null) { _snack('Publish date/time is required.'); return; }
    if (_expiryDateTime == null) { _snack('Expiry date/time is required.'); return; }
    // Enforce publish ≤ expiry (date-only).
    if (_dateOnly(_local(_expiryDateTime!))
        .isBefore(_dateOnly(_local(_publishDateTime!)))) {
      _snack('Expiry date must be on or after the publish date.'); return;
    }
    if (_attachmentType == 'link') {
      final urlErr = _validateLinkUrl(_linkUrlCtrl.text);
      if (urlErr != null) { _snack(urlErr); return; }
    }
    if (_attachmentType == 'pdf' && (_filePath == null || _filePath!.isEmpty)) {
      _snack('PDF file is required.'); return;
    }
    if (_recipient.target == 'zones' && _recipient.zoneIds.isEmpty) {
      _snack('Select at least one zone.'); return;
    }
    if (_recipient.target == 'districts' && _recipient.districtIds.isEmpty) {
      _snack('Select at least one district.'); return;
    }
    if (_recipient.target == 'subgroups' && _recipient.subgroupIds.isEmpty) {
      _snack('Select at least one sub group.'); return;
    }
    if (_uploading) { _snack('Please wait for upload to finish.'); return; }

    setState(() => _saving = true);
    try {
      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'publishDateTime': _publishDateTime!.toUtc().toIso8601String(),
        'expiryDateTime': _expiryDateTime!.toUtc().toIso8601String(),
        'attachmentType': _attachmentType,
        'linkUrl': _attachmentType == 'link' ? _linkUrlCtrl.text.trim() : null,
        'filePath': _attachmentType == 'pdf' ? _filePath : null,
        'isSendEmail': _isSendEmail,
        'recipientTarget': _recipient.target,
        'recipientZoneIds': _recipient.zoneIds,
        'recipientDistrictIds': _recipient.districtIds,
        'recipientSubgroupIds': _recipient.subgroupIds,
      };
      if (_isEdit) {
        await _api.put('/api/ri-director/newsletters/${widget.newsletterId}', body: payload);
      } else {
        await _api.post('/api/ri-director/newsletters', body: payload);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Newsletter updated' : 'Newsletter created'),
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

  /// Validates a Link URL string.
  /// Returns null if valid, otherwise an error message.
  /// Requires:
  ///  - http:// or https:// scheme
  ///  - non-empty host with at least one dot and a 2+ char TLD
  ///    (e.g. example.com, sub.example.co.in)
  static String? _validateLinkUrl(String? raw) {
    final v = (raw ?? '').trim();
    if (v.isEmpty) return 'Link URL is required';
    final uri = Uri.tryParse(v);
    if (uri == null || !uri.hasScheme) {
      return 'URL must start with http:// or https://';
    }
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      return 'URL must start with http:// or https://';
    }
    final host = uri.host;
    if (host.isEmpty) return 'Enter a valid URL (e.g. https://example.com)';
    final hostOk = RegExp(r'^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$').hasMatch(host);
    if (!hostOk) return 'URL must include a valid domain (e.g. .com, .org)';
    return null;
  }

  String _fmtDT(DateTime d) {
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    final hh = d.hour.toString().padLeft(2, '0');
    final mi = d.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${d.year}  $hh:$mi';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEdit ? 'Edit Newsletter' : 'Add Newsletter'),
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
            label: 'Title *',
            controller: _titleCtrl,
            maxLength: 300,
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
          ),
          const SizedBox(height: 14),
          _buildAttachmentTypeSelector(),
          const SizedBox(height: 14),
          if (_attachmentType == 'link')
            CustomTextField(
              label: 'Link URL *',
              controller: _linkUrlCtrl,
              keyboardType: TextInputType.url,
              hint: 'https://example.com',
              validator: (v) =>
                  _attachmentType == 'link' ? _validateLinkUrl(v) : null,
            )
          else
            _buildFilePicker(),
          const SizedBox(height: 14),
          _buildDateTimeField(
            label: 'Publish Date & Time *',
            value: _publishDateTime,
            icon: Icons.schedule,
            onTap: () async {
              // Publish may legitimately be in the past; must be ≤ expiry.
              final picked = await _pickDateTime(
                _publishDateTime,
                maxDateTime: _expiryDateTime,
                maxLabel: 'Publish date must be on or before the expiry date.',
                allowPast: true,
              );
              if (picked != null) {
                setState(() {
                  _publishDateTime = picked;
                  if (_expiryDateTime != null &&
                      _dateOnly(_local(_expiryDateTime!))
                          .isBefore(_dateOnly(picked))) {
                    _expiryDateTime = null;
                  }
                });
              }
            },
          ),
          const SizedBox(height: 14),
          _buildDateTimeField(
            label: 'Expiry Date & Time *',
            value: _expiryDateTime,
            icon: Icons.event_busy_outlined,
            onTap: () async {
              // Expiry must be ≥ publish, and must be in the future.
              final picked = await _pickDateTime(
                _expiryDateTime,
                minDateTime: _publishDateTime,
                minLabel: 'Expiry date must be on or after the publish date.',
              );
              if (picked != null) setState(() => _expiryDateTime = picked);
            },
          ),
          const SizedBox(height: 16),
          Text('Recipients', style: AppTextStyles.h4),
          const SizedBox(height: 8),
          const SizedBox(height: 14),
          _buildEmailToggle(),
          const SizedBox(height: 24),
          _buildSaveButton(),
        ],
        ),
      ),
    );
  }

  Widget _buildAttachmentTypeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Attachment Type *', style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: _buildTypeChip('link', 'Link', Icons.link)),
          const SizedBox(width: 8),
          Expanded(child: _buildTypeChip('pdf', 'PDF', Icons.picture_as_pdf_outlined)),
        ]),
      ],
    );
  }

  Widget _buildTypeChip(String value, String label, IconData icon) {
    final selected = _attachmentType == value;
    return InkWell(
      onTap: () => setState(() => _attachmentType = value),
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

  Widget _buildFilePicker() {
    final hasFile = _filePath != null && _filePath!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('PDF *', style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        if (hasFile)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(children: [
              const Icon(Icons.picture_as_pdf_outlined, color: AppColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(_filePath!.split('/').last, style: AppTextStyles.body,
                    overflow: TextOverflow.ellipsis),
              ),
              IconButton(
                icon: const Icon(Icons.close, color: AppColors.error),
                onPressed: _uploading ? null : () => setState(() => _filePath = null),
              ),
            ]),
          )
        else
          InkWell(
            onTap: _uploading ? null : _pickFile,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 20),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(children: [
                if (_uploading)
                  const CircularProgressIndicator(color: AppColors.primary, strokeWidth: 2)
                else
                  const Icon(Icons.upload_file, size: 32, color: AppColors.textSecondary),
                const SizedBox(height: 6),
                Text(_uploading ? 'Uploading...' : 'Tap to upload PDF',
                    style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
              ]),
            ),
          ),
      ],
    );
  }

  Widget _buildDateTimeField({
    required String label,
    required DateTime? value,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(children: [
              Icon(icon, size: 18, color: AppColors.textSecondary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  value != null ? _fmtDT(value) : 'Tap to select',
                  style: AppTextStyles.body.copyWith(
                    color: value != null ? AppColors.textPrimary : AppColors.textMuted,
                  ),
                ),
              ),
              const Icon(Icons.arrow_drop_down, color: AppColors.textSecondary),
            ]),
          ),
        ),
      ],
    );
  }


  Widget _buildEmailToggle() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: SwitchListTile(
        title: Text('Send through Email', style: AppTextStyles.bodyMedium),
        subtitle: Text(
          _isSendEmail
              ? 'Recipients will receive an email notification'
              : 'Recipients will not receive email',
          style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
        ),
        value: _isSendEmail,
        onChanged: (v) => setState(() => _isSendEmail = v),
        contentPadding: EdgeInsets.zero,
        activeThumbColor: AppColors.primary,
      ),
    );
  }

  Widget _buildSaveButton() {
    return ElevatedButton.icon(
      onPressed: _saving ? null : _save,
      icon: _saving
          ? const SizedBox(width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(Colors.white)))
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
