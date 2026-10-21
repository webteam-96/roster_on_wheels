import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class RiDirectorDocumentFormScreen extends StatefulWidget {
  final int? documentId;
  const RiDirectorDocumentFormScreen({super.key, this.documentId});

  @override
  State<RiDirectorDocumentFormScreen> createState() => _RiDirectorDocumentFormScreenState();
}

class _RiDirectorDocumentFormScreenState extends State<RiDirectorDocumentFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();

  String _accessType = 'downloadable';
  String? _filePath;
  String? _originalFileName;
  DateTime? _publishDateTime;
  DateTime? _expiryDateTime;

  bool _loading = false;
  bool _uploading = false;
  bool _saving = false;
  String? _loadError;

  bool get _isEdit => widget.documentId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) _load();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _loadError = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/documents/${widget.documentId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final d = resp.data ?? const {};
      if (!mounted) return;
      setState(() {
        _titleCtrl.text = d['title']?.toString() ?? '';
        _accessType = d['accessType']?.toString() ?? 'downloadable';
        _filePath = d['filePath']?.toString();
        _originalFileName = d['originalFileName']?.toString();
        _publishDateTime = d['publishDateTime'] != null ? DateTime.tryParse(d['publishDateTime'].toString()) : null;
        _expiryDateTime = d['expiryDateTime'] != null ? DateTime.tryParse(d['expiryDateTime'].toString()) : null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _loadError = e.toString(); _loading = false; });
    }
  }

  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(type: FileType.any);
      if (result == null || result.files.isEmpty) return;
      final file = result.files.first;
      if (file.path == null) return;
      setState(() => _uploading = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/ri-director/documents/upload',
        filePath: file.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final path = resp.data?['path'] as String?;
      final name = resp.data?['originalFileName'] as String? ?? file.name;
      setState(() {
        _uploading = false;
        if (path != null && path.isNotEmpty) {
          _filePath = path;
          _originalFileName = name;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Upload failed: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<DateTime?> _pickDateTime(
    DateTime? initial, {
    DateTime? minDateTime,
    bool allowPast = false,
  }) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final minLocal = minDateTime == null
        ? null
        : (minDateTime.isUtc ? minDateTime.toLocal() : minDateTime);
    DateTime initialLocal = initial == null
        ? now
        : (initial.isUtc ? initial.toLocal() : initial);
    // Past disabled by default; opens to 1 year back when [allowPast] is
    // true (use for "publish date" which may legitimately be backdated).
    // Edit-mode fallback: an existing earlier date is always selectable.
    // minDateTime raises the floor when it is later (e.g. expiry ≥ publish).
    DateTime firstDate = allowPast ? DateTime(now.year - 1) : today;
    if (initial != null) {
      final initDate = DateTime(initialLocal.year, initialLocal.month, initialLocal.day);
      if (initDate.isBefore(firstDate)) firstDate = initDate;
    }
    if (minLocal != null) {
      final minDate = DateTime(minLocal.year, minLocal.month, minLocal.day);
      if (minDate.isAfter(firstDate)) firstDate = minDate;
    }
    if (initialLocal.isBefore(firstDate)) initialLocal = firstDate;
    final date = await showDatePicker(
      context: context,
      firstDate: firstDate,
      lastDate: DateTime(now.year + 5),
      initialDate: initialLocal,
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initialLocal),
    );
    if (time == null) return null;
    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    if (minLocal != null && !picked.isAfter(minLocal)) {
      _snack('Expiry must be after publish date.');
      return null;
    }
    return picked;
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_filePath == null || _filePath!.isEmpty) {
      _snack('Please upload a file.'); return;
    }
    if (_publishDateTime == null) { _snack('Publish date/time is required.'); return; }
    if (_expiryDateTime == null) { _snack('Expiry date/time is required.'); return; }
    if (_expiryDateTime!.isBefore(_publishDateTime!)) {
      _snack('Expiry must be after publish.'); return;
    }
    if (_uploading) { _snack('Please wait for upload to finish.'); return; }

    setState(() => _saving = true);
    try {
      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'accessType': _accessType,
        'filePath': _filePath,
        'originalFileName': _originalFileName,
        'publishDateTime': _publishDateTime!.toUtc().toIso8601String(),
        'expiryDateTime': _expiryDateTime!.toUtc().toIso8601String(),
      };
      if (_isEdit) {
        await _api.put('/api/ri-director/documents/${widget.documentId}', body: payload);
      } else {
        await _api.post('/api/ri-director/documents', body: payload);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Document updated' : 'Document created'),
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

  String _fmtDT(DateTime d) {
    final local = d.isUtc ? d.toLocal() : d;
    final dd = local.day.toString().padLeft(2, '0');
    final mm = local.month.toString().padLeft(2, '0');
    final hh = local.hour.toString().padLeft(2, '0');
    final mi = local.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${local.year}  $hh:$mi';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEdit ? 'Edit Document' : 'Add Document'),
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
            maxLength: 50,
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
          ),
          const SizedBox(height: 14),
          _buildAccessTypeSelector(),
          const SizedBox(height: 14),
          _buildFilePicker(),
          const SizedBox(height: 14),
          _buildDateTimeField(
            label: 'Publish Date & Time *',
            value: _publishDateTime,
            icon: Icons.schedule,
            onTap: () async {
              // Publish may legitimately be in the past (publish floor opens
              // to 1 year back).
              final picked = await _pickDateTime(_publishDateTime, allowPast: true);
              if (picked != null) {
                setState(() {
                  _publishDateTime = picked;
                  // Clear expiry if it is no longer after the new publish.
                  if (_expiryDateTime != null && !_expiryDateTime!.isAfter(picked)) {
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
              if (_publishDateTime == null) {
                _snack('Please set the Publish Date first.');
                return;
              }
              final picked = await _pickDateTime(
                _expiryDateTime,
                minDateTime: _publishDateTime,
              );
              if (picked != null) setState(() => _expiryDateTime = picked);
            },
          ),
          const SizedBox(height: 24),
          _buildSaveButton(),
        ],
        ),
      ),
    );
  }

  Widget _buildAccessTypeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Access Type', style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: _buildAccessChip('downloadable', 'Downloadable', Icons.download)),
          const SizedBox(width: 8),
          Expanded(child: _buildAccessChip('viewonly', 'View Only', Icons.visibility)),
        ]),
      ],
    );
  }

  Widget _buildAccessChip(String value, String label, IconData icon) {
    final selected = _accessType == value;
    return InkWell(
      onTap: () => setState(() => _accessType = value),
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
        Text('File *', style: AppTextStyles.caption.copyWith(
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
              const Icon(Icons.description, color: AppColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _originalFileName ?? _filePath!.split('/').last,
                  style: AppTextStyles.body, overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close, color: AppColors.error),
                onPressed: _uploading ? null : () {
                  setState(() { _filePath = null; _originalFileName = null; });
                },
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
                border: Border.all(color: AppColors.border, style: BorderStyle.solid),
              ),
              child: Column(children: [
                if (_uploading)
                  const CircularProgressIndicator(color: AppColors.primary, strokeWidth: 2)
                else
                  const Icon(Icons.upload_file, size: 32, color: AppColors.textSecondary),
                const SizedBox(height: 6),
                Text(_uploading ? 'Uploading...' : 'Tap to upload file',
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
