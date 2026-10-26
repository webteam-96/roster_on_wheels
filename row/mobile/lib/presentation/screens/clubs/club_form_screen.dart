import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../core/utils/validators.dart';
import '../../../data/models/club_model.dart';
import '../../../data/models/district_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ClubFormScreen extends StatefulWidget {
  final int? clubId;
  const ClubFormScreen({super.key, this.clubId});

  bool get isEditMode => clubId != null;

  @override
  State<ClubFormScreen> createState() => _ClubFormScreenState();
}

class _ClubFormScreenState extends State<ClubFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final ApiClient _api = ApiClient();

  // Controllers
  final _clubRotaryIdCtrl = TextEditingController();
  final _clubNameCtrl = TextEditingController();
  final _clubWebsiteCtrl = TextEditingController();
  final _meetingAddressCtrl = TextEditingController();
  final _countryCtrl = TextEditingController();
  final _stateCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _pincodeCtrl = TextEditingController();
  final _timezoneCtrl = TextEditingController();

  // State
  bool _isActive = true;
  bool _isAutomaticMeetingReminder = false;
  bool _isFamilyLogin = false;
  bool _isLoading = false;
  bool _isFetching = false;
  String? _fetchError;

  // Districts
  List<DistrictModel> _districts = [];
  int? _selectedDistrictId;
  bool _loadingDistricts = false;

  // Meeting
  String? _selectedMeetingDay;
  TimeOfDay? _meetingFromTime;
  TimeOfDay? _meetingToTime;

  // Charter date
  DateTime? _charterDate;

  // Logo
  File? _logoFile;
  String? _existingLogoUrl;
  bool _uploadingLogo = false;

  static const List<String> _weekdays = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ];

  @override
  void initState() {
    super.initState();
    _loadDistricts();
    if (widget.isEditMode) _fetchClub();
  }

  @override
  void dispose() {
    _clubRotaryIdCtrl.dispose();
    _clubNameCtrl.dispose();
    _clubWebsiteCtrl.dispose();
    _meetingAddressCtrl.dispose();
    _countryCtrl.dispose();
    _stateCtrl.dispose();
    _cityCtrl.dispose();
    _pincodeCtrl.dispose();
    _timezoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadDistricts() async {
    setState(() => _loadingDistricts = true);
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/districts',
        queryParams: {'page': 1, 'pageSize': 200},
      );
      final data = res.data;
      if (data != null) {
        final items = data['items'] as List<dynamic>? ?? [];
        setState(() {
          _districts =
              items.map((e) => DistrictModel.fromJson(e as Map<String, dynamic>)).toList();
        });
      }
    } catch (_) {} finally {
      setState(() => _loadingDistricts = false);
    }
  }

  Future<void> _fetchClub() async {
    setState(() {
      _isFetching = true;
      _fetchError = null;
    });
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/clubs/${widget.clubId}');
      final data = res.data;
      if (data != null) {
        final club = ClubModel.fromJson(data);
        _clubRotaryIdCtrl.text = club.clubRotaryId ?? '';
        _clubNameCtrl.text = club.clubName;
        _clubWebsiteCtrl.text = club.clubWebsite ?? '';
        _meetingAddressCtrl.text = club.meetingAddress ?? '';
        _countryCtrl.text = club.country ?? '';
        _stateCtrl.text = club.state ?? '';
        _cityCtrl.text = club.city ?? '';
        _pincodeCtrl.text = club.pincode ?? '';
        _timezoneCtrl.text = club.timezone ?? '';

        setState(() {
          _selectedDistrictId = club.fkDistrictId;
          _selectedMeetingDay = club.meetingDay;
          _isActive = club.isActive;
          _isAutomaticMeetingReminder = club.isAutomaticMeetingReminder;
          _isFamilyLogin = club.isFamilyLogin;
          _existingLogoUrl = club.clubLogoPath;

          if (club.meetingFromTime != null) {
            final parts = club.meetingFromTime!.split(':');
            if (parts.length >= 2) {
              _meetingFromTime = TimeOfDay(
                hour: int.tryParse(parts[0]) ?? 0,
                minute: int.tryParse(parts[1]) ?? 0,
              );
            }
          }
          if (club.meetingToTime != null) {
            final parts = club.meetingToTime!.split(':');
            if (parts.length >= 2) {
              _meetingToTime = TimeOfDay(
                hour: int.tryParse(parts[0]) ?? 0,
                minute: int.tryParse(parts[1]) ?? 0,
              );
            }
          }
          if (club.clubCharterDate != null) {
            final cd = DateTime.tryParse(club.clubCharterDate!);
            // Backend zero dates (`0001-01-01`) mean "no value" — keep it empty.
            _charterDate = (cd == null || cd.year <= 1) ? null : cd;
          }
        });
      }
    } catch (e) {
      setState(() => _fetchError = e.toString());
    } finally {
      setState(() => _isFetching = false);
    }
  }

  Future<void> _pickLogo() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80, maxWidth: 2560, maxHeight: 2560);
    if (picked == null) return;
    setState(() => _logoFile = File(picked.path));
  }

  Future<String?> _uploadLogo() async {
    if (_logoFile == null) return _existingLogoUrl;
    setState(() => _uploadingLogo = true);
    try {
      final res = await _api.uploadFile<Map<String, dynamic>>(
        '/clubs/upload',
        filePath: _logoFile!.path,
        fieldName: 'logo',
      );
      final data = res.data;
      return data?['path'] as String? ?? data?['url'] as String?;
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Logo upload failed: $e');
      return _existingLogoUrl;
    } finally {
      if (mounted) setState(() => _uploadingLogo = false);
    }
  }

  Future<void> _pickMeetingFromTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _meetingFromTime ?? TimeOfDay.now(),
    );
    if (picked != null) setState(() => _meetingFromTime = picked);
  }

  Future<void> _pickMeetingToTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _meetingToTime ?? TimeOfDay.now(),
    );
    if (picked != null) setState(() => _meetingToTime = picked);
  }

  Future<void> _pickCharterDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _charterDate ?? DateTime.now(),
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _charterDate = picked);
  }

  String _formatTime(TimeOfDay? t) {
    if (t == null) return '';
    final h = t.hour.toString().padLeft(2, '0');
    final m = t.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isLoading = true);

    final logoPath = await _uploadLogo();

    final body = <String, dynamic>{
      'fkDistrictId': _selectedDistrictId,
      'clubRotaryId': _clubRotaryIdCtrl.text.trim().isEmpty ? null : _clubRotaryIdCtrl.text.trim(),
      'clubName': _clubNameCtrl.text.trim(),
      'clubWebsite': _clubWebsiteCtrl.text.trim().isEmpty ? null : _clubWebsiteCtrl.text.trim(),
      'meetingDay': _selectedMeetingDay,
      'meetingFromTime': _meetingFromTime != null ? _formatTime(_meetingFromTime) : null,
      'meetingToTime': _meetingToTime != null ? _formatTime(_meetingToTime) : null,
      'meetingAddress': _meetingAddressCtrl.text.trim().isEmpty ? null : _meetingAddressCtrl.text.trim(),
      'country': _countryCtrl.text.trim().isEmpty ? null : _countryCtrl.text.trim(),
      'state': _stateCtrl.text.trim().isEmpty ? null : _stateCtrl.text.trim(),
      'city': _cityCtrl.text.trim().isEmpty ? null : _cityCtrl.text.trim(),
      'pincode': _pincodeCtrl.text.trim().isEmpty ? null : _pincodeCtrl.text.trim(),
      'clubCharterDate': _charterDate?.toIso8601String(),
      'timezone': _timezoneCtrl.text.trim().isEmpty ? null : _timezoneCtrl.text.trim(),
      'isAutomaticMeetingReminder': _isAutomaticMeetingReminder,
      'isFamilyLogin': _isFamilyLogin,
      'isActive': _isActive,
      if (logoPath != null) 'clubLogoPath': logoPath,
    };

    try {
      if (widget.isEditMode) {
        await _api.put(ApiConstants.clubById(widget.clubId!), body: body);
      } else {
        await _api.post(ApiConstants.clubs, body: body);
      }
      if (!mounted) return;
      SnackbarUtils.showSuccess(
        context,
        widget.isEditMode ? 'Club updated successfully.' : 'Club created successfully.',
      );
      context.pop();
    } catch (e) {
      if (!mounted) return;
      SnackbarUtils.showError(context, e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: widget.isEditMode ? 'Edit Club' : 'New Club'),
      body: _isFetching
          ? const LoadingWidget()
          : _fetchError != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_fetchError!, style: AppTextStyles.body.copyWith(color: AppColors.error)),
                      const SizedBox(height: 16),
                      CustomButton(label: 'Retry', onPressed: _fetchClub, icon: Icons.refresh),
                    ],
                  ),
                )
              : _buildForm(),
    );
  }

  Widget _buildForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
          16, 16, 16, 16),
      child: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Logo
            _SectionCard(
              title: 'Club Logo',
              children: [
                Center(
                  child: _LogoPicker(
                    logoFile: _logoFile,
                    existingUrl: _existingLogoUrl,
                    isUploading: _uploadingLogo,
                    onPick: _pickLogo,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Basic
            _SectionCard(
              title: 'Basic Information',
              children: [
                // District dropdown
                Text('District', style: AppTextStyles.bodySemiBold),
                const SizedBox(height: 6),
                _loadingDistricts
                    ? const LinearProgressIndicator()
                    : Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<int?>(
                            value: _selectedDistrictId,
                            isExpanded: true,
                            hint: Text('Select District',
                                style: AppTextStyles.body.copyWith(color: AppColors.textMuted)),
                            style: AppTextStyles.body.copyWith(color: AppColors.textPrimary),
                            items: [
                              const DropdownMenuItem<int?>(value: null, child: Text('None')),
                              ..._districts.map(
                                (d) => DropdownMenuItem<int?>(
                                  value: d.id,
                                  child: Text('${d.districtName} (${d.districtNumber})'),
                                ),
                              ),
                            ],
                            onChanged: (v) => setState(() => _selectedDistrictId = v),
                          ),
                        ),
                      ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _clubRotaryIdCtrl,
                  label: 'Rotary Club ID',
                  hint: 'e.g. RC001',
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _clubNameCtrl,
                  label: 'Club Name *',
                  hint: 'e.g. Rotary Club of Mumbai',
                  validator: (v) => Validators.required(v, 'Club name'),
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _clubWebsiteCtrl,
                  label: 'Club Website',
                  hint: 'https://example.com',
                  keyboardType: TextInputType.url,
                  validator: Validators.url,
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Meeting details
            _SectionCard(
              title: 'Meeting Details',
              children: [
                Text('Meeting Day', style: AppTextStyles.bodySemiBold),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String?>(
                      value: _selectedMeetingDay,
                      isExpanded: true,
                      hint: Text('Select Day',
                          style: AppTextStyles.body.copyWith(color: AppColors.textMuted)),
                      style: AppTextStyles.body.copyWith(color: AppColors.textPrimary),
                      items: [
                        const DropdownMenuItem<String?>(value: null, child: Text('None')),
                        ..._weekdays.map(
                          (d) => DropdownMenuItem<String?>(value: d, child: Text(d)),
                        ),
                      ],
                      onChanged: (v) => setState(() => _selectedMeetingDay = v),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _TimePicker(
                        label: 'From Time',
                        time: _meetingFromTime,
                        onTap: _pickMeetingFromTime,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _TimePicker(
                        label: 'To Time',
                        time: _meetingToTime,
                        onTap: _pickMeetingToTime,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _meetingAddressCtrl,
                  label: 'Meeting Address',
                  hint: 'Meeting venue address',
                  maxLines: 2,
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Location
            _SectionCard(
              title: 'Location',
              children: [
                CustomTextField(controller: _cityCtrl, label: 'City', hint: 'Mumbai'),
                const SizedBox(height: 16),
                CustomTextField(controller: _stateCtrl, label: 'State', hint: 'Maharashtra'),
                const SizedBox(height: 16),
                CustomTextField(controller: _countryCtrl, label: 'Country', hint: 'United States'),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _pincodeCtrl,
                  label: 'Pincode',
                  hint: '400001',
                  keyboardType: TextInputType.number,
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Other
            _SectionCard(
              title: 'Other Details',
              children: [
                // Charter date
                Text('Club Charter Date', style: AppTextStyles.bodySemiBold),
                const SizedBox(height: 6),
                GestureDetector(
                  onTap: _pickCharterDate,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                      color: AppColors.surface,
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.calendar_today_outlined,
                            size: 18, color: AppColors.textSecondary),
                        const SizedBox(width: 8),
                        Text(
                          _charterDate != null
                              ? '${_charterDate!.day}/${_charterDate!.month}/${_charterDate!.year}'
                              : 'Select date',
                          style: AppTextStyles.body.copyWith(
                            color: _charterDate != null
                                ? AppColors.textPrimary
                                : AppColors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _timezoneCtrl,
                  label: 'Timezone',
                  hint: 'e.g. Europe/London',
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Toggles
            _SectionCard(
              title: 'Settings',
              children: [
                _ToggleRow(
                  label: 'Automatic Meeting Reminder',
                  subtitle: 'Send reminder before each meeting',
                  value: _isAutomaticMeetingReminder,
                  onChanged: (v) => setState(() => _isAutomaticMeetingReminder = v),
                ),
                const Divider(height: 24),
                _ToggleRow(
                  label: 'Family Login',
                  subtitle: 'Allow family members to log in',
                  value: _isFamilyLogin,
                  onChanged: (v) => setState(() => _isFamilyLogin = v),
                ),
                const Divider(height: 24),
                _ToggleRow(
                  label: 'Active',
                  subtitle: _isActive ? 'Club is active' : 'Club is inactive',
                  value: _isActive,
                  onChanged: (v) => setState(() => _isActive = v),
                ),
              ],
            ),
            const SizedBox(height: 24),

            CustomButton(
              label: widget.isEditMode ? 'Update Club' : 'Create Club',
              onPressed: (_isLoading || _uploadingLogo) ? null : _save,
              isLoading: _isLoading,
              fullWidth: true,
              icon: widget.isEditMode ? Icons.save_outlined : Icons.add,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helper widgets
// ---------------------------------------------------------------------------

class _LogoPicker extends StatelessWidget {
  final File? logoFile;
  final String? existingUrl;
  final bool isUploading;
  final VoidCallback onPick;
  const _LogoPicker({
    required this.logoFile,
    required this.existingUrl,
    required this.isUploading,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    Widget image;
    if (logoFile != null) {
      image = Image.file(logoFile!, fit: BoxFit.cover);
    } else if (existingUrl != null && existingUrl!.isNotEmpty) {
      image = Image.network(ApiConstants.mediaUrl(existingUrl), fit: BoxFit.cover,
          errorBuilder: (_, __, ___) =>
              const Icon(Icons.image_not_supported_outlined, size: 40, color: AppColors.textMuted));
    } else {
      image = const Icon(Icons.add_photo_alternate_outlined, size: 40, color: AppColors.textMuted);
    }

    return GestureDetector(
      onTap: isUploading ? null : onPick,
      child: Container(
        width: 100,
        height: 100,
        decoration: BoxDecoration(
          color: AppColors.muted,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: isUploading
            ? const Center(
                child: const CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary))
            : image,
      ),
    );
  }
}

class _TimePicker extends StatelessWidget {
  final String label;
  final TimeOfDay? time;
  final VoidCallback onTap;
  const _TimePicker({required this.label, required this.time, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTextStyles.bodySemiBold),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(8),
              color: AppColors.surface,
            ),
            child: Row(
              children: [
                const Icon(Icons.access_time, size: 18, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Text(
                  time != null ? time!.format(context) : 'Select',
                  style: AppTextStyles.body.copyWith(
                    color: time != null ? AppColors.textPrimary : AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ToggleRow extends StatelessWidget {
  final String label;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  const _ToggleRow({
    required this.label,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: AppTextStyles.bodySemiBold),
              Text(subtitle,
                  style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
            ],
          ),
        ),
        Switch.adaptive(value: value, activeColor: AppColors.primary, onChanged: onChanged),
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String? title;
  final List<Widget> children;
  const _SectionCard({this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(title!, style: AppTextStyles.h4),
            const SizedBox(height: 14),
          ],
          ...children,
        ],
      ),
    );
  }
}
