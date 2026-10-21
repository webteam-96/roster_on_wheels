import 'package:flutter/material.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class SubGroupFormInitial {
  final int id;
  final String subGroupName;
  const SubGroupFormInitial({required this.id, required this.subGroupName});
}

class DistrictCommitteeSubGroupFormScreen extends StatefulWidget {
  final int districtId;
  final int groupId;
  final SubGroupFormInitial? initial;

  const DistrictCommitteeSubGroupFormScreen({
    super.key,
    required this.districtId,
    required this.groupId,
    this.initial,
  });

  @override
  State<DistrictCommitteeSubGroupFormScreen> createState() =>
      _DistrictCommitteeSubGroupFormScreenState();
}

class _DistrictCommitteeSubGroupFormScreenState
    extends State<DistrictCommitteeSubGroupFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  String get _base =>
      '/api/districts/${widget.districtId}/committee/groups/${widget.groupId}/sub-groups';

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _nameCtrl.text = widget.initial!.subGroupName;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = {'subGroupName': _nameCtrl.text.trim()};
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put('$_base/${widget.initial!.id}', body: body);
      } else {
        await _api.post(_base, body: body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Save failed: $e'), backgroundColor: AppColors.error),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Sub-Group' : 'Add Sub-Group',
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
            CustomTextField(
              label: 'Sub-Group Name',
              controller: _nameCtrl,
              hint: 'e.g. Membership Development',
              prefixIcon: Icons.layers_outlined,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Sub-group name is required' : null,
            ),
          ],
        ),
        ),
      ),
    );
  }
}
