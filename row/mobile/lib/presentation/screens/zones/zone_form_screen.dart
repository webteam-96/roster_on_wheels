import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../core/utils/validators.dart';
import '../../../data/models/zone_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ZoneFormScreen extends StatefulWidget {
  final int? zoneId;

  const ZoneFormScreen({super.key, this.zoneId});

  bool get isEditMode => zoneId != null;

  @override
  State<ZoneFormScreen> createState() => _ZoneFormScreenState();
}

class _ZoneFormScreenState extends State<ZoneFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final ApiClient _api = ApiClient();

  // Controllers
  final _zoneNameCtrl = TextEditingController();
  final _websiteCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();

  bool _isActive = true;
  bool _isLoading = false;
  bool _isFetching = false;
  String? _fetchError;

  @override
  void initState() {
    super.initState();
    if (widget.isEditMode) {
      _fetchZone();
    }
  }

  @override
  void dispose() {
    _zoneNameCtrl.dispose();
    _websiteCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchZone() async {
    setState(() {
      _isFetching = true;
      _fetchError = null;
    });
    try {
      final response = await _api.get<Map<String, dynamic>>(ApiConstants.zoneById(widget.zoneId!));
      final data = response.data;
      if (data != null) {
        final zone = ZoneModel.fromJson(data);
        _zoneNameCtrl.text = zone.zoneName;
        _websiteCtrl.text = zone.website ?? '';
        _phoneCtrl.text = zone.phoneNumber ?? '';
        _emailCtrl.text = zone.email ?? '';
        setState(() => _isActive = zone.isActive);
      }
    } catch (e) {
      setState(() => _fetchError = e.toString());
    } finally {
      setState(() => _isFetching = false);
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _isLoading = true);

    final body = {
      'zoneName': _zoneNameCtrl.text.trim(),
      'website': _websiteCtrl.text.trim().isEmpty ? null : _websiteCtrl.text.trim(),
      'phoneNumber': _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
      'email': _emailCtrl.text.trim().isEmpty ? null : _emailCtrl.text.trim(),
      'isActive': _isActive,
    };

    try {
      if (widget.isEditMode) {
        await _api.put(ApiConstants.zoneById(widget.zoneId!), body: body);
      } else {
        await _api.post(ApiConstants.zones, body: body);
      }
      if (!mounted) return;
      SnackbarUtils.showSuccess(
        context,
        widget.isEditMode ? 'Zone updated successfully.' : 'Zone created successfully.',
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
        title: widget.isEditMode ? 'Edit Zone' : 'New Zone',
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
                      CustomButton(label: 'Retry', onPressed: _fetchZone, icon: Icons.refresh),
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
            _SectionCard(
              children: [
                CustomTextField(
                  controller: _zoneNameCtrl,
                  label: 'Zone Name *',
                  hint: 'e.g. Zone 4',
                  validator: (v) => Validators.required(v, 'Zone name'),
                ),
                const SizedBox(height: 16),
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
                  hint: '+1 555 010 0100',
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 16),
                CustomTextField(
                  controller: _emailCtrl,
                  label: 'Email',
                  hint: 'zone@example.com',
                  keyboardType: TextInputType.emailAddress,
                  validator: Validators.email,
                ),
              ],
            ),
            const SizedBox(height: 12),
            _SectionCard(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Status', style: AppTextStyles.bodySemiBold),
                          const SizedBox(height: 2),
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
              label: widget.isEditMode ? 'Update Zone' : 'Create Zone',
              onPressed: _isLoading ? null : _save,
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
// Helper
// ---------------------------------------------------------------------------

class _SectionCard extends StatelessWidget {
  final List<Widget> children;
  const _SectionCard({required this.children});

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
        children: children,
      ),
    );
  }
}
