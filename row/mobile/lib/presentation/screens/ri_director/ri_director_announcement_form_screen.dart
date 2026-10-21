import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/utils/image_crop.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_text_field.dart';
import 'widgets/ri_recipient_picker.dart';

class RiDirectorAnnouncementFormScreen extends StatefulWidget {
  final int? announcementId;
  const RiDirectorAnnouncementFormScreen({super.key, this.announcementId});

  @override
  State<RiDirectorAnnouncementFormScreen> createState() =>
      _RiDirectorAnnouncementFormScreenState();
}

class _RiDirectorAnnouncementFormScreenState
    extends State<RiDirectorAnnouncementFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descriptionCtrl = TextEditingController();

  String? _imagePath;
  String? _localImagePath;
  DateTime? _publishDateTime;
  DateTime? _expiryDateTime;
  bool _isDisplayOnBanner = false;
  bool _isSendEmail = false;
  bool _isRepeatNotification = false;
  List<DateTime> _reminders = [];
  RiRecipientValue _recipient = const RiRecipientValue();

  bool _loading = false;
  bool _uploading = false;
  bool _saving = false;
  String? _loadError;

  bool get _isEdit => widget.announcementId != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) _load();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descriptionCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _loadError = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/announcements/${widget.announcementId}',
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
      final rawReminders = d['reminders'] as List<dynamic>? ?? const [];
      setState(() {
        _titleCtrl.text = d['title']?.toString() ?? '';
        _descriptionCtrl.text = d['description']?.toString() ?? '';
        _imagePath = d['imagePath']?.toString();
        _publishDateTime = d['publishDateTime'] != null
            ? DateTime.tryParse(d['publishDateTime'].toString()) : null;
        _expiryDateTime = d['expiryDateTime'] != null
            ? DateTime.tryParse(d['expiryDateTime'].toString()) : null;
        _isDisplayOnBanner = d['isDisplayOnBanner'] as bool? ?? false;
        _isSendEmail = d['isSendEmail'] as bool? ?? false;
        _isRepeatNotification = d['isRepeatNotification'] as bool? ?? false;
        _reminders = rawReminders
            .map((r) {
              if (r is Map<String, dynamic>) return DateTime.tryParse(r['reminderDateTime']?.toString() ?? '');
              return DateTime.tryParse(r.toString());
            })
            .whereType<DateTime>()
            .toList();
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

  Future<void> _pickImage() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      // Free-form crop before upload (no fixed ratio).
      final cropped = await cropImageFree(picked.path, title: 'Crop Image');
      if (cropped == null) return;
      setState(() => _uploading = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/ri-director/announcements/upload',
        filePath: cropped,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _uploading = false;
        final path = resp.data?['path'] as String?;
        if (path != null && path.isNotEmpty) {
          _imagePath = path;
          _localImagePath = cropped;
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

  DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);
  DateTime _local(DateTime d) => d.isUtc ? d.toLocal() : d;

  /// Serializes a picked date/time as a naive local wall-clock string
  /// (`YYYY-MM-DDTHH:mm:00`, no timezone/UTC offset), matching the web admin.
  /// The backend stores and displays this value as-is, so converting to UTC
  /// here would shift the time by the local offset (the "wrong timings" bug).
  String _localIso(DateTime d) {
    final dt = _local(d);
    String two(int n) => n.toString().padLeft(2, '0');
    return '${dt.year}-${two(dt.month)}-${two(dt.day)}'
        'T${two(dt.hour)}:${two(dt.minute)}:00';
  }

  /// Picks a date + time.
  /// - [allowPast]=false (default): calendar floor is today.
  /// - [allowPast]=true: floor opens 1 year back (use for "publish date"
  ///   which may legitimately be backdated).
  /// - [minDateTime] / [maxDateTime]: cross-field clamps (date-only).
  /// Edit-mode fallback: an existing earlier date is always selectable so
  /// the picker can open on it without tripping the firstDate assertion.
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
    if (_isRepeatNotification) {
      for (final r in _reminders) {
        if (!r.isAfter(_publishDateTime!) || !r.isBefore(_expiryDateTime!)) {
          _snack('Reminders must be between publish and expiry.'); return;
        }
      }
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
        'description': _descriptionCtrl.text.trim().isEmpty ? null : _descriptionCtrl.text.trim(),
        'imagePath': _imagePath,
        'publishDateTime': _localIso(_publishDateTime!),
        'expiryDateTime': _localIso(_expiryDateTime!),
        'isDisplayOnBanner': _isDisplayOnBanner,
        'isSendEmail': _isSendEmail,
        'isRepeatNotification': _isRepeatNotification,
        'reminders': _isRepeatNotification && _reminders.isNotEmpty
            ? _reminders.map((r) => _localIso(r)).toList()
            : null,
        'recipientTarget': _recipient.target,
        'recipientZoneIds': _recipient.zoneIds,
        'recipientDistrictIds': _recipient.districtIds,
        'recipientSubgroupIds': _recipient.subgroupIds,
      };
      if (_isEdit) {
        await _api.put('/api/ri-director/announcements/${widget.announcementId}', body: payload);
      } else {
        await _api.post('/api/ri-director/announcements', body: payload);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Announcement updated' : 'Announcement created'),
          backgroundColor: AppColors.success,
        ),
      );
      // Use go_router's pop (not Navigator.pop) so the list's `context.push`
      // future actually completes — with bare Navigator.pop it did not, so the
      // caller's post-await refresh never ran and a new announcement stayed
      // missing until a manual pull-to-refresh.
      context.pop(true);
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
    final l = _local(d);
    final dd = l.day.toString().padLeft(2, '0');
    final mm = l.month.toString().padLeft(2, '0');
    final ampm = l.hour >= 12 ? 'PM' : 'AM';
    var h12 = l.hour % 12;
    if (h12 == 0) h12 = 12;
    final hh = h12.toString().padLeft(2, '0');
    final mi = l.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${l.year}  $hh:$mi $ampm';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEdit ? 'Edit Announcement' : 'Add Announcement'),
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
          CustomTextField(
            label: 'Description',
            controller: _descriptionCtrl,
            maxLines: 4,
            maxLength: 1000,
          ),
          const SizedBox(height: 14),
          _buildImagePicker(),
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
                  // Clear expiry if the new publish no longer ≤ existing expiry.
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
          const SizedBox(height: 16),
          Text('Display & Notifications', style: AppTextStyles.h4),
          const SizedBox(height: 8),
          // "Display on Banner" toggle hidden to match the web console
          // (kept in DB/payload for future use — `_isDisplayOnBanner` stays false).
          _buildToggle('Send through Email',
              _isSendEmail, (v) => setState(() => _isSendEmail = v)),
          const SizedBox(height: 8),
          _buildToggle('Repeat Notification',
              _isRepeatNotification, (v) {
                setState(() {
                  _isRepeatNotification = v;
                  if (!v) _reminders = [];
                });
              }),
          if (_isRepeatNotification) ...[
            const SizedBox(height: 8),
            _buildRemindersEditor(),
          ],
          const SizedBox(height: 24),
          _buildSaveButton(),
        ],
        ),
      ),
    );
  }

  Widget _buildImagePicker() {
    final hasImage = (_localImagePath != null && _localImagePath!.isNotEmpty)
        || (_imagePath != null && _imagePath!.isNotEmpty);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Image', style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        if (hasImage)
          Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: _localImagePath != null
                    ? Image.network(
                        // Show uploaded server path once uploaded
                        _imagePath != null ? ApiConstants.mediaUrl(_imagePath) : '',
                        width: double.infinity,
                        height: 140, fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          height: 140, color: AppColors.surface,
                          alignment: Alignment.center,
                          child: const Icon(Icons.image, color: AppColors.textMuted),
                        ),
                      )
                    : CachedNetworkImage(
                        imageUrl: ApiConstants.mediaUrl(_imagePath),
                        width: double.infinity,
                        height: 140, fit: BoxFit.cover,
                        placeholder: (_, __) => Container(height: 140, color: AppColors.primaryLight),
                        errorWidget: (_, __, ___) => Container(
                          height: 140, color: AppColors.surface,
                          alignment: Alignment.center,
                          child: const Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                        ),
                      ),
              ),
              if (_uploading)
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    alignment: Alignment.center,
                    child: const CircularProgressIndicator(
                      valueColor: AlwaysStoppedAnimation(Colors.white), strokeWidth: 2,
                    ),
                  ),
                ),
              Positioned(
                top: 6, right: 6,
                child: GestureDetector(
                  onTap: _uploading ? null : () => setState(() {
                    _imagePath = null; _localImagePath = null;
                  }),
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.55),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.close, color: Colors.white, size: 16),
                  ),
                ),
              ),
            ],
          )
        else
          InkWell(
            onTap: _uploading ? null : _pickImage,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 24),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(children: [
                const Icon(Icons.add_photo_alternate_outlined, size: 32, color: AppColors.textSecondary),
                const SizedBox(height: 6),
                Text('Tap to upload image',
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

  Widget _buildToggle(String label, bool value, ValueChanged<bool> onChanged) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: SwitchListTile(
        title: Text(label, style: AppTextStyles.bodyMedium),
        value: value,
        onChanged: onChanged,
        contentPadding: EdgeInsets.zero,
        activeThumbColor: AppColors.primary,
        dense: true,
      ),
    );
  }

  Widget _buildRemindersEditor() {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.primaryLight.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Reminders', style: AppTextStyles.caption.copyWith(
            color: AppColors.textSecondary, fontWeight: FontWeight.w600,
          )),
          const SizedBox(height: 6),
          for (int i = 0; i < _reminders.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final picked = await _pickDateTime(_reminders[i]);
                      if (picked != null) setState(() => _reminders[i] = picked);
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Text(_fmtDT(_reminders[i]), style: AppTextStyles.body),
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppColors.error, size: 18),
                  onPressed: () => setState(() => _reminders.removeAt(i)),
                ),
              ]),
            ),
          OutlinedButton.icon(
            onPressed: () async {
              final picked = await _pickDateTime(null);
              if (picked != null) setState(() => _reminders.add(picked));
            },
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Add Reminder'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: const BorderSide(color: AppColors.primary),
            ),
          ),
        ],
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

