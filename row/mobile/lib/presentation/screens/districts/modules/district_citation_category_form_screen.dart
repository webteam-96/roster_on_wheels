import 'package:flutter/material.dart' hide Text;
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class CitationCategoryFormInitial {
  final int id;
  final String name;
  final int sortOrder;
  const CitationCategoryFormInitial({
    required this.id,
    required this.name,
    required this.sortOrder,
  });
}

class DistrictCitationCategoryFormScreen extends StatefulWidget {
  final int districtId;
  final int yearId;
  final CitationCategoryFormInitial? initial;

  const DistrictCitationCategoryFormScreen({
    super.key,
    required this.districtId,
    required this.yearId,
    this.initial,
  });

  @override
  State<DistrictCitationCategoryFormScreen> createState() =>
      _DistrictCitationCategoryFormScreenState();
}

class _DistrictCitationCategoryFormScreenState
    extends State<DistrictCitationCategoryFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _orderCtrl = TextEditingController();
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _nameCtrl.text = widget.initial!.name;
      _orderCtrl.text = widget.initial!.sortOrder.toString();
    } else {
      _orderCtrl.text = '0';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _orderCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = {
      'categoryName': _nameCtrl.text.trim(),
      'sortOrder': int.tryParse(_orderCtrl.text.trim()) ?? 0,
      'yearId': widget.yearId,
    };
    setState(() => _saving = true);
    try {
      final base =
          '/api/district-modules/${widget.districtId}/citation/categories';
      if (_isEdit) {
        await _api.put('$base/${widget.initial!.id}', body: body);
      } else {
        await _api.post(base, body: body);
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
        title: _isEdit ? 'Edit Category' : 'Add Category',
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
              label: 'Name',
              controller: _nameCtrl,
              prefixIcon: Icons.category_outlined,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Name is required' : null,
            ),
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Sort Order',
              controller: _orderCtrl,
              keyboardType: TextInputType.number,
              prefixIcon: Icons.sort,
            ),
          ],
        ),
        ),
      ),
    );
  }
}
