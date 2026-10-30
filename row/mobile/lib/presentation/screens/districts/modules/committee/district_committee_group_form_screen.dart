import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class CommitteeGroupFormYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const CommitteeGroupFormYear({
    required this.id,
    required this.yearLabel,
    required this.isCurrent,
  });
}

class CommitteeGroupFormInitial {
  final int id;
  final String groupName;
  final int yearId;
  const CommitteeGroupFormInitial({
    required this.id,
    required this.groupName,
    required this.yearId,
  });
}

class DistrictCommitteeGroupFormScreen extends StatefulWidget {
  final int districtId;
  final List<CommitteeGroupFormYear> years;
  final int? defaultYearId;
  final CommitteeGroupFormInitial? initial;

  const DistrictCommitteeGroupFormScreen({
    super.key,
    required this.districtId,
    required this.years,
    this.defaultYearId,
    this.initial,
  });

  @override
  State<DistrictCommitteeGroupFormScreen> createState() =>
      _DistrictCommitteeGroupFormScreenState();
}

class _DistrictCommitteeGroupFormScreenState
    extends State<DistrictCommitteeGroupFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  int? _yearId;
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _nameCtrl.text = widget.initial!.groupName;
      _yearId = widget.initial!.yearId;
    } else {
      _yearId = widget.defaultYearId;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = {'yearId': _yearId, 'groupName': _nameCtrl.text.trim()};
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/committee/groups/${widget.initial!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/committee/groups',
          body: body,
        );
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
        title: _isEdit ? 'Edit Group' : 'Add Group',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _saving ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: const StadiumBorder(),
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
              label: 'Group Name',
              controller: _nameCtrl,
              hint: 'e.g. Club Service',
              prefixIcon: Icons.groups_2_outlined,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Group name is required' : null,
            ),
            const SizedBox(height: 16),
            if (widget.years.isNotEmpty)
              DropdownButtonFormField<int>(
                initialValue: _yearId,
                decoration: InputDecoration(
                  labelText: 'Rotary Year',
                  border:
                      OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
                items: widget.years
                    .map((y) => DropdownMenuItem(
                          value: y.id,
                          child: Text(
                              '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}'),
                        ))
                    .toList(),
                onChanged: _saving ? null : (v) => setState(() => _yearId = v),
                validator: (v) => v == null ? 'Year is required' : null,
              ),
          ],
        ),
        ),
      ),
    );
  }
}
