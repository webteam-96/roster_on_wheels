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
import '../../../data/models/district_model.dart';
import '../../../data/models/zone_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class DistrictFormScreen extends StatefulWidget {
  final int? districtId;
  const DistrictFormScreen({super.key, this.districtId});

  bool get isEditMode => districtId != null;

  @override
  State<DistrictFormScreen> createState() => _DistrictFormScreenState();
}

class _DistrictFormScreenState extends State<DistrictFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final ApiClient _api = ApiClient();

  // Controllers
  final _districtNumberCtrl = TextEditingController();
  final _districtNameCtrl = TextEditingController();
  final _websiteCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _stateCtrl = TextEditingController();
  final _countryCtrl = TextEditingController();

  bool _isActive = true;
  bool _isLoading = false;
  bool _isFetching = false;
  String? _fetchError;

  // Zone dropdown
  List<ZoneModel> _zones = [];
  int? _selectedZoneId;
  bool _loadingZones = false;

  // Logo upload
  File? _logoFile;
  String? _existingLogoUrl;
  bool _uploadingLogo = false;

  @override
  void initState() {
    super.initState();
    _loadZones();
    if (widget.isEditMode) {
      _fetchDistrict();
    }
  }

  @override
  void dispose() {
    _districtNumberCtrl.dispose();
    _districtNameCtrl.dispose();
    _websiteCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _cityCtrl.dispose();
    _stateCtrl.dispose();
    _countryCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadZones() async {
    setState(() => _loadingZones = true);
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.zones,
        queryParams: {'page': 1, 'pageSize': 200},
      );
      final data = res.data;
      if (data != null) {
        final items = data['items'] as List<dynamic>? ?? [];
        setState(() {
          _zones = items.map((e) => ZoneModel.fromJson(e as Map<String, dynamic>)).toList();
        });
      }
    } catch (_) {} finally {
      setState(() => _loadingZones = false);
    }
  }

  Future<void> _fetchDistrict() async {
    setState(() {
      _isFetching = true;
      _fetchError = null;
    });
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/districts/${widget.districtId}');
      final data = res.data;
      if (data != null) {
        final d = DistrictModel.fromJson(data);
        _districtNumberCtrl.text = '${d.districtNumber}';
        _districtNameCtrl.text = d.districtName;
        _websiteCtrl.text = d.website ?? '';
        _phoneCtrl.text = d.phoneNumber ?? '';
        _emailCtrl.text = d.email ?? '';
        _cityCtrl.text = d.city ?? '';
        _stateCtrl.text = d.state ?? '';
        _countryCtrl.text = d.country ?? '';
        setState(() {
          _isActive = d.isActive;
          _selectedZoneId = d.fkZoneId;
          _existingLogoUrl = d.districtLogoPath;
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
        '/districts/upload',
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

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _isLoading = true);

    final logoPath = await _uploadLogo();

    final body = <String, dynamic>{
      'fkZoneId': _selectedZoneId,
      'districtNumber': int.tryParse(_districtNumberCtrl.text.trim()) ?? 0,
      'districtName': _districtNameCtrl.text.trim(),
      'website': _websiteCtrl.text.trim().isEmpty ? null : _websiteCtrl.text.trim(),
      'phoneNumber': _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
      'email': _emailCtrl.text.trim().isEmpty ? null : _emailCtrl.text.trim(),
      'city': _cityCtrl.text.trim().isEmpty ? null : _cityCtrl.text.trim(),
      'state': _stateCtrl.text.trim().isEmpty ? null : _stateCtrl.text.trim(),
      'country': _countryCtrl.text.trim().isEmpty ? null : _countryCtrl.text.trim(),
      'isActive': _isActive,
      if (logoPath != null) 'districtLogoPath': logoPath,
    };

    try {
      if (widget.isEditMode) {
        await _api.put(ApiConstants.districtById(widget.districtId!), body: body);
      } else {
        await _api.post(ApiConstants.districts, body: body);
      }
      if (!mounted) return;
      SnackbarUtils.showSuccess(
        context,
        widget.isEditMode ? 'District updated successfully.' : 'District created successfully.',
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
      appBar: CustomAppBar(
        title: widget.isEditMode ? 'Edit District' : 'New District',
      ),
      body: _isFetching
          ? const LoadingWidget()
          : _fetchError != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_fetchError!, style: AppTextStyles.body.copyWith(color: AppColors.error)),
                      const SizedBox(height: 16),
                      CustomButton(label: 'Retry', onPressed: _fetchDistrict, icon: Icons.refresh),
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
            // Logo section
            _SectionCard(
              title: 'District Logo',
              children: [
                Center(child: _LogoPicker(
                  logoFile: _logoFile,
                  existingUrl: _existingLogoUrl,
                  isUploading: _uploadingLogo,
                  onPick: _pickLogo,
                )),
              ],
            ),
            const SizedBox(height: 12),

            // Basic info
            _SectionCard(
              title: 'Basic Information',
              children: [
                // Zone dropdown
                Text('Zone', style: AppTextStyles.bodySemiBold),
                const SizedBox(height: 6),
                _loadingZones
                    ? const LinearProgressIndicator()
                    : Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(8),
                          color: AppColors.surface,
                        ),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<int?>(
                            value: _selectedZoneId,
                            isExpanded: true,
                            hint: Text('Select Zone', style: AppTextStyles.body.copyWith(color: AppColors.textMuted)),
                            style: AppTextStyles.body.copyWith(color: AppColors.textPrimary),
                            items: [
                              const DropdownMenuItem<int?>(value: null, child: Text('None')),
                              ..._zones.map(
                                (z) => DropdownMenuItem<int?>(value: z.id, child: Text(z.zoneName)),
                              ),
                            ],
                            onChanged: (v) => setState(() => _selectedZoneId = v),
                          ),
                        ),
                      ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _districtNumberCtrl,
                  label: 'District Number *',
                  hint: 'e.g. 3141',
                  keyboardType: TextInputType.number,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'District number is required.';
                    if (int.tryParse(v.trim()) == null) return 'Enter a valid number.';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _districtNameCtrl,
                  label: 'District Name *',
                  hint: 'e.g. Rotary District 3141',
                  validator: (v) => Validators.required(v, 'District name'),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Contact
            _SectionCard(
              title: 'Contact Details',
              children: [
                CustomTextField(
                  controller: _websiteCtrl,
                  label: 'Website',
                  hint: 'https://example.com',
                  keyboardType: TextInputType.url,
                  validator: Validators.url,
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _phoneCtrl,
                  label: 'Phone Number',
                  hint: '10-digit mobile number',
                  keyboardType: TextInputType.phone,
                  validator: (v) => v != null && v.trim().isNotEmpty ? Validators.phone(v) : null,
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _emailCtrl,
                  label: 'Email',
                  hint: 'district@example.com',
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) => v != null && v.trim().isNotEmpty ? Validators.email(v) : null,
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
              ],
            ),
            const SizedBox(height: 12),

            // Status
            _SectionCard(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Status', style: AppTextStyles.bodySemiBold),
                          Text(
                            _isActive ? 'Active' : 'Inactive',
                            style: AppTextStyles.caption.copyWith(
                              color: _isActive ? AppColors.success : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Switch.adaptive(
                      value: _isActive,
                      activeColor: AppColors.primary,
                      onChanged: (val) => setState(() => _isActive = val),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 24),
            CustomButton(
              label: widget.isEditMode ? 'Update District' : 'Create District',
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
// Logo picker widget
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
      image = Image.network(ApiConstants.mediaUrl(existingUrl), fit: BoxFit.cover, errorBuilder: (_, __, ___) {
        return const Icon(Icons.image_not_supported_outlined, size: 40, color: AppColors.textMuted);
      });
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
            ? const Center(child: const CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary))
            : image,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
